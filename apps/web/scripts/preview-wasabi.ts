import { SourceIngestPreviewRequestSchema } from '@zztt/aby-domain';
import { inspectWasabiSource } from '../src/lib/server/ingest';
import { getRepository } from '../src/lib/server/repository';

const [sourceObjectKey, mediaKind, collectionCode, entitySlug, creatorDisplay, workTitle, recordingTitle] = process.argv.slice(2);
const input = SourceIngestPreviewRequestSchema.parse({
  sourceObjectKey,
  mediaKind,
  collectionCode,
  entitySlug,
  creatorDisplay,
  workTitle,
  ...(recordingTitle ? { recordingTitle } : {}),
  analyze: false
});

const preview = await inspectWasabiSource('luciano', input, getRepository());
console.info(JSON.stringify({
  status: 'candidate',
  previewId: preview.id,
  source: preview.objectKey,
  target: preview.candidateMetadata.canonicalObjectKey,
  checksumSha256: preview.checksumSha256,
  technicalMetadata: preview.technicalMetadata,
  candidateMetadata: preview.candidateMetadata,
  provenance: preview.provenance
}, null, 2));
