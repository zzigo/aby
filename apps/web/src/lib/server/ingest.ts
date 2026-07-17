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
import { identifyWithMusicBrainz } from './musicbrainz';
import { fetchWikidataEntity } from './wikidata';
import type { AbyRepository } from './repository';
import { assertSourceObjectKey, downloadWasabiSourceObject, headWasabiSourceObject, normalizeObjectKey } from './storage';

function pathSegment(value: string): string {
  const segment = value.normalize('NFC').replace(/\p{Cc}/gu, '').replaceAll('/', '／').trim();
  if (!segment || segment === '.' || segment === '..') throw new AbyError('invalid_catalog_path', 'Catalog path segments cannot be empty', 400);
  return segment;
}

function assetFilename(workTitle: string, originalFilename: string): string {
  return `${pathSegment(workTitle)}${extname(originalFilename).toLowerCase()}`;
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
  const head = await headWasabiSourceObject(sourceObjectKey);
  if (!head.sizeBytes || head.sizeBytes > config.ABY_INGEST_MAX_SOURCE_BYTES) {
    throw new AbyError('source_size_out_of_bounds', `Source must be between 1 and ${config.ABY_INGEST_MAX_SOURCE_BYTES} bytes`, 413);
  }
  const directory = await mkdtemp(join(tmpdir(), 'aby-source-preview-'));
  const localPath = join(directory, `source${extname(sourceObjectKey).toLowerCase()}`);
  try {
    await downloadWasabiSourceObject(sourceObjectKey, localPath);
    const inspected = await inspectLocalAsset(localPath, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });
    const identification = input.mediaKind === 'aud'
      ? await identifyWithMusicBrainz({ creator: input.creatorDisplay, workTitle: input.workTitle, durationMs: inspected.metadata.durationMs })
      : null;
    const wikidata = input.creatorDisplay ? await fetchWikidataEntity(input.creatorDisplay) : null;
    const recordingTitle = input.recordingTitle || identification?.recordingTitle || input.workTitle;
    const recordingFolder = recordingFolderName({
      ...(identification?.releaseDate ? { releaseDate: identification.releaseDate } : {}),
      ...(identification?.label ? { label: identification.label } : {}),
      fallback: recordingTitle
    });
    const canonicalPrefix = input.mediaKind === 'aud' ? config.audioPrefix : config.videoPrefix;
    const targetObjectKey = normalizeObjectKey([
      canonicalPrefix.replace(/\/$/, ''),
      input.collectionCode,
      input.entitySlug,
      pathSegment(input.workTitle),
      pathSegment(recordingFolder),
      assetFilename(input.workTitle, basename(sourceObjectKey))
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
    const imageCandidates = identification?.cover ? [{
      authority: 'cover-art-archive',
      url: identification.cover.url,
      kind: 'feature' as const,
      exactRelease: identification.cover.exactRelease,
      sourceId: identification.cover.sourceId,
      provenance: {
        musicBrainzReleaseId: identification.releaseId,
        sourceRelease: identification.cover.sourceRelease,
        fallback: identification.cover.exactRelease ? 'exact-release' : 'release-group'
      }
    }] : [];
    const preview: IngestPreview = {
      id: randomUUID(),
      ownerId,
      provider: 'wasabi',
      bucket: config.WASABI_BUCKET,
      objectKey: sourceObjectKey,
      originalFilename: basename(sourceObjectKey),
      originalDirectory: dirname(sourceObjectKey),
      checksumSha256: inspected.checksumSha256,
      technicalMetadata: { ...inspected.metadata, sizeBytes: head.sizeBytes },
      candidateMetadata: {
        title: input.workTitle,
        recordingTitle,
        recordingFolder,
        creator: input.creatorDisplay,
        ...(identification?.releaseDate ? { releaseDate: identification.releaseDate } : {}),
        ...(identification?.label ? { label: identification.label } : {}),
        ...(identification?.catalogNumber ? { catalogNumber: identification.catalogNumber } : {}),
        entitySlug: input.entitySlug,
        collectionCode: input.collectionCode,
        canonicalObjectKey: targetObjectKey,
        identificationCandidates,
        imageCandidates,
        ...(wikidata ? { wikidata } : {})
      },
      provenance: {
        method: 'calculated',
        source: `wasabi:${config.wasabiRootPrefix}${sourceObjectKey}`,
        actorId: ownerId,
        tool: identification ? 'sha256 + ffprobe + MusicBrainz' : 'sha256 + ffprobe',
        toolVersion: inspected.toolVersion,
        parameters: {
          sourceObjectKey,
          proposedObjectKey: targetObjectKey,
          analyze: false,
          ffprobeTimeoutMs: config.FFPROBE_TIMEOUT_MS
        },
        timestamp: new Date().toISOString(),
        sourceAssetChecksum: inspected.checksumSha256,
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
