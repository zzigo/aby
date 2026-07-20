import { z } from 'zod';
import { AbyError, api, jsonBody, ownerFor } from '$lib/server/errors';
import { readConfig } from '$lib/server/config';
import { getAvRepository } from '$lib/server/av-repository';
import { assertAbyObjectKey } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const DestinationEditSchema = z.object({
  destinationObjectKey: z.string().trim().min(1).max(2_000)
});

export const PATCH: RequestHandler = (event) => api('av.operation.destination.update', async () => {
  const input = DestinationEditSchema.parse(await jsonBody(event));
  const config = readConfig();
  const destinationObjectKey = assertAbyObjectKey(input.destinationObjectKey, config.videoPrefix);
  if (!/\.(?:mp4|mov|mkv|vob|m4v|avi|webm)$/i.test(destinationObjectKey)) {
    throw new AbyError('unsupported_av_extension', 'AV destination must retain a supported video extension', 400);
  }
  return getAvRepository().updatePendingDestination(ownerFor(event), event.params.id, destinationObjectKey);
});
