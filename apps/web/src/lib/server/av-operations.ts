import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readConfig } from './config';
import { AbyError } from './errors';
import { getAvRepository } from './av-repository';

const running = new Set<string>();

function remotePath(root: string, objectKey: string): string {
  return `${root.replace(/\/+$/, '')}/${objectKey.replace(/^\/+/, '')}`;
}

function progressFromLine(line: string) {
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

export async function executeStorageOperation(ownerId: string, operationId: string): Promise<void> {
  const repository = getAvRepository();
  const operation = await repository.getOperation(ownerId, operationId);
  if (!operation) throw new AbyError('operation_not_found', 'Storage operation not found', 404);
  if (running.has(operationId)) throw new AbyError('operation_running', 'Storage operation is already running', 409);
  if (operation.state === 'running' && operation.beaconAt && Date.now() - new Date(operation.beaconAt).getTime() < 30_000) {
    throw new AbyError('operation_running', 'Storage operation has a current process beacon', 409);
  }
  if (operation.state === 'succeeded' || operation.state === 'cancelled') throw new AbyError('operation_not_executable', 'Storage operation is already final', 409);
  const config = readConfig();
  running.add(operationId);
  const startedAt = new Date().toISOString();
  await repository.updateOperation(ownerId, operationId, { state: 'running', startedAt, beaconAt: startedAt, error: undefined });
  await repository.setItemState(ownerId, operation.avItemId, 'copying');

  const child = spawn(config.RCLONE_PATH, [
    'copyto',
    remotePath(config.RCLONE_WASABI_ROOT, operation.sourceObjectKey),
    remotePath(config.RCLONE_WASABI_ROOT, operation.destinationObjectKey),
    '--no-traverse', '--stats', '1s', '--stats-one-line-json', '--log-level', 'INFO'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let lastError = '';
  let updateChain = Promise.resolve();
  const observe = (line: string) => {
    const progress = progressFromLine(line);
    if (!Object.keys(progress).length) {
      if (/error|failed/i.test(line)) lastError = line.slice(0, 2_000);
      return;
    }
    updateChain = updateChain.then(() => repository.updateOperation(ownerId, operationId, {
      ...progress, beaconAt: new Date().toISOString()
    })).then(() => undefined).catch(() => undefined);
  };
  createInterface({ input: child.stdout }).on('line', observe);
  createInterface({ input: child.stderr }).on('line', observe);
  child.once('error', async (error) => {
    await updateChain;
    const finishedAt = new Date().toISOString();
    await repository.updateOperation(ownerId, operationId, { state: 'failed', error: error.message, beaconAt: finishedAt, finishedAt });
    await repository.setItemState(ownerId, operation.avItemId, 'failed');
    running.delete(operationId);
  });
  child.once('close', async (code) => {
    await updateChain;
    if (!running.has(operationId)) return;
    const finishedAt = new Date().toISOString();
    if (code === 0) {
      await repository.updateOperation(ownerId, operationId, {
        state: 'succeeded', transferredBytes: operation.sizeBytes, speedBytesPerSecond: 0,
        etaSeconds: 0, beaconAt: finishedAt, finishedAt, error: undefined
      });
      await repository.setItemState(ownerId, operation.avItemId, 'available');
    } else {
      await repository.updateOperation(ownerId, operationId, {
        state: 'failed', error: lastError || `rclone exited with code ${code}`, beaconAt: finishedAt, finishedAt
      });
      await repository.setItemState(ownerId, operation.avItemId, 'failed');
    }
    running.delete(operationId);
  });
}
