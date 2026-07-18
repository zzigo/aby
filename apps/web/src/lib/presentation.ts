import type { TechnicalMetadata } from '@zztt/aby-domain';

export function formatDuration(durationMs: number): string {
  const hours = Math.floor(durationMs / 3_600_000);
  const minutes = Math.floor((durationMs % 3_600_000) / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1_000);
  const hundredths = Math.floor((durationMs % 1_000) / 10);
  const hh = hours > 0 ? `${String(hours).padStart(2, '0')}:` : '';
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const ml = String(hundredths).padStart(2, '0');
  return `${hh}${mm}:${ss}.${ml}`;
}

export function formatTechnicalFormat(metadata: TechnicalMetadata): string {
  const values = [metadata.formatName, metadata.audioCodec ?? metadata.videoCodec]
    .filter((value): value is string => Boolean(value));
  return [...new Set(values.map((value) => value.toLowerCase()))].join(' · ');
}

export function displayTrackTitle(title: string, trackNumber?: number): string {
  const trimmed = title.trim();
  const placeholder = trimmed.match(/^track(?:\s+(\d{1,3}))?$/i);
  if (!placeholder) return trimmed;
  return String(trackNumber ?? (placeholder[1] ? Number(placeholder[1]) : '—'));
}
