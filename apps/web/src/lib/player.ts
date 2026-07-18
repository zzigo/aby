import { get, writable } from 'svelte/store';

export type PlaybackMode = 'continuous' | 'loop-track' | 'random';

export interface PlaybackContextItem {
  assetId: string;
  title: string;
  subtitle: string;
  albumId?: string;
  trackNumber?: number;
}

export interface PlaybackItem extends PlaybackContextItem {
  url: string;
  startTimeMs?: number;
  endTimeMs?: number;
}

export interface PlaybackLoop {
  assetId: string;
  startTimeMs: number;
  endTimeMs: number;
}

export const currentPlayback = writable<PlaybackItem | null>(null);
export const currentPlaybackTimeMs = writable<number>(0);
export const playbackMode = writable<PlaybackMode>('continuous');
export const playbackLoop = writable<PlaybackLoop | null>(null);
const playbackCatalog = writable<PlaybackContextItem[]>([]);

function trackOrder(left: PlaybackContextItem, right: PlaybackContextItem) {
  return (left.trackNumber ?? Number.MAX_SAFE_INTEGER) - (right.trackNumber ?? Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title, undefined, { numeric: true });
}

export function setPlaybackCatalog(items: PlaybackContextItem[]): void {
  playbackCatalog.set(items);
}

export function nextPlaybackItem(
  catalog: PlaybackContextItem[],
  current: PlaybackContextItem,
  mode: PlaybackMode,
  random: () => number = Math.random
): PlaybackContextItem | null {
  if (mode === 'loop-track') return current;
  if (mode === 'random') {
    const candidates = catalog.length > 1
      ? catalog.filter((item) => item.assetId !== current.assetId)
      : catalog;
    if (!candidates.length) return null;
    return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))] ?? null;
  }
  if (!current.albumId) return null;
  const album = catalog.filter((item) => item.albumId === current.albumId).sort(trackOrder);
  const currentIndex = album.findIndex((item) => item.assetId === current.assetId);
  return currentIndex >= 0 ? album[currentIndex + 1] ?? null : null;
}

async function loadContextPlayback(item: PlaybackContextItem): Promise<void> {
  const response = await fetch(`/api/assets/${encodeURIComponent(item.assetId)}/playback`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'Playback URL could not be issued');
  currentPlayback.set({ ...item, url: body.url });
}

export async function advancePlayback(): Promise<boolean> {
  const current = get(currentPlayback);
  if (!current) return false;
  const next = nextPlaybackItem(get(playbackCatalog), current, get(playbackMode));
  if (!next) return false;
  await loadContextPlayback(next);
  return true;
}

export async function stepPlayback(direction: -1 | 1): Promise<boolean> {
  const current = get(currentPlayback);
  if (!current) return false;
  const catalog = get(playbackCatalog);
  const ordered = current.albumId
    ? catalog.filter((item) => item.albumId === current.albumId).sort(trackOrder)
    : catalog;
  const index = ordered.findIndex((item) => item.assetId === current.assetId);
  const next = index >= 0 ? ordered[index + direction] : undefined;
  if (!next) return false;
  playbackLoop.set(null);
  await loadContextPlayback(next);
  return true;
}

export async function loadPlayback(
  assetId: string,
  title: string,
  subtitle: string,
  context: Pick<PlaybackContextItem, 'albumId' | 'trackNumber'> = {}
): Promise<void> {
  await loadContextPlayback({ assetId, title, subtitle, ...context });
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
