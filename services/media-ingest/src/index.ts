import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promisify } from 'node:util';
import type { TechnicalMetadata } from '@zztt/aby-domain';

const execFileAsync = promisify(execFile);

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  width?: number;
  height?: number;
}

interface FfprobeDocument {
  program_version?: { version?: string };
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, unknown>;
  };
}

export interface ProbeResult {
  metadata: TechnicalMetadata;
  toolVersion: string;
}

const positiveInteger = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
};

export function parseFfprobe(document: FfprobeDocument): ProbeResult {
  const format = document.format ?? {};
  const audio = document.streams?.find((stream) => stream.codec_type === 'audio');
  const video = document.streams?.find((stream) => stream.codec_type === 'video');
  const durationMs = Math.max(0, Math.round(Number(format.duration ?? 0) * 1000));
  const tags = Object.fromEntries(Object.entries(format.tags ?? {}).map(([key, value]) => [key, String(value)]));
  return {
    toolVersion: document.program_version?.version ?? 'unknown',
    metadata: {
      durationMs,
      formatName: format.format_name ?? 'unknown',
      ...(format.format_long_name ? { formatLongName: format.format_long_name } : {}),
      ...(positiveInteger(format.size) !== undefined ? { sizeBytes: positiveInteger(format.size) } : {}),
      ...(positiveInteger(format.bit_rate) !== undefined ? { bitRate: positiveInteger(format.bit_rate) } : {}),
      ...(audio?.codec_name ? { audioCodec: audio.codec_name } : {}),
      ...(positiveInteger(audio?.sample_rate) ? { sampleRate: positiveInteger(audio?.sample_rate) } : {}),
      ...(positiveInteger(audio?.channels) ? { channels: positiveInteger(audio?.channels) } : {}),
      ...(audio?.channel_layout ? { channelLayout: audio.channel_layout } : {}),
      ...(video?.codec_name ? { videoCodec: video.codec_name } : {}),
      ...(positiveInteger(video?.width) ? { width: positiveInteger(video?.width) } : {}),
      ...(positiveInteger(video?.height) ? { height: positiveInteger(video?.height) } : {}),
      tags
    }
  };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export async function ffprobeFile(path: string, options: { binary?: string; timeoutMs?: number } = {}): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(options.binary ?? 'ffprobe', [
    '-v', 'error', '-show_program_version', '-show_format', '-show_streams', '-of', 'json', path
  ], {
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: 10 * 1024 * 1024
  });
  return parseFfprobe(JSON.parse(stdout) as FfprobeDocument);
}

export async function inspectLocalAsset(path: string, options: { binary?: string; timeoutMs?: number } = {}) {
  const [checksumSha256, probe] = await Promise.all([sha256File(path), ffprobeFile(path, options)]);
  return { checksumSha256, ...probe };
}

