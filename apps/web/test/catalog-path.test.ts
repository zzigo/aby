import { expect, test } from 'bun:test';
import { recordingFolderName } from '../src/lib/server/catalog-path';

test('recording folders use year and label without spaces or catalog number', () => {
  expect(recordingFolderName({
    releaseDate: '1990',
    label: 'Les Disques du Crépuscule',
    fallback: 'The Sinking of the Titanic'
  })).toBe('1990-Les-Disques-du-Crépuscule');
});
