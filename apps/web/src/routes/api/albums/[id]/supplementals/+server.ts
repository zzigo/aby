import { z } from 'zod';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { adoptBookletPage, scoreDestination } from '$lib/server/album-supplementals';
import { getRepository } from '$lib/server/repository';
import { copyWasabiSupplementalObject, listWasabiSupplementalFiles } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const CropSchema = z.object({
  x: z.number().min(0).max(99), y: z.number().min(0).max(99),
  width: z.number().positive().max(100), height: z.number().positive().max(100)
}).refine((crop) => crop.x + crop.width <= 100 && crop.y + crop.height <= 100, 'Crop must remain inside the page');

const ApplySchema = z.object({
  entries: z.array(z.object({
    sourceObjectKey: z.string().trim().min(1),
    role: z.enum(['booklet', 'score', 'discarded']),
    pageNumber: z.number().int().positive().max(999).optional(),
    sourcePage: z.number().int().positive().max(10_000).optional(),
    crop: CropSchema.optional()
  })).min(1).max(100)
});

async function albumItems(ownerId: string, albumId: string) {
  const items = (await getRepository().listCatalog(ownerId)).filter((item) => item.albumId === albumId);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);
  return items;
}

function sourceAnchor(item: Awaited<ReturnType<typeof albumItems>>[number]): string {
  const provenanceSource = item.asset.provenance.parameters?.sourceObjectKey;
  return item.asset.originalObjectKey
    ?? (typeof provenanceSource === 'string' ? provenanceSource : undefined)
    ?? item.asset.objectKey;
}

export const GET: RequestHandler = (event) => api('album.supplementals.list', async () => {
  const items = await albumItems(ownerFor(event), event.params.id);
  const level = Math.min(8, Math.max(0, Number(event.url.searchParams.get('level') ?? 0) || 0));
  const anchor = sourceAnchor(items[0]!);
  const files = await listWasabiSupplementalFiles(anchor, level);
  const directory = files[0]?.objectKey.split('/').slice(0, -1).join('/')
    ?? anchor.split('/').slice(0, -(level + 1)).join('/');
  return {
    anchor, level, directory, files,
    bookletPages: items[0]!.asset.canonicalMetadata.bookletPages ?? [],
    decisions: items[0]!.asset.canonicalMetadata.supplementalFiles ?? [],
    scoreDestinationRoot: 'wasabi/libros/scores'
  };
});

export const POST: RequestHandler = (event) => api('album.supplementals.apply', async () => {
  const ownerId = ownerFor(event);
  const items = await albumItems(ownerId, event.params.id);
  const input = ApplySchema.parse(await jsonBody(event));
  const first = items[0]!;
  const albumTitle = first.albumTitle ?? first.workTitle;
  let pages = [...(first.asset.canonicalMetadata.bookletPages ?? [])];
  let decisions = [...(first.asset.canonicalMetadata.supplementalFiles ?? [])];

  for (const entry of input.entries) {
    decisions = decisions.filter((decision) => decision.sourceObjectKey !== entry.sourceObjectKey);
    pages = pages.filter((page) => page.sourceObjectKey !== entry.sourceObjectKey && (entry.pageNumber === undefined || page.pageNumber !== entry.pageNumber));
    if (entry.role === 'booklet') {
      if (!entry.pageNumber) throw new AbyError('booklet_page_missing', 'Assign a booklet page number', 400);
      const page = await adoptBookletPage({
        albumObjectKey: first.asset.objectKey, albumTitle, sourceObjectKey: entry.sourceObjectKey,
        pageNumber: entry.pageNumber, ...(entry.sourcePage ? { sourcePage: entry.sourcePage } : {}),
        ...(entry.crop ? { crop: entry.crop } : {})
      });
      pages.push(page);
      decisions.push({ sourceObjectKey: entry.sourceObjectKey, role: 'booklet', destinationObjectKey: page.objectKey, pageNumber: page.pageNumber, decidedAt: new Date().toISOString() });
    } else if (entry.role === 'score') {
      const destinationObjectKey = scoreDestination(albumTitle, entry.sourceObjectKey);
      await copyWasabiSupplementalObject(entry.sourceObjectKey, destinationObjectKey);
      decisions.push({ sourceObjectKey: entry.sourceObjectKey, role: 'score', destinationObjectKey, decidedAt: new Date().toISOString() });
    } else {
      decisions.push({ sourceObjectKey: entry.sourceObjectKey, role: 'discarded', decidedAt: new Date().toISOString() });
    }
  }
  pages.sort((left, right) => left.pageNumber - right.pageNumber);
  const updated = await getRepository().mergeAlbumMetadata(ownerId, event.params.id, { bookletPages: pages, supplementalFiles: decisions });
  return { items: updated, bookletPages: pages, decisions };
});
