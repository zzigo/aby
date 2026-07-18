import { basename, extname } from 'node:path';

export interface ParsedTrackTitle {
  title: string;
  trackNumber?: number;
}

export function parseTrackTitle(value: string): ParsedTrackTitle {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,3})(?:\s*[.\-_–—:)]+\s*|\s+)(.+?)\s*$/u);
  if (!match?.[1] || !match[2]) return { title: trimmed };
  const trackNumber = Number(match[1]);
  return { title: match[2].replace(/\s+/g, ' ').trim(), ...(trackNumber > 0 ? { trackNumber } : {}) };
}

export function parseTrackFilename(originalFilename: string): ParsedTrackTitle & { filename: string } {
  const extension = extname(originalFilename).toLowerCase();
  const parsed = parseTrackTitle(basename(originalFilename, extname(originalFilename)));
  const prefix = parsed.trackNumber === undefined ? '' : `${String(parsed.trackNumber).padStart(2, '0')}-`;
  return { ...parsed, filename: `${prefix}${parsed.title}${extension}` };
}
