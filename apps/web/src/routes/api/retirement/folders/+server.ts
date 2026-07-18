import { z } from 'zod';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { deleteVerifiedSourceFolder, listSourceRetirementFolders, verifySourceRetirementFolder } from '$lib/server/source-retirement';
import type { RequestHandler } from './$types';

const FolderSchema = z.object({ folder: z.string().trim().min(1).max(2_048) });

export const GET: RequestHandler = (event) => api('retirement.folders.list', async () => ({
  folders: await listSourceRetirementFolders(ownerFor(event))
}));

export const POST: RequestHandler = (event) => api('retirement.folders.verify', async () => {
  const input = FolderSchema.parse(await jsonBody(event));
  return { verification: await verifySourceRetirementFolder(ownerFor(event), input.folder) };
});

export const DELETE: RequestHandler = (event) => api('retirement.folders.delete', async () => {
  const input = FolderSchema.parse(await jsonBody(event));
  return { deletion: await deleteVerifiedSourceFolder(ownerFor(event), input.folder) };
});
