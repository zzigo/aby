import { expect, test } from 'bun:test';
import { parseTrackFilename } from '../src/lib/server/ingest';

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
