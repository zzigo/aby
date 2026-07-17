import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Asset } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { readConfig } from './config';
import type { AbyRepository, SpectrogramAnalysis } from './repository';
import { summarizeSpectralObservations, type SpectralObservation } from './spectral-descriptors';
import { downloadWasabiObject, uploadWasabiArtifact } from './storage';

const WIDTH = 2400;
const HEIGHT = 900;
const ANALYSIS_RATE = 8_000;

function runProcess(binary: string, args: string[], timeoutMs: number, onLine?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let lineBuffer = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!onLine) {
        stdout += chunk;
        return;
      }
      lineBuffer += chunk;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) onLine(line);
    });
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (lineBuffer && onLine) onLine(lineBuffer);
      if (code === 0) resolve(stdout);
      else reject(new AbyError('spectrogram_generation_failed', `ffmpeg failed (${signal ?? code}): ${stderr.trim()}`, 502));
    });
  });
}

async function ffmpegVersion(binary: string, timeoutMs: number): Promise<string> {
  const output = await runProcess(binary, ['-version'], timeoutMs);
  return output.split(/\r?\n/, 1)[0]?.replace(/^ffmpeg version\s+/, '') || 'unknown';
}

async function readObservations(binary: string, inputPath: string, timeoutMs: number): Promise<SpectralObservation[]> {
  const observations: SpectralObservation[] = [];
  let frame: Partial<SpectralObservation> = {};
  const flush = () => {
    if (typeof frame.rmsDb === 'number' && typeof frame.centroidHz === 'number' && typeof frame.flux === 'number' &&
      typeof frame.rolloffHz === 'number' && typeof frame.spreadHz === 'number') {
      observations.push({ ...frame, nyquistHz: ANALYSIS_RATE / 2 } as SpectralObservation);
    }
    frame = {};
  };
  const filter = [
    `aresample=${ANALYSIS_RATE}`,
    'aspectralstats=win_size=4096:overlap=0.5:measure=centroid+flux+rolloff+spread',
    'astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level',
    'ametadata=print:file=-'
  ].join(',');
  await runProcess(binary, ['-v', 'error', '-i', inputPath, '-map', '0:a:0', '-af', filter, '-f', 'null', '-'], timeoutMs, (line) => {
    if (line.startsWith('frame:')) {
      flush();
      return;
    }
    const separator = line.indexOf('=');
    if (separator < 0) return;
    const key = line.slice(0, separator);
    const value = Number(line.slice(separator + 1));
    if (!Number.isFinite(value)) return;
    if (key === 'lavfi.astats.Overall.RMS_level') frame.rmsDb = value;
    else if (key.endsWith('.centroid')) frame.centroidHz = value;
    else if (key.endsWith('.flux')) frame.flux = value;
    else if (key.endsWith('.rolloff')) frame.rolloffHz = value;
    else if (key.endsWith('.spread')) frame.spreadHz = value;
  });
  flush();
  if (!observations.length) throw new AbyError('spectral_descriptors_empty', 'ffmpeg produced no spectral observations', 502);
  return observations;
}

export function spectrogramArtifactKey(asset: Asset): string {
  return `aby/_analysis/${asset.id}/${asset.checksumSha256}/spectrogram-v1.png`;
}

export async function generateSpectrogramAnalysis(
  ownerId: string,
  asset: Asset,
  repository: AbyRepository
): Promise<SpectrogramAnalysis> {
  if (asset.ownerId !== ownerId) throw new AbyError('asset_not_found', 'Asset not found', 404);
  if (asset.provider === 'local-fixture') throw new AbyError('fixture_analysis_unavailable', 'Fixture analysis is not persisted', 400);
  const config = readConfig();
  const directory = await mkdtemp(join(tmpdir(), 'aby-spectrogram-'));
  const inputPath = join(directory, 'asset');
  const outputPath = join(directory, 'spectrogram.png');
  try {
    await downloadWasabiObject(asset.objectKey, inputPath);
    const filter = `showspectrumpic=s=${WIDTH}x${HEIGHT}:legend=disabled:color=green:scale=log:fscale=log:drange=100`;
    await runProcess(config.FFMPEG_PATH, [
      '-v', 'error', '-y', '-i', inputPath,
      '-filter_complex', `[0:a:0]${filter}[spectrogram]`, '-map', '[spectrogram]',
      '-c:v', 'png', '-frames:v', '1', outputPath
    ], config.FFMPEG_ANALYSIS_TIMEOUT_MS);
    const artifactObjectKey = spectrogramArtifactKey(asset);
    await uploadWasabiArtifact(artifactObjectKey, outputPath, 'image/png');
    const observations = await readObservations(config.FFMPEG_PATH, inputPath, config.FFMPEG_ANALYSIS_TIMEOUT_MS);
    const toolVersion = await ffmpegVersion(config.FFMPEG_PATH, 10_000);
    return repository.saveSpectrogramAnalysis(ownerId, asset, {
      artifactObjectKey,
      tool: 'ffmpeg-showspectrumpic',
      toolVersion,
      summary: {
        descriptors: summarizeSpectralObservations(observations),
        observationCount: observations.length,
        width: WIDTH,
        height: HEIGHT,
        generatedAt: new Date().toISOString()
      },
      reviewState: 'candidate'
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
