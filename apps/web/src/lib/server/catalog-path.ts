import { parseTrackFilename } from './track-title';
import { repairLegacyDiacritics } from './text-repair';

export function recordingFolderName(input: {
  releaseDate?: string;
  label?: string;
  fallback: string;
}): string {
  const year = input.releaseDate?.match(/^\d{4}/)?.[0];
  const display = [year, input.label].filter((value): value is string => Boolean(value)).join('-') || input.fallback;
  const folder = display
    .normalize('NFC')
    .replace(/\p{Cc}/gu, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  if (!folder) throw new Error('Recording folder cannot be empty');
  return folder;
}

export function relocatedCatalogObjectKey(source: string, collectionCode: string, entitySlug?: string): string {
  const parts = source.split('/');
  if (parts[0] !== 'aby' || !['aud', 'mov'].includes(parts[1] ?? '') || !parts[2] || !parts[3]) {
    throw new Error('Only canonical aby/aud or aby/mov assets can be relocated');
  }
  parts[2] = collectionCode;
  if (entitySlug) parts[3] = entitySlug;
  for (let index = 4; index < parts.length - 1; index += 1) {
    parts[index] = repairLegacyDiacritics(parts[index]!);
  }
  parts[parts.length - 1] = parseTrackFilename(parts[parts.length - 1]!).filename;
  return parts.join('/');
}
