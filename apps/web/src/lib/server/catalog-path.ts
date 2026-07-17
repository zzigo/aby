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
