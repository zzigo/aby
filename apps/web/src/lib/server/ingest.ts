import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { IngestPreview, SourceIngestPreviewRequest } from '@zztt/aby-domain';
import { inspectLocalAsset } from '@zztt/aby-media-ingest';
import { AbyError } from './errors';
import { readConfig } from './config';
import { recordingFolderName } from './catalog-path';
import { findAlbumArtwork, identifyWithMusicBrainz, getAudioFingerprint, lookupAcoustID, identifyWithMusicBrainzRecordingId } from './musicbrainz';
import { fetchWikidataEntity } from './wikidata';
import type { AbyRepository } from './repository';
import { assertSourceObjectKey, downloadWasabiSourceObject, headWasabiSourceObject, normalizeObjectKey, listWasabiSiblingKeys } from './storage';
import { parseTrackFilename } from './track-title';
import { repairLegacyDiacritics } from './text-repair';
import { composerSurnameSlug } from './media-path';

function pathSegment(value: string): string {
  const segment = value.normalize('NFC').replace(/\p{Cc}/gu, '').replaceAll('/', '／').trim();
  if (!segment || segment === '.' || segment === '..') throw new AbyError('invalid_catalog_path', 'Catalog path segments cannot be empty', 400);
  return segment;
}

export { parseTrackFilename } from './track-title';

export function albumSlug(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

export type CueTrack = {
  trackNumber: number;
  title: string;
  performer?: string;
  startMs: number;
};

export function parseCueContent(content: string): { file: string; title?: string; performer?: string; tracks: CueTrack[] } {
  const lines = content.split(/\r?\n/);
  let currentFile = '';
  let albumTitle = '';
  let albumPerformer = '';
  const tracks: CueTrack[] = [];
  let currentTrack: Partial<CueTrack> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('FILE')) {
      const match = trimmed.match(/^FILE\s+"([^"]+)"|([^\s]+)/i);
      currentFile = match ? (match[1] || match[2] || '') : '';
    } else if (trimmed.startsWith('TRACK')) {
      const numMatch = trimmed.match(/^TRACK\s+(\d+)/i);
      if (numMatch) {
        currentTrack = { trackNumber: parseInt(numMatch[1]!, 10) };
        tracks.push(currentTrack as CueTrack);
      }
    } else if (currentTrack) {
      if (trimmed.startsWith('TITLE')) {
        const titleMatch = trimmed.match(/^TITLE\s+"([^"]+)"|([^\s]+)/i);
        if (titleMatch) currentTrack.title = titleMatch[1] || titleMatch[2];
      } else if (trimmed.startsWith('PERFORMER')) {
        const perfMatch = trimmed.match(/^PERFORMER\s+"([^"]+)"|([^\s]+)/i);
        if (perfMatch) currentTrack.performer = perfMatch[1] || perfMatch[2];
      } else if (trimmed.startsWith('INDEX 01')) {
        const indexMatch = trimmed.match(/INDEX\s+01\s+(\d{2}):(\d{2}):(\d{2})/i);
        if (indexMatch) {
          const min = parseInt(indexMatch[1]!, 10);
          const sec = parseInt(indexMatch[2]!, 10);
          const frame = parseInt(indexMatch[3]!, 10);
          currentTrack.startMs = Math.round((min * 60 + sec + frame / 75) * 1000);
        }
      }
    } else {
      if (trimmed.startsWith('TITLE')) {
        const titleMatch = trimmed.match(/^TITLE\s+"([^"]+)"|([^\s]+)/i);
        if (titleMatch) albumTitle = titleMatch[1] || titleMatch[2] || '';
      } else if (trimmed.startsWith('PERFORMER')) {
        const perfMatch = trimmed.match(/^PERFORMER\s+"([^"]+)"|([^\s]+)/i);
        if (perfMatch) albumPerformer = perfMatch[1] || perfMatch[2] || '';
      }
    }
  }

  return { file: currentFile, title: albumTitle, performer: albumPerformer, tracks: tracks as CueTrack[] };
}

