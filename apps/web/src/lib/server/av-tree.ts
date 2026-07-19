import { basename, extname } from 'node:path';
import type { AvTreeStrategy } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { normalizeObjectKey } from './storage';

function slug(value: string): string {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const result = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!result) throw new AbyError('invalid_av_tree_value', 'Tree values must contain at least one letter or number', 400);
  return result;
}

function titleFolder(title: string, year?: number): string {
  const clean = title.normalize('NFC').replace(/\p{Cc}/gu, '').replaceAll('/', '／').trim();
  if (!clean) throw new AbyError('invalid_av_title', 'AV title cannot be empty', 400);
  return year ? `${year} — ${clean}` : clean;
}

export function authorSurname(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return slug(parts.at(-1) ?? value);
}

export function decadeFolder(year?: number): string {
  return year ? `${Math.floor(year / 10) * 10}s` : 'undated';
}

export function proposeAvDestination(input: {
  sourceObjectKey: string;
  title: string;
  year?: number;
  strategy: AvTreeStrategy;
  treeValue: string;
}): string {
  const extension = extname(input.sourceObjectKey).toLocaleLowerCase();
  if (!['.mp4', '.mov', '.mkv', '.m4v', '.avi', '.webm'].includes(extension)) {
    throw new AbyError('unsupported_av_extension', 'VIEW accepts MP4, MOV, MKV, M4V, AVI or WebM sources', 400);
  }
  const filename = `${slug(basename(input.sourceObjectKey, extension))}${extension}`;
  const decade = decadeFolder(input.year);
  const value = input.strategy === 'author' ? authorSurname(input.treeValue) : slug(input.treeValue);
  const hierarchy = input.strategy === 'author'
    ? [decade, value]
    : input.strategy === 'decade'
      ? [value]
      : input.strategy === 'custom'
        ? [value]
        : [input.strategy, value];
  return normalizeObjectKey(['aby', 'mov', ...hierarchy, titleFolder(input.title, input.year), filename].join('/'));
}
