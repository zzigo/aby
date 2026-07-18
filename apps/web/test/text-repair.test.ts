import { expect, test } from 'bun:test';
import { repairCatalogMetadata, repairLegacyDiacritics } from '../src/lib/server/text-repair';

test('repairs observed legacy iTunes German diacritic signatures', () => {
  expect(repairLegacyDiacritics('Gefrorne TrN\u0303nen')).toBe('Gefrorne Tränen');
  expect(repairLegacyDiacritics('RA\u030ackblick')).toBe('Rückblick');
  expect(repairLegacyDiacritics('FrA\u030ahlingstraum')).toBe('Frühlingstraum');
  expect(repairLegacyDiacritics('Die KrN\u0303he')).toBe('Die Krähe');
});

test('normalizes valid decomposed text without rewriting legitimate letters', () => {
  expect(repairLegacyDiacritics('Sen\u0303or A\u030Angstro\u0308m Ho\u0308lderlin')).toBe('Señor Ångström Hölderlin');
  expect(repairLegacyDiacritics('Måns')).toBe('Måns');
});

test('repairs human-facing canonical metadata but preserves storage identity', () => {
  const metadata = repairCatalogMetadata({
    recordingTitle: 'Die KrN\u0303he',
    albumArtist: 'Sen\u0303or Test',
    tags: ['FrA\u030ahlingstraum'],
    roles: [{ name: 'RA\u030ackblick', role: 'Vocals' }],
    canonicalObjectKey: 'aby/aud/20E/source/RA\u030ackblick.mp3'
  });
  expect(metadata.recordingTitle).toBe('Die Krähe');
  expect(metadata.albumArtist).toBe('Señor Test');
  expect(metadata.tags).toEqual(['Frühlingstraum']);
  expect(metadata.roles).toEqual([{ name: 'Rückblick', role: 'Vocals' }]);
  expect(metadata.canonicalObjectKey).toBe('aby/aud/20E/source/RA\u030ackblick.mp3');
});
