import type { CandidateMetadata } from '@zztt/aby-domain';

type IngestTrack = NonNullable<CandidateMetadata['tracks']>[number];

export interface IngestTrackEdit {
  key: string;
  objectKey: string;
  recordingTitle: string;
  trackNumber?: number;
}

export function buildIngestTrackEdits(
  tracks: IngestTrack[] = [],
  preserved: IngestTrackEdit[] = []
): IngestTrackEdit[] {
  return tracks.map((track, index) => ({
    key: `${track.canonicalObjectKey}\u001f${track.originalFilename}\u001f${index}`,
    objectKey: track.objectKey,
    recordingTitle: preserved[index]?.recordingTitle || track.recordingTitle,
    ...(track.trackNumber !== undefined ? { trackNumber: track.trackNumber } : {})
  }));
}
