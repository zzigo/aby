import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Asset } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { readConfig } from './config';
import { downloadWasabiObject, uploadWasabiArtifact } from './storage';

const execFileAsync = promisify(execFile);
export const WAVEFORM_WIDTH = 2400;
export const WAVEFORM_HEIGHT = 720;

export function waveformArtifactKey(asset: Asset): string {
  return `aby/_analysis/${asset.id}/${asset.checksumSha256}/waveform-v1.png`;
}

export function waveformFfmpegArgs(input: string, output: string): string[] {
  const filter = `aformat=channel_layouts=mono,showwavespic=s=${WAVEFORM_WIDTH}x${WAVEFORM_HEIGHT}:colors=0xc6ff52:scale=sqrt:draw=full`;
  return ['-v', 'error', '-y', '-i', input, '-filter_complex', `[0:a:0]${filter}[waveform]`, '-map', '[waveform]', '-c:v', 'png', '-frames:v', '1', output];
}

export async function generateWaveform(asset: Asset) {
  if (asset.provider === 'local-fixture') throw new AbyError('fixture_waveform_unavailable', 'Fixture waveform is unavailable', 400);
  const config = readConfig();
  const directory = await mkdtemp(join(tmpdir(), 'aby-waveform-'));
  const input = join(directory, 'asset');
  const output = join(directory, 'waveform.png');
  try {
    await downloadWasabiObject(asset.objectKey, input);
    await execFileAsync(config.FFMPEG_PATH, waveformFfmpegArgs(input, output), {
      timeout: config.FFMPEG_ANALYSIS_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024
    });
    const artifactObjectKey = waveformArtifactKey(asset);
    await uploadWasabiArtifact(artifactObjectKey, output, 'image/png');
    return {
      artifactObjectKey,
      sourceChecksumSha256: asset.checksumSha256,
      width: WAVEFORM_WIDTH,
      height: WAVEFORM_HEIGHT,
      generatedAt: new Date().toISOString()
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
