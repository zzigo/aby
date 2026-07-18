import { describe, expect, test } from 'bun:test';
import { nextPlaybackItem, type PlaybackContextItem } from '../src/lib/player';

const catalog: PlaybackContextItem[] = [
  { assetId: 'a3', title: 'Track 3', subtitle: 'A', albumId: 'album-a', trackNumber: 3 },
  { assetId: 'b1', title: 'Track 1', subtitle: 'B', albumId: 'album-b', trackNumber: 1 },
  { assetId: 'a1', title: 'Track 1', subtitle: 'A', albumId: 'album-a', trackNumber: 1 },
  { assetId: 'a2', title: 'Track 2', subtitle: 'A', albumId: 'album-a', trackNumber: 2 }
];

describe('playback modes', () => {
  test('continuous advances in track order inside the current album', () => {
    expect(nextPlaybackItem(catalog, catalog[2]!, 'continuous')?.assetId).toBe('a2');
    expect(nextPlaybackItem(catalog, catalog[3]!, 'continuous')?.assetId).toBe('a3');
    expect(nextPlaybackItem(catalog, catalog[0]!, 'continuous')).toBeNull();
  });

  test('continuous does not cross into another album', () => {
    expect(nextPlaybackItem(catalog, catalog[1]!, 'continuous')).toBeNull();
  });

  test('loop keeps the current track', () => {
    expect(nextPlaybackItem(catalog, catalog[2]!, 'loop-track')?.assetId).toBe('a1');
  });

  test('random selects from the whole catalog without immediately repeating', () => {
    expect(nextPlaybackItem(catalog, catalog[2]!, 'random', () => 0)?.assetId).toBe('a3');
    expect(nextPlaybackItem(catalog, catalog[2]!, 'random', () => 0.999)?.assetId).toBe('a2');
  });
});
