import { basename, extname } from 'node:path';
import { repairLegacyDiacritics } from './text-repair';

export interface ParsedTrackTitle {
  title: string;
  trackNumber?: number;
}

export interface TrackTitleContext {
  creator?: string;
  albumTitle?: string;
}

function comparable(value: string): string {
  return repairLegacyDiacritics(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function parseContextualTitle(value: string, context?: TrackTitleContext): ParsedTrackTitle | null {
  if (!context?.creator?.trim() || !context.albumTitle?.trim()) return null;
  const pieces = repairLegacyDiacritics(value).trim().split(/\s+[-–—]\s+/u);
  if (pieces.length < 4) return null;
  const wantedCreator = comparable(context.creator);
  const wantedAlbum = comparable(context.albumTitle);

  for (let creatorEnd = 1; creatorEnd < pieces.length - 2; creatorEnd += 1) {
    if (comparable(pieces.slice(0, creatorEnd).join(' - ')) !== wantedCreator) continue;
    for (let albumEnd = creatorEnd + 1; albumEnd < pieces.length - 1; albumEnd += 1) {
      if (comparable(pieces.slice(creatorEnd, albumEnd).join(' - ')) !== wantedAlbum) continue;
      const numberPart = pieces[albumEnd]?.trim();
      if (!/^\d{1,3}$/.test(numberPart ?? '')) continue;
      const title = pieces.slice(albumEnd + 1).join(' - ').replace(/\s+/g, ' ').trim();
      const trackNumber = Number(numberPart);
      if (title && trackNumber > 0) return { title, trackNumber };
    }
  }
  return null;
}

export function parseTrackTitle(value: string, context?: TrackTitleContext): ParsedTrackTitle {
  const trimmed = repairLegacyDiacritics(value).trim();
  const contextual = parseContextualTitle(trimmed, context);
  if (contextual) return contextual;
  const match = trimmed.match(/^(\d{1,3})(?:\s*[.\-_–—:)]+\s*|\s+)(.+?)\s*$/u);
  if (!match?.[1] || !match[2]) return { title: trimmed };
  const trackNumber = Number(match[1]);
  const title = match[2].replace(/\s+/g, ' ').trim();
  const placeholder = title.match(/^track(?:\s+(\d{1,3}))?$/i);
  const visibleTitle = placeholder && (!placeholder[1] || Number(placeholder[1]) === trackNumber) ? String(trackNumber) : title;
  return { title: visibleTitle, ...(trackNumber > 0 ? { trackNumber } : {}) };
}

export function parseTrackFilename(originalFilename: string, context?: TrackTitleContext): ParsedTrackTitle & { filename: string } {
  const extension = extname(originalFilename).toLowerCase();
  const parsed = parseTrackTitle(basename(originalFilename, extname(originalFilename)), context);
  const prefix = parsed.trackNumber === undefined ? '' : `${String(parsed.trackNumber).padStart(2, '0')}-`;
  return { ...parsed, filename: `${prefix}${parsed.title}${extension}` };
}
