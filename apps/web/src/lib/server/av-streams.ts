import { ffprobeFile } from '@zztt/aby-media-ingest';
import type { AvCatalogItem } from '@zztt/aby-domain';
import { readConfig } from './config';

type Streams = Pick<AvCatalogItem['technicalMetadata'], 'audioTracks'|'subtitleTracks'>;
const cache = new Map<string,{expiresAt:number;streams:Streams}>();

export async function selectableAvStreams(cacheKey:string, playbackUrl:string, existing:AvCatalogItem['technicalMetadata']):Promise<Streams> {
  if(existing.audioTracks || existing.subtitleTracks) return { audioTracks:existing.audioTracks??[], subtitleTracks:existing.subtitleTracks??[] };
  const cached=cache.get(cacheKey);
  if(cached&&cached.expiresAt>Date.now()) return cached.streams;
  const config=readConfig();
  try {
    const probe=await ffprobeFile(playbackUrl,{binary:config.FFPROBE_PATH,timeoutMs:config.FFPROBE_TIMEOUT_MS});
    const streams={audioTracks:probe.metadata.audioTracks??[],subtitleTracks:probe.metadata.subtitleTracks??[]};
    cache.set(cacheKey,{expiresAt:Date.now()+30*60_000,streams});
    return streams;
  } catch { return {audioTracks:[],subtitleTracks:[]}; }
}
