import { expect, test } from 'bun:test';
import { assertAbyObjectKey, assertSourceObjectKey } from '../src/lib/server/storage';

test('storage keys cannot escape the Aby prefix', () => {
  expect(assertAbyObjectKey('aby/aud/20L/boulez/Repons/example.flac')).toBe('aby/aud/20L/boulez/Repons/example.flac');
  expect(() => assertAbyObjectKey('zzttuntref/libros/example.pdf')).toThrow();
  expect(() => assertAbyObjectKey('aby/aud/../other/example.flac')).toThrow();
});

test('legacy discovery is bounded to ref and mov', () => {
  expect(assertSourceObjectKey('ref/20 late/Gavin Bryars/example.mp3')).toBe('ref/20 late/Gavin Bryars/example.mp3');
  expect(assertSourceObjectKey('mov/example.mkv')).toBe('mov/example.mkv');
  expect(() => assertSourceObjectKey('libros/example.pdf')).toThrow();
  expect(() => assertSourceObjectKey('aby/aud/example.mp3')).toThrow();
});
