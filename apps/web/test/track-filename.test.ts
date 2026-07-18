import { expect, test } from 'bun:test';
import { parseTrackFilename, parseTrackTitle } from '../src/lib/server/track-title';

test('extracts a leading track number and sanitizes the visible title', () => {
  expect(parseTrackFilename('02. O TESEO.mp3')).toEqual({
    title: 'O TESEO', trackNumber: 2, filename: '02-O TESEO.mp3'
  });
  expect(parseTrackFilename('003_AHI,  CHE NON PUR.flac')).toEqual({
    title: 'AHI, CHE NON PUR', trackNumber: 3, filename: '03-AHI, CHE NON PUR.flac'
  });
});

test('keeps an unnumbered track readable', () => {
  expect(parseTrackFilename('Sinking of the Titanic.mp3')).toEqual({
    title: 'Sinking of the Titanic', filename: 'Sinking of the Titanic.mp3'
  });
});

test('sanitizes a bare numeric track prefix from editable titles', () => {
  expect(parseTrackTitle('22 track 22')).toEqual({ trackNumber: 22, title: '22' });
  expect(parseTrackTitle('03 — AHI, CHE NON PUR')).toEqual({ trackNumber: 3, title: 'AHI, CHE NON PUR' });
});
