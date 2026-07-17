import { api, ownerFor } from '$lib/server/errors';
import { listWasabiSourceKeys } from '$lib/server/storage';
import { readConfig } from '$lib/server/config';
import { sourceRecord, type SourceRecord } from '$lib/server/source-record';
import type { RequestHandler } from './$types';

let sourceCache: { expiresAt: number; records: SourceRecord[] } | undefined;
let sourceCachePromise: Promise<SourceRecord[]> | undefined;

async function allSources(): Promise<SourceRecord[]> {
  if (sourceCache && sourceCache.expiresAt > Date.now()) return sourceCache.records;
  if (!sourceCachePromise) {
    sourceCachePromise = listWasabiSourceKeys().then((keys) => {
      const config = readConfig();
      const records = keys.map((key) => sourceRecord(key, config));
      sourceCache = { records, expiresAt: Date.now() + 5 * 60_000 };
      return records;
    }).finally(() => { sourceCachePromise = undefined; });
  }
  return sourceCachePromise;
}

function randomSample<T>(values: T[], size: number): T[] {
  if (values.length <= size) return [...values];
  const selected = new Set<number>();
  while (selected.size < size) selected.add(Math.floor(Math.random() * values.length));
  return [...selected].map((index) => values[index]!);
}

export const GET: RequestHandler = (event) => api('ingest.sources', async () => {
  ownerFor(event);
  const config = readConfig();
  if (config.demoMode) {
    return { sources: [sourceRecord('ref/20 late/Gavin Bryars/The Sinking of the Titanic/Sinking of the Titanic.mp3', config)], total: 1 };
  }

  const records = await allSources();
  const mode = event.url.searchParams.get('mode') ?? 'surf';
  if (mode === 'random') return { sources: randomSample(records, 1), total: records.length };

  const query = event.url.searchParams.get('q')?.trim().toLocaleLowerCase() ?? '';
  const limit = Math.min(250, Math.max(1, Number(event.url.searchParams.get('limit')) || 150));
  if (!query) return { sources: randomSample(records, limit), total: records.length, sampled: true };
  const matches = records.filter((source) =>
    source.objectKey.toLocaleLowerCase().includes(query)
    || source.creatorDisplay.toLocaleLowerCase().includes(query)
    || source.workTitle.toLocaleLowerCase().includes(query)
  );
  return { sources: matches.slice(0, limit), total: matches.length, sampled: matches.length > limit };
});
