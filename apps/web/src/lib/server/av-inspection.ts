import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import type { AvCatalogItem } from '@zztt/aby-domain';
import { ffprobeFile } from '@zztt/aby-media-ingest';
import { AbyError } from './errors';
import { readConfig } from './config';
import { assertSourceObjectKey, headWasabiSourceObject, listWasabiSidecarSubtitles, sourceVideoPlaybackUrl } from './storage';

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mov', '.vob', '.mp4', '.m4v', '.avi', '.webm']);
const INSPECTION_TTL_MS = 30 * 60_000;

export type AvInspection = {
  id: string;
  ownerId: string;
  sourceObjectKey: string;
  originalFilename: string;
  playbackUrl: string;
  playbackExpiresAt: string;
  technicalMetadata: AvCatalogItem['technicalMetadata'];
  sidecarSubtitles: Array<{ sourceObjectKey: string; language?: string; title?: string; forced?: boolean; hearingImpaired?: boolean; sizeBytes: number }>;
  embeddedMetadata: {
    title: string;
    originalTitle?: string;
    year?: number;
    director?: string;
    country?: string;
    languages: string[];
    summary?: string;
    tags: Record<string, string>;
  };
  probeState: 'ok' | 'partial';
  inspectedAt: string;
  expiresAt: number;
};

const inspections = new Map<string, AvInspection>();

function tag(tags: Record<string, string>, ...names: string[]) {
  const wanted = new Set(names.map((name) => name.toLocaleLowerCase()));
  return Object.entries(tags).find(([name]) => wanted.has(name.toLocaleLowerCase()))?.[1]?.trim() || undefined;
}

function parsedYear(value?: string) {
  const match = value?.match(/\b(18|19|20|21)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function pruneInspections() {
  const current = Date.now();
  for (const [id, inspection] of inspections) if (inspection.expiresAt <= current) inspections.delete(id);
}

function describeSidecar(objectKey: string) {
  const stem = basename(objectKey).replace(/\.srt$/i, '');
  const parts = stem.split(/[._-]+/);
  const language = [...parts].reverse().find((part) => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(part))?.toLocaleLowerCase();
  return {
    ...(language ? { language } : {}),
    ...(parts.some((part) => /^forced$/i.test(part)) ? { forced: true } : {}),
    ...(parts.some((part) => /^(sdh|hi|hearing.?impaired)$/i.test(part)) ? { hearingImpaired: true } : {}),
    title: basename(objectKey)
  };
}

export async function discoverAvSidecars(sourceObjectKey: string) {
  const sidecars = await listWasabiSidecarSubtitles(sourceObjectKey);
  return sidecars.map((sidecar) => ({ ...sidecar, ...describeSidecar(sidecar.objectKey), sourceObjectKey: sidecar.objectKey }));
}

export async function inspectAvSource(ownerId: string, requestedKey: string): Promise<AvInspection> {
  const config = readConfig();
  const sourceObjectKey = assertSourceObjectKey(requestedKey, [config.sourceVideoPrefix]);
  if (!VIDEO_EXTENSIONS.has(extname(sourceObjectKey).toLocaleLowerCase())) {
    throw new AbyError('unsupported_video_source', 'Choose an MKV, MOV, VOB, MP4, M4V, AVI or WebM source', 400);
  }
  const [head, playback, sidecars] = await Promise.all([
    headWasabiSourceObject(sourceObjectKey),
    sourceVideoPlaybackUrl(sourceObjectKey),
    discoverAvSidecars(sourceObjectKey)
  ]);
  const originalFilename = basename(sourceObjectKey);
  let technicalMetadata: AvCatalogItem['technicalMetadata'] = {
    sizeBytes: head.sizeBytes ?? 0,
    ...(head.contentType ? { contentType: head.contentType } : {}),
    ...(head.etag ? { etag: head.etag } : {})
  };
  let tags: Record<string, string> = {};
  let probeState: AvInspection['probeState'] = 'partial';
  try {
    const probe = await ffprobeFile(playback.url, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });
    tags = probe.metadata.tags;
    technicalMetadata = {
      ...technicalMetadata,
      ...(probe.metadata.durationMs ? { durationMs: probe.metadata.durationMs } : {}),
      ...(probe.metadata.videoCodec ? { videoCodec: probe.metadata.videoCodec } : {}),
      ...(probe.metadata.audioCodec ? { audioCodec: probe.metadata.audioCodec } : {}),
      ...(probe.metadata.width ? { width: probe.metadata.width } : {}),
      ...(probe.metadata.height ? { height: probe.metadata.height } : {}),
      ...(probe.metadata.audioTracks ? { audioTracks: probe.metadata.audioTracks } : {}),
      ...(probe.metadata.subtitleTracks ? { subtitleTracks: probe.metadata.subtitleTracks } : {})
    };
    probeState = 'ok';
  } catch {
    // A remote container can require a full seek or an unsupported protocol. HEAD data remains a valid partial inspection.
  }
  const fallbackTitle = originalFilename.replace(/\.[^.]+$/, '').replaceAll(/[._]+/g, ' ').trim() || 'Untitled video';
  const embeddedTitle = tag(tags, 'title', 'show', 'name') || fallbackTitle;
  const originalTitle = tag(tags, 'originaltitle', 'original_title');
  const year = parsedYear(tag(tags, 'date', 'year', 'releasedate', 'creation_time'));
  const director = tag(tags, 'director', 'artist', 'author');
  const language = tag(tags, 'language', 'languages');
  const country = tag(tags, 'country');
  const summary = tag(tags, 'description', 'comment', 'synopsis');
  const inspectedAt = new Date().toISOString();
  const inspection: AvInspection = {
    id: randomUUID(), ownerId, sourceObjectKey, originalFilename,
    playbackUrl: playback.url, playbackExpiresAt: playback.expiresAt,
    technicalMetadata, sidecarSubtitles: sidecars,
    embeddedMetadata: {
      title: embeddedTitle,
      ...(originalTitle ? { originalTitle } : {}),
      ...(year ? { year } : {}),
      ...(director ? { director } : {}),
      ...(country ? { country } : {}),
      languages: language ? language.split(/[,;/]/).map((value) => value.trim()).filter(Boolean) : [],
      ...(summary ? { summary } : {}), tags
    },
    probeState, inspectedAt, expiresAt: Date.now() + INSPECTION_TTL_MS
  };
  pruneInspections();
  inspections.set(inspection.id, inspection);
  return structuredClone(inspection);
}

export function getAvInspection(ownerId: string, id: string, sourceObjectKey: string) {
  pruneInspections();
  const inspection = inspections.get(id);
  return inspection?.ownerId === ownerId && inspection.sourceObjectKey === sourceObjectKey ? structuredClone(inspection) : null;
}