export async function inspectFixture(ownerId: string, repository: AbyRepository): Promise<IngestPreview> {
  const config = readConfig();
  if (!config.demoMode) throw new AbyError('fixture_disabled', 'The local fixture is available only in demo mode', 403);
  const path = fileURLToPath(new URL('../../../static/demo/aby-phase-0.wav', import.meta.url));
  const inspected = await inspectLocalAsset(path, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });
  const title = inspected.metadata.tags.title || 'Phase 0 sine study';
  const preview: IngestPreview = {
    id: randomUUID(), ownerId, provider: 'local-fixture',
    objectKey: 'aby/aud/demo/aby-phase-0.wav',
    originalFilename: basename(path), originalDirectory: dirname(path),
    checksumSha256: inspected.checksumSha256, technicalMetadata: inspected.metadata,
    candidateMetadata: { title, recordingTitle: 'Local fixture inspection', creator: 'Aby test signal' },
    provenance: {
      method: 'calculated', source: 'bundled-phase-0-fixture', actorId: ownerId,
      tool: 'ffprobe + sha256', toolVersion: inspected.toolVersion,
      parameters: { ffprobeTimeoutMs: config.FFPROBE_TIMEOUT_MS }, timestamp: new Date().toISOString(),
      sourceAssetChecksum: inspected.checksumSha256, reviewState: 'candidate'
    },
    status: 'candidate', createdAt: new Date().toISOString()
  };
  return repository.savePreview(preview);
}

