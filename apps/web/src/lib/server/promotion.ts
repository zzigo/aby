import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256File, inspectLocalAsset } from '@zztt/aby-media-ingest';
import { AbyError } from './errors';
import { readConfig } from './config';
import type { AbyRepository } from './repository';
import {
  copyWasabiSourceToCanonical,
  deleteWasabiCanonicalObject,
  downloadWasabiObject,
  headWasabiSourceObject,
  uploadWasabiArtifact
} from './storage';

const execAsync = promisify(exec);

async function runFfmpegSplit(ffmpegPath: string, inputPath: string, startMs: number, durationMs: number, outputPath: string) {
  const startSec = startMs / 1000;
  const durationSec = durationMs / 1000;
  const cmd = `"${ffmpegPath}" -y -ss ${startSec} -t ${durationSec} -i "${inputPath}" -c:a flac "${outputPath}"`;
  console.log(`[FFMPEG] Executing split: ${cmd}`);
  await execAsync(cmd);
}

export async function promoteIngestCandidate(ownerId: string, previewId: string, repository: AbyRepository) {
  const config = readConfig();
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
  const localParentFiles = new Map<string, string>();
  const directory = await mkdtemp(join(tmpdir(), 'aby-promotion-verify-'));

  try {
    for (const track of tracks) {
      if (track.segmentStartMs !== undefined && track.segmentEndMs !== undefined) {
        // 1. Split track segment from parent audio using ffmpeg
        let localParentPath = localParentFiles.get(track.objectKey);
        if (!localParentPath) {
          const parentHead = await headWasabiSourceObject(track.objectKey);
          if (!parentHead.sizeBytes) {
            throw new AbyError('source_changed', `Parent audio file size changed or missing for ${track.objectKey}`, 409);
          }
          localParentPath = join(directory, `parent-${randomUUID()}${extname(track.objectKey).toLowerCase()}`);
          await downloadWasabiObject(track.objectKey, localParentPath);
          localParentFiles.set(track.objectKey, localParentPath);
        }

        const tempSplitPath = join(directory, `${randomUUID()}.flac`);
        const durationMs = track.segmentEndMs - track.segmentStartMs;
        
        await runFfmpegSplit(
          config.FFMPEG_PATH,
          localParentPath,
          track.segmentStartMs,
          durationMs,
          tempSplitPath
        );

        const checksum = await sha256File(tempSplitPath);
        const sizeBytes = (await stat(tempSplitPath)).size;
        const splitInspected = await inspectLocalAsset(tempSplitPath, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });

        await uploadWasabiArtifact(track.canonicalObjectKey, tempSplitPath, 'audio/flac');
        copiesCreated.push(track.canonicalObjectKey);

        promotedTracks.push({
          ...track,
          sourceObjectKey: track.sourceObjectKey ?? track.objectKey,
          objectKey: track.canonicalObjectKey,
          checksumSha256: checksum,
          technicalMetadata: {
            ...splitInspected.metadata,
            sizeBytes
          }
        });
      } else {
        // 2. Regular full file promotion
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
