import { ConversionSettingsSchema } from '@zztt/aby-domain';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('settings.get', async () => ({
  conversion: await getRepository().getConversionSettings(ownerFor(event))
}));

export const PATCH: RequestHandler = (event) => api('settings.update', async () => ({
  conversion: await getRepository().saveConversionSettings(
    ownerFor(event), ConversionSettingsSchema.parse(await jsonBody(event))
  )
}));
