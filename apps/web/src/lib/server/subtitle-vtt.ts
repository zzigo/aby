import { spawn } from 'node:child_process';
import { readConfig } from './config';
import { AbyError } from './errors';

const MAX_SUBTITLE_BYTES = 12 * 1024 * 1024;

export async function fetchSubtitleBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new AbyError('subtitle_download_failed', `Subtitle download returned ${response.status}`, 502);
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (declaredSize > MAX_SUBTITLE_BYTES) throw new AbyError('subtitle_too_large', 'Subtitle file exceeds the 12 MB safety limit', 413);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SUBTITLE_BYTES) throw new AbyError('subtitle_too_large', 'Subtitle file exceeds the 12 MB safety limit', 413);
  return bytes;
}

export function subtitleBytesToVtt(bytes: Uint8Array): Promise<string> {
  if (new TextDecoder().decode(bytes.slice(0, 32)).trimStart().startsWith('WEBVTT')) return Promise.resolve(new TextDecoder().decode(bytes));
  const config = readConfig();
  return new Promise((resolve, reject) => {
    const child = spawn(config.FFMPEG_PATH, ['-v', 'error', '-i', 'pipe:0', '-f', 'webvtt', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve(Buffer.concat(stdout).toString('utf8'))
      : reject(new AbyError('subtitle_conversion_failed', Buffer.concat(stderr).toString('utf8').slice(0, 1_000) || 'ffmpeg could not convert the subtitle to WebVTT', 422)));
    child.stdin.end(bytes);
  });
}
