import { expect, test } from 'bun:test';
import { displayTrackTitle, formatDuration, formatTechnicalFormat } from '../src/lib/presentation';

test('renders media duration as a readable clock', () => {
  expect(formatDuration(3_619_128)).toBe('01:00:19.12');
  expect(formatDuration(62_000)).toBe('01:02.00');
});

test('does not repeat identical container and codec names', () => {
  expect(formatTechnicalFormat({ durationMs: 1, formatName: 'mp3', audioCodec: 'mp3', tags: {} })).toBe('mp3');
  expect(formatTechnicalFormat({ durationMs: 1, formatName: 'matroska', audioCodec: 'flac', tags: {} })).toBe('matroska · flac');
});

test('hides placeholder track words but preserves real titles', () => {
  expect(displayTrackTitle('track 18', 18)).toBe('18');
  expect(displayTrackTitle('Track', 7)).toBe('7');
  expect(displayTrackTitle('Track One', 1)).toBe('Track One');
});
