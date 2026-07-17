import { writable } from 'svelte/store';

export interface PlaybackItem {
  assetId: string;
  title: string;
  subtitle: string;
  url: string;
  startTimeMs?: number;
  endTimeMs?: number;
}

export const currentPlayback = writable<PlaybackItem | null>(null);

export async function loadPlayback(assetId: string, title: string, subtitle: string): Promise<void> {
  const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}/playback`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'Playback URL could not be issued');
  currentPlayback.set({ assetId, title, subtitle, url: body.url });
}

export async function loadSegmentPlayback(
  assetId: string,
  title: string,
  subtitle: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<void> {
  const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}/playback`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'Playback URL could not be issued');
  currentPlayback.set({ assetId, title, subtitle, url: body.url, startTimeMs, endTimeMs });
}