export async function inspectWasabiSource(
  ownerId: string,
  input: SourceIngestPreviewRequest,
  repository: AbyRepository
): Promise<IngestPreview> {
  const config = readConfig();
  if (!config.wasabiConfigured) throw new AbyError('wasabi_not_configured', 'Wasabi credentials are not configured for Aby', 503);
  if (input.analyze) throw new AbyError('analysis_not_available', 'MIR analysis is not part of the first bounded adoption', 400);
  const sourceObjectKey = assertSourceObjectKey(input.sourceObjectKey, [config.sourceAudioPrefix, config.sourceVideoPrefix]);
  const expectedSourcePrefix = input.mediaKind === 'aud' ? config.sourceAudioPrefix : config.sourceVideoPrefix;
  if (!sourceObjectKey.startsWith(expectedSourcePrefix)) {
    throw new AbyError('source_media_mismatch', `${input.mediaKind} sources must remain below ${expectedSourcePrefix}`, 400);
  }

  const siblingKeys = await listWasabiSiblingKeys(sourceObjectKey);
  if (!siblingKeys.includes(sourceObjectKey)) {
    throw new AbyError('unsupported_source_media', 'The selected source is not a supported audio or video file', 400);
  }

  // Detect if there's a companion CUE sheet in the directory
  let cueKey = siblingKeys.find(key => extname(key).toLowerCase() === '.cue');
  let activeSourceObjectKey = sourceObjectKey;
  if (cueKey && extname(sourceObjectKey).toLowerCase() !== '.cue') {
    console.log(`[CUE] Companion CUE sheet detected at ${cueKey}. Swapping to parse CUE.`);
    activeSourceObjectKey = cueKey;
  }
  const isCue = extname(activeSourceObjectKey).toLowerCase() === '.cue';

  const directory = await mkdtemp(join(tmpdir(), 'aby-source-preview-'));
  try {
    let mainHead;
    let mainInspected;
    let cueInfo: ReturnType<typeof parseCueContent> | null = null;
    let mainAudioKey = '';

    if (isCue) {
      // 1. Download and parse CUE
      const cueLocalPath = join(directory, 'main.cue');
      await downloadWasabiSourceObject(activeSourceObjectKey, cueLocalPath);
      const cueContent = await readFile(cueLocalPath, 'utf-8');
      cueInfo = parseCueContent(cueContent);

      // Find the companion audio file
      const companionFilename = cueInfo.file.trim();
      const exactMatch = siblingKeys.find(key => basename(key).toLowerCase() === companionFilename.toLowerCase());
      const fallbackAudio = siblingKeys.find(key => ['.ape', '.flac', '.wav', '.mp3', '.m4a', '.ogg'].includes(extname(key).toLowerCase()));
      mainAudioKey = exactMatch || fallbackAudio || '';
      if (!mainAudioKey) {
        throw new AbyError('cue_missing_audio', `The audio file "${companionFilename}" referenced in the CUE sheet was not found in the directory`, 400);
      }

      mainHead = await headWasabiSourceObject(mainAudioKey);
      if (!mainHead.sizeBytes || mainHead.sizeBytes > config.ABY_INGEST_MAX_SOURCE_BYTES) {
        throw new AbyError('source_size_out_of_bounds', `Audio source must be between 1 and ${config.ABY_INGEST_MAX_SOURCE_BYTES} bytes`, 413);
      }
      const audioLocalPath = join(directory, `main${extname(mainAudioKey).toLowerCase()}`);
      await downloadWasabiSourceObject(mainAudioKey, audioLocalPath);
      mainInspected = await inspectLocalAsset(audioLocalPath, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });
    } else {
      mainAudioKey = sourceObjectKey;
      mainHead = await headWasabiSourceObject(sourceObjectKey);
      if (!mainHead.sizeBytes || mainHead.sizeBytes > config.ABY_INGEST_MAX_SOURCE_BYTES) {
        throw new AbyError('source_size_out_of_bounds', `Source must be between 1 and ${config.ABY_INGEST_MAX_SOURCE_BYTES} bytes`, 413);
      }
      const mainLocalPath = join(directory, `main${extname(sourceObjectKey).toLowerCase()}`);
      await downloadWasabiSourceObject(sourceObjectKey, mainLocalPath);
      mainInspected = await inspectLocalAsset(mainLocalPath, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });
    }

    let identification = null;
    if (input.mediaKind === 'aud') {
      if (isCue && cueInfo) {
        console.log(`[CUE] Performing MusicBrainz metadata lookup for album: ${cueInfo.title} by ${cueInfo.performer}`);
        identification = await identifyWithMusicBrainz({
          creator: cueInfo.performer,
          workTitle: cueInfo.title,
          durationMs: mainInspected.metadata.durationMs
        });
      } else {
        console.log(`[AcoustID] Extracting fingerprint for ${sourceObjectKey}...`);
        const fp = await getAudioFingerprint(join(directory, `main${extname(mainAudioKey).toLowerCase()}`), config.FPCALC_PATH);
        if (fp) {
          console.log(`[AcoustID] Looking up fingerprint...`);
          const acoustidRes = await lookupAcoustID(fp.duration, fp.fingerprint, config.ACOUSTID_CLIENT_API_KEY);
          const recordingId = acoustidRes?.results?.[0]?.recordings?.[0]?.id;
          if (recordingId) {
            console.log(`[AcoustID] Matched MusicBrainz Recording ID: ${recordingId}`);
            identification = await identifyWithMusicBrainzRecordingId(recordingId, mainInspected.metadata.durationMs);
          }
        }
        if (!identification) {
          console.log(`[AcoustID] No match. Falling back to metadata text search.`);
          identification = await identifyWithMusicBrainz({
            creator: input.creatorDisplay,
            workTitle: input.workTitle,
            durationMs: mainInspected.metadata.durationMs
          });
        }
      }
    }

    const embeddedTags = mainInspected.metadata.tags;
    const embeddedTag = (...names: string[]) => {
      const wanted = new Set(names.map((name) => name.toLowerCase()));
      const entry = Object.entries(embeddedTags).find(([name]) => wanted.has(name.toLowerCase()));
      return entry?.[1] ? repairLegacyDiacritics(entry[1]).trim() || undefined : undefined;
    };
    const embeddedAlbumTitle = embeddedTag('album');
    const embeddedArtist = embeddedTag('album_artist', 'albumartist', 'artist');
    const embeddedReleaseDate = embeddedTag('date', 'year');
    
    const rawCreator = identification?.artistName || cueInfo?.performer || input.creatorDisplay;
    const creator = repairLegacyDiacritics(rawCreator);
    const albumArtist = identification
      ? creator
      : (embeddedArtist && !embeddedArtist.includes('\uFFFD') ? embeddedArtist : creator);
    const workTitle = repairLegacyDiacritics(input.workTitle);
    const entitySlug = composerSurnameSlug(creator);

    const wikidata = creator ? await fetchWikidataEntity(creator) : null;
    const rawAlbumTitle = identification?.releaseTitle || cueInfo?.title || embeddedAlbumTitle
      || (siblingKeys.length > 1 ? basename(dirname(sourceObjectKey)) : undefined);
    const albumTitle = rawAlbumTitle ? repairLegacyDiacritics(rawAlbumTitle) : undefined;
    const trackContext = { creator, albumTitle };
    
    const parsedMainTrack = parseTrackFilename(basename(sourceObjectKey), trackContext);
    const requestedTrack = input.recordingTitle ? parseTrackFilename(`${input.recordingTitle}${extname(sourceObjectKey)}`, trackContext) : null;
    const recordingTitle = repairLegacyDiacritics(identification?.recordingTitle || requestedTrack?.title || parsedMainTrack.title || input.workTitle);
    const releaseDate = identification?.releaseDate || embeddedReleaseDate;
    const alternativeCover = !identification?.cover && albumArtist && albumTitle
      ? await findAlbumArtwork({ creator: albumArtist, albumTitle }).catch((error: unknown) => {
          console.warn('[CoverArt] Release-group fallback unavailable:', error instanceof Error ? error.message : 'unknown error');
          return null;
        })
      : null;
    const cover = identification?.cover ?? alternativeCover;
    const recordingFolder = recordingFolderName({
      ...(releaseDate ? { releaseDate } : {}),
      ...(identification?.label ? { label: identification.label } : {}),
      fallback: albumTitle || recordingTitle
    });
    
    const canonicalPrefix = input.mediaKind === 'aud' ? config.audioPrefix : config.videoPrefix;
    const albumFolder = albumSlug(albumTitle || workTitle);
    
    const targetObjectKey = normalizeObjectKey([
      canonicalPrefix.replace(/\/$/, ''),
      input.collectionCode,
      entitySlug,
      albumFolder,
      isCue ? `${albumFolder}.flac` : parsedMainTrack.filename
    ].join('/'));
    
    const identificationCandidates = identification ? [{
      authority: 'musicbrainz',
      entityType: 'recording',
      externalId: identification.recordingId,
      title: identification.recordingTitle,
      score: identification.score,
      canonicalUrl: `https://musicbrainz.org/recording/${identification.recordingId}`,
      metadata: {
        artistId: identification.artistId,
        artistName: identification.artistName,
        recordingLengthMs: identification.recordingLengthMs,
        releaseId: identification.releaseId,
        releaseTitle: identification.releaseTitle,
        releaseDate: identification.releaseDate,
        releaseCountry: identification.releaseCountry,
        releaseGroupId: identification.releaseGroupId,
        label: identification.label,
        labelId: identification.labelId,
        catalogNumber: identification.catalogNumber
      }
    }] : [];
    
    const imageCandidates = cover ? [{
      authority: 'cover-art-archive',
      url: cover.url,
      kind: 'feature' as const,
      exactRelease: cover.exactRelease,
      sourceId: cover.sourceId,
      provenance: {
        musicBrainzReleaseId: identification?.releaseId,
        sourceRelease: cover.sourceRelease,
        fallback: cover.exactRelease ? 'exact-release' : 'release-group-search'
      }
    }] : [];

    // 2. Build tracks array
    const tracks = [];
    if (isCue && cueInfo) {
      const totalDurationMs = mainInspected.metadata.durationMs;
      for (let i = 0; i < cueInfo.tracks.length; i++) {
        const track = cueInfo.tracks[i]!;
        const nextTrack = cueInfo.tracks[i + 1];
        const startMs = track.startMs;
        const endMs = nextTrack ? nextTrack.startMs : totalDurationMs;
        const durationMs = endMs - startMs;
        
        const cleanTrackTitle = track.title || `Track ${track.trackNumber}`;
        const canonicalFilename = `${String(track.trackNumber).padStart(2, '0')}-${albumSlug(cleanTrackTitle)}.flac`;
        
        const siblingTargetObjectKey = normalizeObjectKey([
          canonicalPrefix.replace(/\/$/, ''),
          input.collectionCode,
          entitySlug,
          albumFolder,
          canonicalFilename
        ].join('/'));

        tracks.push({
          objectKey: mainAudioKey,
          sourceObjectKey: activeSourceObjectKey,
          canonicalObjectKey: siblingTargetObjectKey,
          originalFilename: `${basename(mainAudioKey)}#track${track.trackNumber}`,
          checksumSha256: mainInspected.checksumSha256,
          technicalMetadata: {
            ...mainInspected.metadata,
            durationMs,
            formatName: 'flac',
            formatLongName: 'FLAC (Free Lossless Audio Codec)',
            sizeBytes: Math.round((durationMs / totalDurationMs) * (mainHead.sizeBytes || 0))
          },
          recordingTitle: cleanTrackTitle,
          trackNumber: track.trackNumber,
          segmentStartMs: startMs,
          segmentEndMs: endMs,
          sourceCueKey: activeSourceObjectKey
        });
      }
    } else {
      for (const siblingKey of siblingKeys) {
        if (extname(siblingKey).toLowerCase() === '.cue') continue; // Skip CUE files in regular mode
        
        let siblingInspected;
        let siblingSizeBytes;
        
        if (siblingKey === sourceObjectKey) {
          siblingInspected = mainInspected;
          siblingSizeBytes = mainHead.sizeBytes;
        } else {
          const siblingHead = await headWasabiSourceObject(siblingKey);
          siblingSizeBytes = siblingHead.sizeBytes;
          
          if (siblingSizeBytes && siblingSizeBytes <= config.ABY_INGEST_MAX_SOURCE_BYTES) {
            const siblingLocalPath = join(directory, `${randomUUID()}${extname(siblingKey).toLowerCase()}`);
            await downloadWasabiSourceObject(siblingKey, siblingLocalPath);
            siblingInspected = await inspectLocalAsset(siblingLocalPath, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });
          }
        }
        
        if (siblingInspected) {
          const parsedTrack = parseTrackFilename(basename(siblingKey), trackContext);
          
          const siblingTargetObjectKey = normalizeObjectKey([
            canonicalPrefix.replace(/\/$/, ''),
            input.collectionCode,
            entitySlug,
            albumFolder,
            parsedTrack.filename
          ].join('/'));

          tracks.push({
            objectKey: siblingKey,
            canonicalObjectKey: siblingTargetObjectKey,
            originalFilename: basename(siblingKey),
            checksumSha256: siblingInspected.checksumSha256,
            technicalMetadata: { ...siblingInspected.metadata, sizeBytes: siblingSizeBytes },
            recordingTitle: parsedTrack.title,
            ...(parsedTrack.trackNumber !== undefined ? { trackNumber: parsedTrack.trackNumber } : {})
          });
        }
      }
    }

    tracks.sort((left, right) =>
      (left.trackNumber ?? Number.MAX_SAFE_INTEGER) - (right.trackNumber ?? Number.MAX_SAFE_INTEGER)
      || left.originalFilename.localeCompare(right.originalFilename, undefined, { numeric: true })
    );

    const preview: IngestPreview = {
      id: randomUUID(),
      ownerId,
      provider: 'wasabi',
      bucket: config.WASABI_BUCKET,
      objectKey: activeSourceObjectKey,
      originalFilename: basename(activeSourceObjectKey),
      originalDirectory: dirname(activeSourceObjectKey),
      checksumSha256: mainInspected.checksumSha256,
      technicalMetadata: { ...mainInspected.metadata, sizeBytes: mainHead.sizeBytes },
      candidateMetadata: {
        title: workTitle,
        recordingTitle,
        ...(albumTitle ? { albumTitle } : {}),
        ...(parsedMainTrack.trackNumber !== undefined ? { trackNumber: parsedMainTrack.trackNumber } : {}),
        recordingFolder,
        creator,
        albumArtist,
        ...(releaseDate ? { releaseDate } : {}),
        ...(identification?.label ? { label: identification.label } : {}),
        ...(identification?.catalogNumber ? { catalogNumber: identification.catalogNumber } : {}),
        entitySlug,
        collectionCode: input.collectionCode,
        canonicalObjectKey: targetObjectKey,
        identificationCandidates,
        imageCandidates,
        ...(wikidata ? { wikidata } : {}),
        tracks
      },
      provenance: {
        method: 'calculated',
        source: `wasabi:${config.wasabiRootPrefix}${activeSourceObjectKey}`,
        actorId: ownerId,
        tool: identification ? 'sha256 + ffprobe + MusicBrainz' : 'sha256 + ffprobe',
        toolVersion: mainInspected.toolVersion,
        parameters: {
          sourceObjectKey: activeSourceObjectKey,
          proposedObjectKey: targetObjectKey,
          analyze: false,
          ffprobeTimeoutMs: config.FFPROBE_TIMEOUT_MS
        },
        timestamp: new Date().toISOString(),
        sourceAssetChecksum: mainInspected.checksumSha256,
        confidence: identification?.score,
        reviewState: 'candidate'
      },
      status: 'candidate',
      createdAt: new Date().toISOString()
    };
    return repository.savePreview(preview);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
