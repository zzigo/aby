import { AvSubtitleSettingsSchema } from '@zztt/aby-domain';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.subtitle-settings.get', async () => ({
  settings: await getRepository().getAvSubtitleSettings(ownerFor(event))
}));

export const PATCH: RequestHandler = (event) => api('av.subtitle-settings.update', async () => ({
  settings: await getRepository().saveAvSubtitleSettings(
    ownerFor(event), AvSubtitleSettingsSchema.parse(await jsonBody(event))
  )
}));
