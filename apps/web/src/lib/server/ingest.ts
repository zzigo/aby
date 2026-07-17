import { mkdtemp, rm } from 'node:fs/promises';
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

function pathSegment(value: string): string {
  const segment = value.normalize('NFC').replace(/\p{Cc}/gu, '').replaceAll('/', '／').trim();
  if (!segment || segment === '.' || segment === '..') throw new AbyError('invalid_catalog_path', 'Catalog path segments cannot be empty', 400);
  return segment;
}

export function parseTrackFilename(originalFilename: string): { title: string; trackNumber?: number; filename: string } {
  const ext = extname(originalFilename).toLowerCase();
  const base = basename(originalFilename, extname(originalFilename));
  const match = base.match(/^\s*(\d{1,3})(?:\s*[.\-_]+\s*|\s+)(.+?)\s*$/u);
  const trackNumber = match ? Number(match[1]) : undefined;
  const title = pathSegment((match?.[2] ?? base).replace(/\s+/g, ' ').trim());
  const prefix = trackNumber === undefined ? '' : `${String(trackNumber).padStart(2, '0')}-`;
  return { title, ...(trackNumber !== undefined ? { trackNumber } : {}), filename: `${prefix}${title}${ext}` };
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

  // A source folder may represent an album. It remains optional: a lone file is a direct Work → Track.
  const siblingKeys = await listWasabiSiblingKeys(sourceObjectKey);
  if (!siblingKeys.includes(sourceObjectKey)) {
    throw new AbyError('unsupported_source_media', 'The selected source is not a supported audio or video file', 400);
  }

  const directory = await mkdtemp(join(tmpdir(), 'aby-source-preview-'));
  try {
    // 1. Inspect the main requested file first
    const mainHead = await headWasabiSourceObject(sourceObjectKey);
    if (!mainHead.sizeBytes || mainHead.sizeBytes > config.ABY_INGEST_MAX_SOURCE_BYTES) {
      throw new AbyError('source_size_out_of_bounds', `Source must be between 1 and ${config.ABY_INGEST_MAX_SOURCE_BYTES} bytes`, 413);
    }
    const mainLocalPath = join(directory, `main${extname(sourceObjectKey).toLowerCase()}`);
    await downloadWasabiSourceObject(sourceObjectKey, mainLocalPath);
    const mainInspected = await inspectLocalAsset(mainLocalPath, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });
    
    let identification = null;
    if (input.mediaKind === 'aud') {
      console.log(`[AcoustID] Extracting fingerprint for ${sourceObjectKey}...`);
      const fp = await getAudioFingerprint(mainLocalPath, config.FPCALC_PATH);
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

    const creator = identification?.artistName || input.creatorDisplay;
    const workTitle = input.workTitle;
    const entitySlug = identification?.artistName
      ? identification.artistName.normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '')
      : input.entitySlug;

    const wikidata = creator ? await fetchWikidataEntity(creator) : null;
    const recordingTitle = identification?.recordingTitle || input.recordingTitle || input.workTitle;
    const albumTitle = identification?.releaseTitle || (siblingKeys.length > 1 ? basename(dirname(sourceObjectKey)) : undefined);
    const alternativeCover = !identification?.cover && creator && albumTitle
      ? await findAlbumArtwork({ creator, albumTitle }).catch((error: unknown) => {
          console.warn('[CoverArt] Release-group fallback unavailable:', error instanceof Error ? error.message : 'unknown error');
          return null;
        })
      : null;
    const cover = identification?.cover ?? alternativeCover;
    const recordingFolder = recordingFolderName({
      ...(identification?.releaseDate ? { releaseDate: identification.releaseDate } : {}),
      ...(identification?.label ? { label: identification.label } : {}),
      fallback: albumTitle || recordingTitle
    });
    const canonicalPrefix = input.mediaKind === 'aud' ? config.audioPrefix : config.videoPrefix;
    
    const parsedMainTrack = parseTrackFilename(basename(sourceObjectKey));
    const targetObjectKey = normalizeObjectKey([
      canonicalPrefix.replace(/\/$/, ''),
      input.collectionCode,
      entitySlug,
      pathSegment(workTitle),
      ...(albumTitle ? [pathSegment(recordingFolder)] : []),
      parsedMainTrack.filename
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

    // 2. Inspect all sibling files (tracks) in the album folder
    const tracks = [];
    for (const siblingKey of siblingKeys) {
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
        const parsedTrack = parseTrackFilename(basename(siblingKey));
        
        const siblingTargetObjectKey = normalizeObjectKey([
          canonicalPrefix.replace(/\/$/, ''),
          input.collectionCode,
          entitySlug,
          pathSegment(workTitle),
          ...(albumTitle ? [pathSegment(recordingFolder)] : []),
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
    tracks.sort((left, right) =>
      (left.trackNumber ?? Number.MAX_SAFE_INTEGER) - (right.trackNumber ?? Number.MAX_SAFE_INTEGER)
      || left.originalFilename.localeCompare(right.originalFilename, undefined, { numeric: true })
    );

    const preview: IngestPreview = {
      id: randomUUID(),
      ownerId,
      provider: 'wasabi',
      bucket: config.WASABI_BUCKET,
      objectKey: sourceObjectKey,
      originalFilename: basename(sourceObjectKey),
      originalDirectory: dirname(sourceObjectKey),
      checksumSha256: mainInspected.checksumSha256,
      technicalMetadata: { ...mainInspected.metadata, sizeBytes: mainHead.sizeBytes },
      candidateMetadata: {
        title: workTitle,
        recordingTitle,
        ...(albumTitle ? { albumTitle } : {}),
        ...(parsedMainTrack.trackNumber !== undefined ? { trackNumber: parsedMainTrack.trackNumber } : {}),
        recordingFolder,
        creator,
        ...(identification?.releaseDate ? { releaseDate: identification.releaseDate } : {}),
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
        source: `wasabi:${config.wasabiRootPrefix}${sourceObjectKey}`,
        actorId: ownerId,
        tool: identification ? 'sha256 + ffprobe + MusicBrainz' : 'sha256 + ffprobe',
        toolVersion: mainInspected.toolVersion,
        parameters: {
          sourceObjectKey,
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
