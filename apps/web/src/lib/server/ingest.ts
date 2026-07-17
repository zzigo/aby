import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { IngestPreview } from '@zztt/aby-domain';
import { inspectLocalAsset } from '@zztt/aby-media-ingest';
import { AbyError } from './errors';
import { readConfig } from './config';
import type { AbyRepository } from './repository';

export async function inspectFixture(ownerId: string, repository: AbyRepository): Promise<IngestPreview> {
  const config = readConfig();
  if (!config.demoMode) throw new AbyError('fixture_disabled', 'The local fixture is available only in demo mode', 403);
  const path = fileURLToPath(new URL('../../../static/demo/aby-phase-0.wav', import.meta.url));
  const inspected = await inspectLocalAsset(path, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });
  const title = inspected.metadata.tags.title || 'Phase 0 sine study';
  const preview: IngestPreview = {
    id: randomUUID(), ownerId, provider: 'local-fixture',
    objectKey: 'aby/media/originals/fixture/aby-phase-0.wav',
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

