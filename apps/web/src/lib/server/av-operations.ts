import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readConfig } from './config';
import { AbyError } from './errors';
import { getAvRepository } from './av-repository';
import { discoverAvSidecars } from './av-inspection';
import { basename, dirname } from 'node:path';

const running = new Set<string>();

function remotePath(root: string, objectKey: string): string {
  return `${root.replace(/\/+$/, '')}/${objectKey.replace(/^\/+/, '')}`;
}

export function progressFromLine(line: string) {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const stats = (parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : parsed) as Record<string, unknown>;
    const transferredBytes = Number(stats.bytes ?? stats.transferredBytes ?? 0);
    const speedBytesPerSecond = Number(stats.speed ?? 0);
    const eta = Number(stats.eta ?? stats.etaSeconds);
    return {
      ...(Number.isFinite(transferredBytes) ? { transferredBytes: Math.max(0, Math.round(transferredBytes)) } : {}),
      ...(Number.isFinite(speedBytesPerSecond) ? { speedBytesPerSecond: Math.max(0, speedBytesPerSecond) } : {}),
      ...(Number.isFinite(eta) && eta >= 0 ? { etaSeconds: Math.round(eta) } : {})
    };
  } catch { return {}; }
}

export function copyOne(source: string, destination: string, completedBytes: number, observe: (progress: ReturnType<typeof progressFromLine>) => void): Promise<void> {
  const config = readConfig();
  return new Promise((resolve, reject) => {
    const child = spawn(config.RCLONE_PATH, [
      'copyto', remotePath(config.RCLONE_WASABI_ROOT, source), remotePath(config.RCLONE_WASABI_ROOT, destination),
      '--no-traverse', '--stats', '1s', '--stats-one-line-json', '--log-level', 'INFO'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let lastError = '';
    const onLine = (line: string) => {
      const progress = progressFromLine(line);
      if (!Object.keys(progress).length) {
        if (/error|failed/i.test(line)) lastError = line.slice(0, 2_000);
        return;
      }
      observe({ ...progress, ...(progress.transferredBytes !== undefined ? { transferredBytes: completedBytes + progress.transferredBytes } : {}) });
    };
    createInterface({ input: child.stdout }).on('line', onLine);
    createInterface({ input: child.stderr }).on('line', onLine);
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(lastError || `rclone exited with code ${code}`)));
  });
}

export async function executeStorageOperation(ownerId: string, operationId: string): Promise<void> {
  const repository = getAvRepository();
  const operation = await repository.getOperation(ownerId, operationId);
  if (!operation) throw new AbyError('operation_not_found', 'Storage operation not found', 404);
  if (running.has(operationId)) throw new AbyError('operation_running', 'Storage operation is already running', 409);
  if (operation.state === 'running' && operation.beaconAt && Date.now() - new Date(operation.beaconAt).getTime() < 30_000) {
    throw new AbyError('operation_running', 'Storage operation has a current process beacon', 409);
  }
  if (operation.state === 'succeeded' || operation.state === 'cancelled') throw new AbyError('operation_not_executable', 'Storage operation is already final', 409);
  const storedItem = await repository.getItem(ownerId, operation.avItemId);
  if (!storedItem) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const item = storedItem.technicalMetadata.sidecarSubtitles ? storedItem : await repository.updateItemTechnicalMetadata(ownerId, storedItem.id, {
    ...storedItem.technicalMetadata,
    sidecarSubtitles: (await discoverAvSidecars(storedItem.sourceObjectKey)).map((sidecar) => ({
      ...sidecar, destinationObjectKey: `${dirname(storedItem.destinationObjectKey)}/${basename(sidecar.sourceObjectKey)}`
    }))
  });
  const totalSizeBytes = item.technicalMetadata.sizeBytes + (item.technicalMetadata.sidecarSubtitles ?? []).reduce((total, subtitle) => total + subtitle.sizeBytes, 0);
  if (operation.sizeBytes !== totalSizeBytes) await repository.updateOperation(ownerId, operationId, { sizeBytes: totalSizeBytes });
  running.add(operationId);
  const startedAt = new Date().toISOString();
  await repository.updateOperation(ownerId, operationId, { state: 'running', startedAt, beaconAt: startedAt, error: undefined });
  await repository.setItemState(ownerId, operation.avItemId, 'copying');

  const files = [
    { source: operation.sourceObjectKey, destination: operation.destinationObjectKey, sizeBytes: item.technicalMetadata.sizeBytes },
    ...(item.technicalMetadata.sidecarSubtitles ?? []).map((subtitle) => ({ source: subtitle.sourceObjectKey, destination: subtitle.destinationObjectKey, sizeBytes: subtitle.sizeBytes }))
  ];
  void (async () => {
    let completedBytes = 0;
    let updateChain = Promise.resolve();
    try {
      for (const file of files) {
        await copyOne(file.source, file.destination, completedBytes, (progress) => {
          updateChain = updateChain.then(() => repository.updateOperation(ownerId, operationId, {
            ...progress, beaconAt: new Date().toISOString()
          })).then(() => undefined).catch(() => undefined);
        });
        completedBytes += file.sizeBytes;
      }
      await updateChain;
      const finishedAt = new Date().toISOString();
      await repository.updateOperation(ownerId, operationId, {
        state: 'succeeded', transferredBytes: totalSizeBytes, speedBytesPerSecond: 0,
        etaSeconds: 0, beaconAt: finishedAt, finishedAt, error: undefined
      });
      await repository.setItemState(ownerId, operation.avItemId, 'available');
    } catch (error) {
      await updateChain;
      const finishedAt = new Date().toISOString();
      await repository.updateOperation(ownerId, operationId, {
        state: 'failed', error: error instanceof Error ? error.message : 'rclone failed', beaconAt: finishedAt, finishedAt
      });
      await repository.setItemState(ownerId, operation.avItemId, 'failed');
    } finally {
      running.delete(operationId);
    }
  })();
}
