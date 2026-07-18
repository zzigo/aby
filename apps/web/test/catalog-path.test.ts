import { expect, test } from 'bun:test';
import { recordingFolderName, relocatedCatalogObjectKey } from '../src/lib/server/catalog-path';

test('recording folders use year and label without spaces or catalog number', () => {
  expect(recordingFolderName({
    releaseDate: '1990',
    label: 'Les Disques du Crépuscule',
    fallback: 'The Sinking of the Titanic'
  })).toBe('1990-Les-Disques-du-Crépuscule');
});

test('relocates collection and creator while repairing legacy track glyphs', () => {
  expect(relocatedCatalogObjectKey(
    'aby/aud/19/robertschumann/Winterreise/Winterreise/03-Gefrorne TrN\u0303nen.mp3',
    '19',
    'schubert'
  )).toBe('aby/aud/19/schubert/Winterreise/Winterreise/03-Gefrorne Tränen.mp3');
});
