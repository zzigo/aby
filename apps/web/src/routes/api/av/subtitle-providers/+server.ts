import { api, ownerFor } from '$lib/server/errors';
import { readConfig } from '$lib/server/config';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.subtitle-providers', async () => {
  ownerFor(event);
  const config = readConfig();
  return {
    providers: [
      {
        id: 'embedded', label: 'EMBEDDED TRACKS', state: 'READY',
        detail: 'ffprobe indexes audio and subtitle streams; Aby extracts a selected subtitle to WebVTT on demand.'
      },
      {
        id: 'opensubtitles', label: 'OPENSUBTITLES', state: config.openSubtitlesConfigured ? 'READY' : 'NEEDS API KEY',
        detail: config.openSubtitlesConfigured ? 'API key configured. External discovery can use canonical IMDb metadata.' : 'Set OPENSUBTITLES_API_KEY in the production environment.'
      },
      {
        id: 'whisperx', label: 'WHISPERX', state: 'PLANNED',
        detail: 'Local transcript generation is kept separate from provider downloads and is never started during catalog commit.'
      }
    ]
  };
});
