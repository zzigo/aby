import type { CandidateMetadata } from '@zztt/aby-domain';

type ImageCandidate = NonNullable<CandidateMetadata['imageCandidates']>[number];

const authorityPriority: Record<string, number> = {
  'manual-upload': 100,
  discogs: 70,
  'cover-art-archive': 60
};

export function sortImageCandidates(candidates: ImageCandidate[] = []): ImageCandidate[] {
  return [...candidates].sort((left, right) =>
    (authorityPriority[right.authority] ?? 0) - (authorityPriority[left.authority] ?? 0)
    || Number(right.exactRelease) - Number(left.exactRelease)
  );
}

export function preferredCoverCandidate(candidates: ImageCandidate[] = []): ImageCandidate | undefined {
  const sorted = sortImageCandidates(candidates);
  return sorted.find((candidate) => candidate.kind === 'cover')
    ?? sorted.find((candidate) => candidate.kind === 'feature');
}

export function preferredCoverUrl(candidates: ImageCandidate[] = []): string | undefined {
  const candidate = preferredCoverCandidate(candidates);
  if (!candidate) return undefined;
  if (candidate.authority !== 'manual-upload' || !candidate.url.startsWith('/api/')) return candidate.url;
  return `${candidate.url}${candidate.url.includes('?') ? '&' : '?'}delivery=2`;
}

export function mergeImageCandidates(...groups: Array<ImageCandidate[] | undefined>): ImageCandidate[] {
  const byIdentity = new Map<string, ImageCandidate>();
  for (const candidate of groups.flatMap((group) => group ?? [])) {
    byIdentity.set(`${candidate.authority}:${candidate.sourceId}:${candidate.kind}`, candidate);
  }
  return sortImageCandidates([...byIdentity.values()]);
}
