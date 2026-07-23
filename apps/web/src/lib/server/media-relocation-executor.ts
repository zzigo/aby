import { copyOne } from './av-operations';
import { getAvRepository } from './av-repository';
import { AbyError } from './errors';
import { getMediaRelocationRepository, type MediaRelocationFile } from './media-relocation-repository';
import { getRepository } from './repository';
import { checksumWasabiRelocationObject, deleteWasabiRelocationSource } from './storage';

const running = new Set<string>();

function now() {
  return new Date().toISOString();
}

async function applyAuthoritySwitch(ownerId: string, operationId: string) {
  const operations = getMediaRelocationRepository();
  const operation = await operations.get(ownerId, operationId);
  if (!operation) throw new AbyError('relocation_not_found', 'Storage relocation not found', 404);
  if (operation.mediaKind === 'audio') {
    const repository = getRepository();
    for (const file of operation.files.filter((candidate) => candidate.role === 'media')) {
      if (!file.assetId) throw new AbyError('relocation_asset_missing', 'Audio relocation file has no asset', 500);
      await repository.relocateAsset(
        ownerId, file.assetId, file.sourceObjectKey, file.destinationObjectKey,
        operation.collectionCode!, operation.entitySlug
      );
    }
    const replacements = new Map(operation.files.filter((file) => file.role === 'booklet')
      .map((file) => [file.sourceObjectKey, file.destinationObjectKey]));
    if (replacements.size) {
      const catalog = await repository.listCatalog(ownerId);
      const items = catalog.filter((item) => (item.albumId ?? item.asset.workId) === operation.entityId);
      for (const item of items) {
        const bookletPages = item.asset.canonicalMetadata.bookletPages?.map((page) => ({
          ...page, objectKey: replacements.get(page.objectKey) ?? page.objectKey
        }));
        if (bookletPages) await repository.mergeCanonicalMetadata(ownerId, item.asset.id, { bookletPages });
      }
    }
    return;
  }
  const repository = getAvRepository();
  const item = await repository.getItem(ownerId, operation.entityId);
  if (!item) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const mediaDestination = operation.files.find((file) => file.role === 'media')?.destinationObjectKey
    ?? item.destinationObjectKey;
  const legacy = (await repository.listOperations(ownerId))
    .find((candidate) => candidate.avItemId === operation.entityId && candidate.state === 'pending');
  if (legacy) {
    await repository.updatePendingDestination(ownerId, legacy.id, mediaDestination);
    await repository.updateOperation(ownerId, legacy.id, {
      state: 'succeeded', transferredBytes: legacy.sizeBytes, speedBytesPerSecond: 0,
      etaSeconds: 0, beaconAt: now(), finishedAt: now()
    });
  }
  await repository.setItemState(ownerId, operation.entityId, 'available');
}

