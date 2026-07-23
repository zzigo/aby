import { describe, expect, test } from 'bun:test';
import { progressFromLine } from '../src/lib/server/av-operations';

describe('rclone JSON progress', () => {
  test('reads the stats object emitted by --use-json-log', () => {
    expect(progressFromLine(JSON.stringify({
      level: 'notice',
      msg: 'Transferred',
      stats: { bytes: 1_048_576, speed: 262_144, eta: 12 }
    }))).toEqual({
      transferredBytes: 1_048_576,
      speedBytesPerSecond: 262_144,
      etaSeconds: 12
    });
  });

  test('does not mistake ordinary JSON log messages for zero-byte progress', () => {
    expect(progressFromLine(JSON.stringify({
      level: 'notice', msg: 'Skipped copy as --dry-run is set', size: 628
    }))).toEqual({});
  });
});
