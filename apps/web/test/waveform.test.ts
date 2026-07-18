import { expect, test } from 'bun:test';
import { waveformArtifactKey, waveformFfmpegArgs } from '../src/lib/server/waveform';

test('waveform artifacts are checksum-bound and render one PNG frame', () => {
  const asset = { id: 'asset-id', checksumSha256: 'a'.repeat(64) } as Parameters<typeof waveformArtifactKey>[0];
  expect(waveformArtifactKey(asset)).toBe(`aby/_analysis/asset-id/${'a'.repeat(64)}/waveform-v1.png`);
  const args = waveformFfmpegArgs('input.mp3', 'output.png');
  expect(args).toContain('-frames:v');
  expect(args).toContain('1');
  expect(args.some((value) => value.includes('showwavespic'))).toBe(true);
});
