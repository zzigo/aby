import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AbyError, api, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { artifactUrl, sourceVideoPlaybackUrl } from '$lib/server/storage';
import { readConfig } from '$lib/server/config';
import type { RequestHandler } from './$types';

const execFileAsync=promisify(execFile);

export const GET:RequestHandler=(event)=>api('av.item.subtitle',async()=>{
  const item=await getAvRepository().getItem(ownerFor(event),event.params.id);
  if(!item) throw new AbyError('av_item_not_found','AV item not found',404);
  const stream=Number(event.params.stream);
  if(!Number.isInteger(stream)||stream<0) throw new AbyError('invalid_subtitle_stream','Subtitle stream must be a non-negative integer',400);
  const delivery=await (item.state==='available'?artifactUrl(item.destinationObjectKey,item.technicalMetadata.contentType??'video/mp4'):sourceVideoPlaybackUrl(item.sourceObjectKey));
  const config=readConfig();
  try {
    const {stdout}=await execFileAsync(config.FFMPEG_PATH,['-v','error','-i',delivery.url,'-map',`0:${stream}`,'-f','webvtt','pipe:1'],{timeout:config.FFMPEG_ANALYSIS_TIMEOUT_MS,maxBuffer:20*1024*1024});
    return new Response(stdout,{headers:{'content-type':'text/vtt; charset=utf-8','cache-control':'private, max-age=300'}});
  } catch { throw new AbyError('subtitle_extraction_failed','This subtitle track could not be converted to WebVTT',422); }
});
