import { readConfig } from '$lib/server/config';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const config = readConfig();
  return Response.json({
    name: 'aby', status: 'ok', version: '0.1.0',
    capabilities: ['work-recording-asset-segment', 'preview-before-write', 'ffprobe-inspection', 'presigned-playback'],
    dependencies: {
      postgres: config.databaseConfigured,
      wasabi: config.wasabiConfigured,
      logto: config.logtoConfigured,
      qdrant: config.qdrantConfigured,
      demoFixture: config.demoMode
    }
  });
};