export async function executeMediaRelocation(ownerId: string, operationId: string): Promise<void> {
  const repository = getMediaRelocationRepository();
  const operation = await repository.get(ownerId, operationId);
  if (!operation) throw new AbyError('relocation_not_found', 'Storage relocation not found', 404);
  if (running.has(operationId) || ['copying', 'verifying', 'retiring'].includes(operation.state)) {
    throw new AbyError('relocation_running', 'This storage relocation is already running', 409);
  }
  if (!['draft', 'failed'].includes(operation.state)) {
    throw new AbyError('relocation_not_executable', 'Only planned or failed relocations can be executed', 409);
  }
  running.add(operationId);
  await repository.update(ownerId, operationId, {
    state: 'copying', stage: 'copying', startedAt: now(), beaconAt: now(),
    error: undefined, transferredBytes: 0, speedBytesPerSecond: 0
  });
  void (async () => {
    let completedBytes = 0;
    let files: MediaRelocationFile[] = operation.files.map((file) => ({ ...file, state: 'planned', error: undefined }));
    let updateChain = Promise.resolve();
    try {
      for (let index = 0; index < files.length; index += 1) {
        files[index] = { ...files[index]!, state: 'copying' };
        await repository.update(ownerId, operationId, { files, stage: `copying ${index + 1}/${files.length}`, beaconAt: now() });
        const file = files[index]!;
        await copyOne(file.sourceObjectKey, file.destinationObjectKey, completedBytes, (progress) => {
          updateChain = updateChain.then(() => repository.update(ownerId, operationId, {
            ...progress, files, beaconAt: now()
          })).then(() => undefined).catch(() => undefined);
        });
        completedBytes += file.sizeBytes;
        files[index] = { ...file, state: 'copied' };
      }
      await updateChain;
      await repository.update(ownerId, operationId, {
        state: 'verifying', stage: 'verifying checksums', files, transferredBytes: completedBytes,
        speedBytesPerSecond: 0, etaSeconds: 0, beaconAt: now()
      });
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        files[index] = { ...file, state: 'verifying' };
        await repository.update(ownerId, operationId, { files, stage: `verifying ${index + 1}/${files.length}`, beaconAt: now() });
        const source = await checksumWasabiRelocationObject(file.sourceObjectKey);
        const destination = await checksumWasabiRelocationObject(file.destinationObjectKey);
        if (source.sizeBytes !== destination.sizeBytes || source.checksumSha256 !== destination.checksumSha256) {
          throw new AbyError('relocation_verification_failed', `Checksum verification failed for ${file.destinationObjectKey}`, 409);
        }
        if (file.expectedChecksumSha256 && source.checksumSha256 !== file.expectedChecksumSha256) {
          throw new AbyError('relocation_source_changed', `Source bytes changed for ${file.sourceObjectKey}`, 409);
        }
        files[index] = {
          ...file, sizeBytes: source.sizeBytes, sourceChecksumSha256: source.checksumSha256,
          destinationChecksumSha256: destination.checksumSha256, state: 'verified'
        };
      }
      await repository.update(ownerId, operationId, { files, stage: 'switching catalog authority', beaconAt: now() });
      await applyAuthoritySwitch(ownerId, operationId);
      await repository.update(ownerId, operationId, {
        state: 'retirement_pending', stage: 'verified; source retained', files,
        transferredBytes: operation.sizeBytes, speedBytesPerSecond: 0, etaSeconds: 0,
        beaconAt: now(), verifiedAt: now(), error: undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Storage relocation failed';
      files = files.map((file) => file.state === 'copying' || file.state === 'verifying'
        ? { ...file, state: 'failed', error: message } : file);
      await repository.update(ownerId, operationId, {
        state: 'failed', stage: 'failed', files, beaconAt: now(), finishedAt: now(), error: message
      });
      if (operation.mediaKind === 'video') await getAvRepository().setItemState(ownerId, operation.entityId, 'failed').catch(() => undefined);
    } finally {
      running.delete(operationId);
    }
  })();
}

export async function retireMediaRelocation(ownerId: string, operationId: string): Promise<void> {
  const operations = getMediaRelocationRepository();
  const operation = await operations.get(ownerId, operationId);
  if (!operation) throw new AbyError('relocation_not_found', 'Storage relocation not found', 404);
  if (operation.state !== 'retirement_pending') {
    throw new AbyError('relocation_not_retirable', 'Only fully verified relocations can retire their sources', 409);
  }
  await operations.update(ownerId, operationId, { state: 'retiring', stage: 're-verifying before delete', beaconAt: now() });
  const repository = getRepository();
  try {
    const files = [...operation.files];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      if (file.state === 'retired') continue;
      const source = await checksumWasabiRelocationObject(file.sourceObjectKey);
      const destination = await checksumWasabiRelocationObject(file.destinationObjectKey);
      if (!file.sourceChecksumSha256 || source.checksumSha256 !== file.sourceChecksumSha256
        || destination.checksumSha256 !== file.sourceChecksumSha256 || source.sizeBytes !== destination.sizeBytes) {
        throw new AbyError('retirement_verification_failed', `Source or destination changed for ${file.sourceObjectKey}`, 409);
      }
      if (operation.mediaKind === 'audio' && await repository.objectKeyInUse(file.sourceObjectKey)) {
        throw new AbyError('retirement_source_in_use', `Catalog still references ${file.sourceObjectKey}`, 409);
      }
      await deleteWasabiRelocationSource(file.sourceObjectKey);
      files[index] = { ...file, state: 'retired' };
      if (operation.mediaKind === 'audio' && file.assetId) {
        const item = await repository.getCatalogItem(ownerId, file.assetId);
        if (item) {
          const candidates = (item.asset.canonicalMetadata.storageRetirementCandidates ?? []).map((candidate) =>
            candidate.sourceObjectKey === file.sourceObjectKey && candidate.targetObjectKey === file.destinationObjectKey
              ? { ...candidate, state: 'retired' as const, retiredAt: now() }
              : candidate
          );
          await repository.mergeCanonicalMetadata(ownerId, file.assetId, { storageRetirementCandidates: candidates });
        }
      }
      await operations.update(ownerId, operationId, { files, stage: `retiring ${index + 1}/${files.length}`, beaconAt: now() });
    }
    await operations.update(ownerId, operationId, {
      state: 'succeeded', stage: 'source retired', files,
      beaconAt: now(), finishedAt: now(), error: undefined
    });
  } catch (error) {
    await operations.update(ownerId, operationId, {
      state: 'retirement_pending', stage: 'retirement stopped; verified sources retained where possible', beaconAt: now(),
      error: error instanceof Error ? error.message : 'Retirement failed'
    });
    throw error;
  }
}
