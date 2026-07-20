import { describe, expect, test } from 'bun:test';
import { bookletDestination, scoreDestination } from '../src/lib/server/album-supplementals';

describe('album supplemental destinations', () => {
  test('names booklet pages after the canonical album title with a padded page number', () => {
    expect(bookletDestination(
      'aby/aud/20E/schubert/1827-Winterreise/01-Gute Nacht.flac',
      'Winterreise', 3, '.jpg'
    )).toBe('aby/aud/20E/schubert/1827-Winterreise/Winterreise-booklet-03.jpg');
  });

  test('keeps score copies inside the explicit Seshat score root', () => {
    expect(scoreDestination('Symphony No. 3', 'ref/Mahler/score full.pdf'))
      .toBe('libros/scores/Symphony No. 3/score full.pdf');
  });
});
