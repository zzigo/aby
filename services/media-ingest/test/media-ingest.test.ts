import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFfprobe, sha256File } from '../src/index';

test('calculates a deterministic SHA-256', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aby-checksum-'));
  const path = join(directory, 'sample.bin');
  try {
    await writeFile(path, 'aby');
    expect(await sha256File(path)).toBe('0f504bc265f2895847485f92725eb18d1717fa37151536136a68660b9dbfc00b');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('ffprobe parsing', () => {
  test('extracts technical audio metadata without treating tags as canonical', () => {
    const result = parseFfprobe({
      program_version: { version: '8.1.2' },
      format: { format_name: 'wav', duration: '1.250', size: '12000', tags: { title: 'Candidate title' } },
      streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '48000', channels: 2 }]
    });
    expect(result.metadata.durationMs).toBe(1250);
    expect(result.metadata.sampleRate).toBe(48000);
    expect(result.metadata.tags.title).toBe('Candidate title');
  });
});
