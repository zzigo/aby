import { error } from '@sveltejs/kit';
import { getAvRepository } from '$lib/server/av-repository';
import { getRepository } from '$lib/server/repository';
import { artifactUrl, playbackUrl, sourceVideoPlaybackUrl } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const capture = await getAvRepository().getCaptureByToken(params.token);
  if (!capture) error(404, 'Capture not found');
  if (capture.avItemId) {
    const item = await getAvRepository().getItem(capture.ownerId, capture.avItemId);
    if (!item) error(404, 'Capture source not found');
    const delivery = item.state === 'available'
      ? await artifactUrl(item.destinationObjectKey, item.technicalMetadata.contentType ?? 'video/mp4')
      : await sourceVideoPlaybackUrl(item.sourceObjectKey);
    return { capture, title: item.title, subtitle: item.director ?? item.entity ?? '', mediaUrl: delivery.url, posterUrl: item.posterUrl ?? '' };
  }
  const asset = await getRepository().getAsset(capture.ownerId, capture.assetId!);
  if (!asset) error(404, 'Capture source not found');
  const delivery = await playbackUrl(asset);
  return { capture, title: asset.canonicalMetadata.recordingTitle, subtitle: asset.canonicalMetadata.creator ?? '', mediaUrl: delivery.url, posterUrl: '' };
};
