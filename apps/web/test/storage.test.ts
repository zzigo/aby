import { expect, test } from 'bun:test';
import { assertAbyObjectKey } from '../src/lib/server/storage';

test('storage keys cannot escape the Aby prefix', () => {
  expect(assertAbyObjectKey('aby/media/originals/example.flac')).toBe('aby/media/originals/example.flac');
  expect(() => assertAbyObjectKey('zzttuntref/libros/example.pdf')).toThrow();
  expect(() => assertAbyObjectKey('aby/media/../other/example.flac')).toThrow();
});

