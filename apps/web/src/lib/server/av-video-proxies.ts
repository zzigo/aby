import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { AvCatalogItem } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { readConfig } from './config';
import { artifactUrl, headWasabiObjectOrNull, sourceVideoPlaybackUrl, uploadWasabiArtifact } from './storage';

type VideoProxyJob = {
  state: 'running' | 'failed';
  progress: number;
  speed?: string;
  error?: string;
};

const jobs = new Map<string, VideoProxyJob>();

export function videoProxyObjectKey(item: Pick<AvCatalogItem, 'destinationObjectKey'>) {
  const stem = basename(item.destinationObjectKey).replace(/\.[^.]+$/, '');
  return `${dirname(item.destinationObjectKey)}/.aby-proxies/${stem}.web.mp4`;
}

export function videoProxyFfmpegArgs(sourceUrl: string, outputPath: string) {
  return [
    '-hide_banner', '-v', 'error', '-fflags', '+genpts', '-i', sourceUrl,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn',
    '-vf', 'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-max_muxing_queue_size', '1024', '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-y', outputPath
  ];
}

async function originalDelivery(item: AvCatalogItem) {
  return item.state === 'available'
    ? artifactUrl(item.destinationObjectKey, item.technicalMetadata.contentType ?? 'application/octet-stream')
    : sourceVideoPlaybackUrl(item.sourceObjectKey);
}

export async function videoProxyState(item: AvCatalogItem) {
  const objectKey = videoProxyObjectKey(item);
  const head = await headWasabiObjectOrNull(objectKey);
  if (head) return { state: 'ready' as const, progress: 100, objectKey, sizeBytes: head.sizeBytes };
  const job = jobs.get(item.id);
  return {
    state: job?.state ?? 'missing' as 'running' | 'failed' | 'missing',
    progress: job?.progress ?? 0,
    ...(job?.speed ? { speed: job.speed } : {}),
    ...(job?.error ? { error: job.error } : {}),
    objectKey
  };
}

export async function playableVideoDelivery(item: AvCatalogItem) {
  const videoProxy = await videoProxyState(item);
  if (videoProxy.state === 'ready') {
    return { ...await artifactUrl(videoProxy.objectKey, 'video/mp4'), deliveryKind: 'web-proxy' as const, videoProxy };
  }
  return { ...await originalDelivery(item), deliveryKind: 'original' as const, videoProxy };
}

export async function videoProxyPlayback(item: AvCatalogItem) {
  const state = await videoProxyState(item);
  if (state.state !== 'ready') throw new AbyError('video_proxy_not_ready', 'Web MP4 proxy is not ready', 409);
  return artifactUrl(state.objectKey, 'video/mp4');
}

function transcode(item: AvCatalogItem, sourceUrl: string, outputPath: string) {
  const config = readConfig();
  return new Promise<void>((resolve, reject) => {
    const child = spawn(config.FFMPEG_PATH, videoProxyFfmpegArgs(sourceUrl, outputPath), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), config.FFMPEG_TRANSCODE_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? '';
      const job = jobs.get(item.id);
      if (!job || job.state !== 'running') return;
      for (const line of lines) {
        const [key, value] = line.split('=', 2);
        if (key === 'out_time_us' && item.technicalMetadata.durationMs) {
          job.progress = Math.min(99, Math.max(0, Number(value) / 1_000 / item.technicalMetadata.durationMs * 100));
        } else if (key === 'speed' && value) job.speed = value;
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4_000); });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${signal ?? code}): ${stderr.trim() || 'no diagnostic output'}`));
    });
  });
}

export async function startVideoProxy(item: AvCatalogItem) {
  const current = await videoProxyState(item);
  if (current.state === 'ready' || current.state === 'running') return current;
  jobs.set(item.id, { state: 'running', progress: 0 });
  void (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aby-video-proxy-'));
    const output = join(directory, 'web.mp4');
    try {
      const source = await originalDelivery(item);
      await transcode(item, source.url, output);
      await uploadWasabiArtifact(videoProxyObjectKey(item), output, 'video/mp4');
      jobs.delete(item.id);
    } catch (error) {
      jobs.set(item.id, {
        state: 'failed', progress: jobs.get(item.id)?.progress ?? 0,
        error: error instanceof Error ? error.message.slice(0, 1_000) : 'Video proxy failed'
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  })();
  return { state: 'running' as const, progress: 0, objectKey: videoProxyObjectKey(item) };
}
