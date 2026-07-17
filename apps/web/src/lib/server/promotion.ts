import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256File } from '@zztt/aby-media-ingest';
import { AbyError } from './errors';
import type { AbyRepository } from './repository';
import {
  copyWasabiSourceToCanonical,
  deleteWasabiCanonicalObject,
  downloadWasabiObject,
  headWasabiSourceObject
} from './storage';

export async function promoteIngestCandidate(ownerId: string, previewId: string, repository: AbyRepository) {
  const preview = await repository.getPreview(ownerId, previewId);
  if (!preview) throw new AbyError('preview_not_found', 'Ingest preview not found', 404);
  if (preview.status !== 'candidate') throw new AbyError('preview_not_promotable', 'Only candidate previews can be promoted', 409);
  if (preview.provider !== 'wasabi') throw new AbyError('provider_not_promotable', 'This promotion path only accepts Wasabi candidates', 409);
  const targetObjectKey = preview.candidateMetadata.canonicalObjectKey;
  if (!targetObjectKey) throw new AbyError('canonical_key_missing', 'Candidate has no proposed canonical key', 409);
  if (preview.objectKey === targetObjectKey) {
    return {
      preview,
      sourceRetirement: {
        objectKey: String(preview.provenance.parameters.sourceObjectKey ?? preview.objectKey),
        state: 'candidate' as const
      }
    };
  }

  const sourceObjectKey = preview.objectKey;
  const sourceHead = await headWasabiSourceObject(sourceObjectKey);
  if (!sourceHead.sizeBytes || sourceHead.sizeBytes !== preview.technicalMetadata.sizeBytes) {
    throw new AbyError('source_changed', 'Source size changed after preview; inspect it again before promotion', 409);
  }

  const copy = await copyWasabiSourceToCanonical(sourceObjectKey, targetObjectKey);
  const directory = await mkdtemp(join(tmpdir(), 'aby-promotion-verify-'));
  const localPath = join(directory, 'canonical-object');
  try {
    if (copy.head.sizeBytes !== sourceHead.sizeBytes) {
      throw new AbyError('promotion_size_mismatch', 'Canonical copy size does not match the reviewed source', 502);
    }
    await downloadWasabiObject(targetObjectKey, localPath);
    const checksum = await sha256File(localPath);
    if (checksum !== preview.checksumSha256) {
      throw new AbyError('promotion_checksum_mismatch', 'Canonical copy checksum does not match the reviewed source', 502);
    }
    const promoted = await repository.markPreviewPromoted(ownerId, previewId, sourceObjectKey, targetObjectKey);
    return {
      preview: promoted,
      sourceRetirement: { objectKey: sourceObjectKey, state: 'candidate' as const }
    };
  } catch (error) {
    if (copy.created) await deleteWasabiCanonicalObject(targetObjectKey).catch(() => undefined);
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
