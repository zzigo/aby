import { AbyError, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { artifactUrl } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const item = await getRepository().getCatalogItem(ownerFor(event), event.params.id);
  if (!item) throw new AbyError('asset_not_found', 'Asset not found', 404);
  const pageNumber = Number(event.params.page);
  const page = item.asset.canonicalMetadata.bookletPages?.find((candidate) => candidate.pageNumber === pageNumber);
  if (!page) throw new AbyError('booklet_page_not_found', 'Booklet page not found', 404);
  const signed = await artifactUrl(page.objectKey, page.contentType);
  return new Response(null, { status: 302, headers: { location: signed.url, 'cache-control': 'private, no-store' } });
};
