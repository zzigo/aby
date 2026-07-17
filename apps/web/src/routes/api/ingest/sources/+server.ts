import { api, ownerFor } from '$lib/server/errors';
import { listWasabiSourceKeys } from '$lib/server/storage';
import { readConfig } from '$lib/server/config';
import type { RequestHandler } from './$types';

export interface SourceRecord {
  objectKey: string;
  mediaKind: 'aud' | 'mov';
  collectionCode: string;
  entitySlug: string;
  creatorDisplay: string;
  workTitle: string;
  recordingTitle: string;
}

let sourceCache: { expiresAt: number; records: SourceRecord[] } | undefined;
let sourceCachePromise: Promise<SourceRecord[]> | undefined;

function sourceRecord(key: string, config = readConfig()): SourceRecord {
  const parts = key.split('/');
  const isAudio = key.startsWith(config.sourceAudioPrefix);
  const mediaKind = isAudio ? 'aud' : 'mov';
  let collectionCode = isAudio ? '20L' : '20ELE';
  let creatorDisplay = 'Unknown Artist';
  let workTitle = 'Untitled Work';
  let recordingTitle = 'Unspecified Session';

  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized.includes('late') || normalized === '20l') collectionCode = '20L';
    else if (normalized.includes('early') || normalized === '20e') collectionCode = '20E';
    else if (normalized.includes('lat') || normalized.includes('latin')) collectionCode = '20LAT';
    else if (normalized.includes('ele') || normalized.includes('electro')) collectionCode = '20ELE';
    else if (normalized.includes('pop')) collectionCode = 'pop';
    else if (normalized.includes('tec') || normalized.includes('techno')) collectionCode = 'tec';
    else if (normalized.includes('ens') || normalized.includes('ensemble')) collectionCode = 'ens';
  }

  const filename = parts.at(-1) ?? '';
  const filenameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  const parentFolder = parts.at(-2) ?? '';
  const grandparentFolder = parts.at(-3) ?? '';
  const isCollection = (name: string) => {
    const normalized = name.toLowerCase();
    return normalized.includes('late') || normalized.includes('early') || normalized.includes('lat')
      || normalized.includes('ele') || normalized.includes('pop') || normalized.includes('tec')
      || normalized.includes('ens') || normalized === '20l' || normalized === '20e';
  };

  if (parentFolder && parentFolder !== 'ref' && parentFolder !== 'mov' && !isCollection(parentFolder)) {
    if (grandparentFolder && grandparentFolder !== 'ref' && grandparentFolder !== 'mov' && !isCollection(grandparentFolder)) {
      creatorDisplay = grandparentFolder;
      workTitle = parentFolder;
      recordingTitle = filenameWithoutExt;
    } else {
      creatorDisplay = parentFolder;
      workTitle = filenameWithoutExt;
      recordingTitle = filenameWithoutExt;
    }
  } else {
    workTitle = filenameWithoutExt;
    recordingTitle = filenameWithoutExt;
  }

  const entitySlug = creatorDisplay.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown';
  return { objectKey: key, mediaKind, collectionCode, entitySlug, creatorDisplay, workTitle, recordingTitle };
}

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
    return { sources: [sourceRecord('ref/20 late/Gavin Bryars/The Sinking of the Titanic/Sinking of the Titanic.mp3')], total: 1 };
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
