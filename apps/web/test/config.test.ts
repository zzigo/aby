import { describe, expect, test } from 'bun:test';
import { readConfig } from '../src/lib/server/config';

describe('external metadata configuration', () => {
  test('prefers a TMDB read token while retaining the v3 API key', () => {
    const config = readConfig({
      TMDB_READ_ACCESS_TOKEN: 'read-token',
      TMDB_API_KEY: 'api-key'
    });

    expect(config.tmdbConfigured).toBe(true);
    expect(config.TMDB_READ_ACCESS_TOKEN).toBe('read-token');
    expect(config.TMDB_API_KEY).toBe('api-key');
  });

  test('accepts the TMDB v3 API key as a fallback', () => {
    const config = readConfig({ TMDB_API_KEY: 'api-key' });

    expect(config.tmdbConfigured).toBe(true);
    expect(config.TMDB_READ_ACCESS_TOKEN).toBeUndefined();
  });
});
