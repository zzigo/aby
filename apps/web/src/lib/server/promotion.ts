import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
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

  const tracks = preview.candidateMetadata.tracks || [{
    objectKey: preview.objectKey,
    canonicalObjectKey: targetObjectKey,
    checksumSha256: preview.checksumSha256,
    technicalMetadata: preview.technicalMetadata,
    recordingTitle: preview.candidateMetadata.recordingTitle,
    sourceObjectKey: undefined
  }];

  const promotedTracks = [];
  const copiesCreated = [];
  const directory = await mkdtemp(join(tmpdir(), 'aby-promotion-verify-'));

  try {
    for (const track of tracks) {
      if (track.objectKey === track.canonicalObjectKey) {
        promotedTracks.push(track);
        continue;
      }

      const sourceHead = await headWasabiSourceObject(track.objectKey);
      if (!sourceHead.sizeBytes || sourceHead.sizeBytes !== track.technicalMetadata.sizeBytes) {
        throw new AbyError('source_changed', `Source size changed after preview for track ${track.objectKey}`, 409);
      }

      const copy = await copyWasabiSourceToCanonical(track.objectKey, track.canonicalObjectKey);
      if (copy.created) copiesCreated.push(track.canonicalObjectKey);

      if (copy.head.sizeBytes !== sourceHead.sizeBytes) {
        throw new AbyError('promotion_size_mismatch', `Canonical copy size mismatch for ${track.canonicalObjectKey}`, 502);
      }

      const localPath = join(directory, `${randomUUID()}${extname(track.canonicalObjectKey).toLowerCase()}`);
      await downloadWasabiObject(track.canonicalObjectKey, localPath);
      const checksum = await sha256File(localPath);
      if (checksum !== track.checksumSha256) {
        throw new AbyError('promotion_checksum_mismatch', `Canonical copy checksum mismatch for ${track.canonicalObjectKey}`, 502);
      }

      promotedTracks.push({
        ...track,
        sourceObjectKey: track.sourceObjectKey ?? track.objectKey,
        objectKey: track.canonicalObjectKey
      });
    }

    const updatedMetadata = {
      ...preview.candidateMetadata,
      canonicalObjectKey: targetObjectKey,
      tracks: promotedTracks
    };

    const promoted = await repository.markPreviewPromoted(ownerId, previewId, preview.objectKey, targetObjectKey, updatedMetadata);
    
    return {
      preview: promoted,
      sourceRetirement: { objectKey: preview.objectKey, state: 'candidate' as const }
    };

  } catch (error) {
    for (const targetKey of copiesCreated) {
      await deleteWasabiCanonicalObject(targetKey).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
