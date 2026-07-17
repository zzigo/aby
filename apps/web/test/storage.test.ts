import { expect, test } from 'bun:test';
import { assertAbyObjectKey, assertSourceObjectKey, toWasabiKey } from '../src/lib/server/storage';

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

test('logical catalog keys map below the configured Wasabi root', () => {
  expect(toWasabiKey('ref/20 late/Gavin Bryars/example.mp3', 'zzttuntref/')).toBe('zzttuntref/ref/20 late/Gavin Bryars/example.mp3');
  expect(toWasabiKey('aby/aud/20L/bryars/example.mp3', 'zzttuntref')).toBe('zzttuntref/aby/aud/20L/bryars/example.mp3');
});

test('legacy source keys preserve their exact Unicode form', () => {
  const decomposed = 'ref/experimental/TA\u0303ªte.mp3';
  expect(assertSourceObjectKey(decomposed)).toBe(decomposed);
  expect(toWasabiKey(decomposed, 'zzttuntref/')).toBe(`zzttuntref/${decomposed}`);
});
