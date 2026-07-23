import { basename, extname } from 'node:path';
import type { CatalogItem } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { normalizeObjectKey } from './storage';
import { parseTrackTitle } from './track-title';

export function humanPathSegment(value: string): string {
  const clean = value.normalize('NFC')
    .replace(/\p{Cc}/gu, '')
    .replace(/[\\/]+/g, '／')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  if (!clean || clean === '.' || clean === '..') {
    throw new AbyError('invalid_media_path_segment', 'Path segments cannot be empty', 400);
  }
  return clean;
}

export function validateCollectionCode(value: string): string {
  const clean = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(clean)) {
    throw new AbyError('invalid_collection_code', 'Collections use 1–20 letters, numbers, underscores or hyphens', 400);
  }
  return clean;
}

export function validateEntitySlug(value: string): string {
  const clean = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(clean)) {
    throw new AbyError('invalid_entity_slug', 'Entity folders use lowercase letters, numbers, underscores or hyphens', 400);
  }
  return clean;
}

export function audioDestinationPrefix(input: {
  collectionCode: string;
  entitySlug: string;
  container: string;
}): string {
  return normalizeObjectKey([
    'aby', 'aud', validateCollectionCode(input.collectionCode),
    validateEntitySlug(input.entitySlug), humanPathSegment(input.container)
  ].join('/'));
}

export function validateAudioDestinationPrefix(value: string): string {
  const key = normalizeObjectKey(value).replace(/\/+$/, '');
  const parts = key.split('/');
  if (parts.length !== 5 || parts[0] !== 'aby' || parts[1] !== 'aud') {
    throw new AbyError(
      'invalid_audio_destination',
      'Audio destinations use aby/aud/<collection>/<entity>/<album-or-set>',
      400
    );
  }
  validateCollectionCode(parts[2]!);
  validateEntitySlug(parts[3]!);
  humanPathSegment(parts[4]!);
  return key;
}

export function canonicalTrackFilename(item: CatalogItem): string {
  const extension = extname(item.asset.objectKey).toLocaleLowerCase();
  const parsed = parseTrackTitle(item.recordingTitle, {
    creator: item.creator,
    albumTitle: item.albumTitle
  });
  const trackNumber = item.trackNumber ?? parsed.trackNumber;
  const prefix = trackNumber === undefined ? '' : `${String(trackNumber).padStart(2, '0')}-`;
  return `${prefix}${humanPathSegment(parsed.title)}${extension}`;
}

export function audioTargetObjectKey(prefix: string, item: CatalogItem): string {
  return `${validateAudioDestinationPrefix(prefix)}/${canonicalTrackFilename(item)}`;
}

function comparable(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function audioPathAnomalies(objectKey: string, metadataCollection?: string): string[] {
  const parts = normalizeObjectKey(objectKey).split('/');
  const anomalies: string[] = [];
  if (parts[0] !== 'aby' || parts[1] !== 'aud') return ['outside canonical audio boundary'];
  if (parts.length > 6) anomalies.push('redundant album folder layer');
  if (parts.length < 6) anomalies.push('incomplete canonical hierarchy');
  if (parts[2] && metadataCollection && parts[2] !== metadataCollection) anomalies.push('path and metadata collection differ');
  const folders = parts.slice(4, -1);
  if (folders.some((folder, index) => index > 0 && comparable(folder) === comparable(folders[index - 1]!))) {
    anomalies.push('repeated semantic folder');
  }
  return anomalies;
}

export function currentAudioPrefix(objectKey: string): string {
  const parts = normalizeObjectKey(objectKey).split('/');
  return parts.slice(0, -1).join('/');
}

export function currentVideoPrefix(objectKey: string): string {
  const key = normalizeObjectKey(objectKey);
  return key.slice(0, Math.max(0, key.length - basename(key).length)).replace(/\/+$/, '');
}
