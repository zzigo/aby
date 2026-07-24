import type { IngestPreview } from '@zztt/aby-domain';
import type { DiscogsReleaseCandidate } from './discogs';
import { composerSurnameSlug } from './media-path';

function discogsTrackNumber(position: string | undefined): number | undefined {
  if (!position) return undefined;
  const match = position.match(/(?:^|[-.])(\d+)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function applyDiscogsToIngestPreview(
  preview: IngestPreview,
  discogs: DiscogsReleaseCandidate,
  fetchedAt = new Date().toISOString()
): IngestPreview {
  const releaseTracks = (discogs.tracklist ?? []).filter((track) => !track.type || track.type === 'track');
  const tracks = preview.candidateMetadata.tracks?.map((track, index) => {
    const releaseTrack = releaseTracks[index];
    const trackNumber = discogsTrackNumber(releaseTrack?.position) ?? track.trackNumber;
    return {
      ...track,
      recordingTitle: releaseTrack?.title ?? track.recordingTitle,
      ...(trackNumber ? { trackNumber } : {})
    };
  });
  const tags = [...new Set([
    ...(preview.candidateMetadata.tags ?? []),
    ...(discogs.genres ?? []),
    ...(discogs.styles ?? [])
  ])];
  const imageCandidates = discogs.coverUrl ? [
    {
      authority: 'discogs',
      url: discogs.coverUrl,
      kind: 'cover' as const,
      exactRelease: true,
      sourceId: discogs.id,
      provenance: { discogsReleaseId: discogs.id }
    },
    ...(preview.candidateMetadata.imageCandidates ?? []).filter((candidate) => candidate.authority !== 'discogs')
  ] : preview.candidateMetadata.imageCandidates;
  const metadataSources = [
    ...(preview.candidateMetadata.metadataSources ?? []).filter((source) => source.authority !== 'discogs'),
    {
      authority: 'discogs',
      externalId: discogs.id,
      canonicalUrl: discogs.canonicalUrl,
      fetchedAt,
      reviewState: 'candidate' as const
    }
  ];
  return {
    ...preview,
    candidateMetadata: {
      ...preview.candidateMetadata,
      title: discogs.title,
      albumTitle: discogs.title,
      creator: discogs.creator,
      albumArtist: discogs.creator,
      entitySlug: composerSurnameSlug(discogs.creator),
      recordingTitle: tracks?.[0]?.recordingTitle ?? preview.candidateMetadata.recordingTitle,
      ...(discogs.releaseDate || discogs.year ? { releaseDate: discogs.releaseDate ?? discogs.year } : {}),
      ...(discogs.label ? { label: discogs.label } : {}),
      ...(discogs.catalogNumber ? { catalogNumber: discogs.catalogNumber } : {}),
      ...(tags.length ? { tags } : {}),
      discogs,
      discogsRefreshedAt: fetchedAt,
      metadataSources,
      ...(imageCandidates ? { imageCandidates } : {}),
      ...(tracks ? { tracks } : {})
    },
    provenance: {
      ...preview.provenance,
      parameters: {
        ...preview.provenance.parameters,
        discogsReleaseId: discogs.id,
        discogsCanonicalUrl: discogs.canonicalUrl
      }
    }
  };
}
