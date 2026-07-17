import type { TechnicalMetadata } from '@zztt/aby-domain';

export function formatDuration(durationMs: number): string {
  const hours = Math.floor(durationMs / 3_600_000);
  const minutes = Math.floor((durationMs % 3_600_000) / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1_000);
  const milliseconds = durationMs % 1_000;
  const clock = `${hours > 0 ? `${hours}:` : ''}${hours > 0 ? String(minutes).padStart(2, '0') : minutes}:${String(seconds).padStart(2, '0')}`;
  return milliseconds > 0 ? `${clock}.${String(milliseconds).padStart(3, '0')}` : clock;
}

export function formatTechnicalFormat(metadata: TechnicalMetadata): string {
  const values = [metadata.formatName, metadata.audioCodec ?? metadata.videoCodec]
    .filter((value): value is string => Boolean(value));
  return [...new Set(values.map((value) => value.toLowerCase()))].join(' · ');
}
