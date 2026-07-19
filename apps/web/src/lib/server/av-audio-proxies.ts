import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AvCatalogItem } from '@zztt/aby-domain';
import { artifactUrl, headWasabiObjectOrNull, sourceVideoPlaybackUrl, uploadWasabiArtifact } from './storage';
import { readConfig } from './config';
import { AbyError } from './errors';
import { selectableAvStreams } from './av-streams';

const execFileAsync = promisify(execFile);
const jobs = new Map<string, { state: 'running'|'failed'; error?: string }>();

export async function withSelectableAudioTracks(item: AvCatalogItem): Promise<AvCatalogItem> {
  if (item.technicalMetadata.audioTracks) return item;
  const delivery = item.state === 'available'
    ? await artifactUrl(item.destinationObjectKey, item.technicalMetadata.contentType ?? 'video/mp4')
    : await sourceVideoPlaybackUrl(item.sourceObjectKey);
  const streams = await selectableAvStreams(item.id, delivery.url, item.technicalMetadata);
  return { ...item, technicalMetadata: { ...item.technicalMetadata, ...streams } };
}

export function audioProxyObjectKey(item: AvCatalogItem, stream: number) {
  const stem = basename(item.destinationObjectKey).replace(/\.[^.]+$/, '');
  return `${dirname(item.destinationObjectKey)}/.aby-proxies/${stem}.audio-${stream}.stereo.ogg`;
}

export async function audioProxyState(item: AvCatalogItem, stream: number) {
  const objectKey = audioProxyObjectKey(item, stream);
  if (await headWasabiObjectOrNull(objectKey)) return { stream, state: 'ready' as const, objectKey };
  const job = jobs.get(`${item.id}:${stream}`);
  return { stream, state: job?.state ?? 'missing' as 'running'|'failed'|'missing', error: job?.error, objectKey };
}

export async function audioProxyPlayback(item: AvCatalogItem, stream: number) {
  const state = await audioProxyState(item, stream);
  if (state.state !== 'ready') throw new AbyError('audio_proxy_not_ready', 'Stereo audio proxy is not ready', 409);
  return artifactUrl(state.objectKey, 'audio/ogg');
}

export async function startAudioProxy(item: AvCatalogItem, stream: number) {
  if (!item.technicalMetadata.audioTracks?.some((track) => track.index === stream)) throw new AbyError('audio_stream_not_found', 'Audio stream not found', 404);
  const current = await audioProxyState(item, stream);
  if (current.state === 'ready' || current.state === 'running') return current;
  const key = `${item.id}:${stream}`;
  jobs.set(key, { state: 'running' });
  void (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aby-audio-proxy-'));
    const output = join(directory, 'stereo.ogg');
    try {
      const config = readConfig();
      const source = item.state === 'available'
        ? await artifactUrl(item.destinationObjectKey, item.technicalMetadata.contentType ?? 'video/mp4')
        : await sourceVideoPlaybackUrl(item.sourceObjectKey);
      await execFileAsync(config.FFMPEG_PATH, ['-v','error','-i',source.url,'-map',`0:${stream}`,'-vn','-ac','2','-c:a','libvorbis','-q:a','6',output], {
        timeout: config.FFMPEG_ANALYSIS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024
      });
      await uploadWasabiArtifact(audioProxyObjectKey(item, stream), output, 'audio/ogg');
      jobs.delete(key);
    } catch (error) {
      jobs.set(key, { state: 'failed', error: error instanceof Error ? error.message.slice(0, 1_000) : 'Audio proxy failed' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  })();
  return { stream, state: 'running' as const, objectKey: audioProxyObjectKey(item, stream) };
}
