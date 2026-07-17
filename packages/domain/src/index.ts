import { z } from 'zod';

export const IdentifierSchema = z.string().uuid();
export type Identifier = z.infer<typeof IdentifierSchema>;

export const ReviewStateSchema = z.enum(['candidate', 'accepted', 'rejected']);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const ProvenanceSchema = z.object({
  method: z.enum(['calculated', 'registered', 'human', 'imported', 'inferred']),
  source: z.string().min(1),
  actorId: z.string().min(1),
  tool: z.string().min(1).optional(),
  toolVersion: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.string().datetime(),
  sourceAssetChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  jobId: IdentifierSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  reviewState: ReviewStateSchema.default('candidate'),
  reviewedBy: z.string().min(1).optional(),
  reviewedAt: z.string().datetime().optional()
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const TechnicalMetadataSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  formatName: z.string().min(1),
  formatLongName: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  bitRate: z.number().int().nonnegative().optional(),
  audioCodec: z.string().optional(),
  sampleRate: z.number().int().positive().optional(),
  channels: z.number().int().positive().optional(),
  channelLayout: z.string().optional(),
  videoCodec: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  tags: z.record(z.string(), z.string()).default({})
});
export type TechnicalMetadata = z.infer<typeof TechnicalMetadataSchema>;

export const CandidateMetadataSchema = z.object({
  title: z.string().min(1),
  recordingTitle: z.string().min(1),
  creator: z.string().optional(),
  date: z.string().optional(),
  entitySlug: z.string().regex(/^[a-z0-9]+$/).optional(),
  collectionCode: z.string().optional(),
  canonicalObjectKey: z.string().optional(),
  identificationCandidates: z.array(z.object({
    authority: z.string().min(1),
    entityType: z.string().min(1),
    externalId: z.string().min(1),
    title: z.string().min(1),
    score: z.number().min(0).max(1),
    canonicalUrl: z.string().url(),
    metadata: z.record(z.string(), z.unknown()).default({})
  })).optional(),
  imageCandidates: z.array(z.object({
    authority: z.string().min(1),
    url: z.string().url(),
    kind: z.enum(['cover', 'feature']),
    exactRelease: z.boolean(),
    sourceId: z.string().min(1),
    provenance: z.record(z.string(), z.unknown()).default({})
  })).optional()
});
export type CandidateMetadata = z.infer<typeof CandidateMetadataSchema>;

export const MediaKindSchema = z.enum(['aud', 'mov']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const CollectionCodeSchema = z.string().regex(
  /^(?:\d{2}(?:E|L|LAT|ELE)?|pop|tec|ens)$/,
  'Use a Luciano-readable collection code such as 20E, 20L, 20LAT, 20ELE, pop, tec or ens'
);
export type CollectionCode = z.infer<typeof CollectionCodeSchema>;

export const EntitySlugSchema = z.string().regex(
  /^[a-z0-9]+$/,
  'Entity folders use lowercase ASCII letters and digits without spaces'
);
export type EntitySlug = z.infer<typeof EntitySlugSchema>;

export const SourceIngestPreviewRequestSchema = z.object({
  sourceObjectKey: z.string().trim().min(1),
  mediaKind: MediaKindSchema,
  collectionCode: CollectionCodeSchema,
  entitySlug: EntitySlugSchema,
  creatorDisplay: z.string().trim().min(1).max(500),
  workTitle: z.string().trim().min(1).max(500),
  recordingTitle: z.string().trim().min(1).max(500).optional(),
  analyze: z.boolean().default(false)
});
export type SourceIngestPreviewRequest = z.infer<typeof SourceIngestPreviewRequestSchema>;

export const IngestPreviewSchema = z.object({
  id: IdentifierSchema,
  ownerId: z.string().min(1),
  provider: z.enum(['local-fixture', 'wasabi', 's3']),
  bucket: z.string().min(1).optional(),
  objectKey: z.string().min(1),
  originalFilename: z.string().min(1),
  originalDirectory: z.string(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  technicalMetadata: TechnicalMetadataSchema,
  candidateMetadata: CandidateMetadataSchema,
  provenance: ProvenanceSchema,
  status: z.enum(['candidate', 'committed', 'rejected']),
  createdAt: z.string().datetime()
});
export type IngestPreview = z.infer<typeof IngestPreviewSchema>;

export const CommitIngestSchema = z.object({
  previewId: IdentifierSchema,
  workTitle: z.string().trim().min(1).max(500),
  recordingTitle: z.string().trim().min(1).max(500)
});
export type CommitIngest = z.infer<typeof CommitIngestSchema>;

export const AssetSchema = z.object({
  id: IdentifierSchema,
  ownerId: z.string().min(1),
  workId: IdentifierSchema,
  recordingId: IdentifierSchema,
  provider: z.enum(['local-fixture', 'wasabi', 's3']),
  bucket: z.string().optional(),
  objectKey: z.string(),
  originalFilename: z.string(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  technicalMetadata: TechnicalMetadataSchema,
  canonicalMetadata: CandidateMetadataSchema,
  provenance: ProvenanceSchema,
  createdAt: z.string().datetime()
});
export type Asset = z.infer<typeof AssetSchema>;

export const SegmentCreateSchema = z.object({
  assetId: IdentifierSchema,
  startTimeMs: z.number().int().nonnegative(),
  endTimeMs: z.number().int().positive(),
  channelSelection: z.array(z.number().int().nonnegative()).default([]),
  fadeInMs: z.number().int().nonnegative().default(0),
  fadeOutMs: z.number().int().nonnegative().default(0),
  label: z.string().trim().max(500).optional()
}).superRefine((value, context) => {
  if (value.endTimeMs <= value.startTimeMs) {
    context.addIssue({ code: 'custom', path: ['endTimeMs'], message: 'endTimeMs must be greater than startTimeMs' });
  }
  const duration = value.endTimeMs - value.startTimeMs;
  if (value.fadeInMs + value.fadeOutMs > duration) {
    context.addIssue({ code: 'custom', path: ['fadeOutMs'], message: 'fades cannot exceed segment duration' });
  }
});
export type SegmentCreate = z.infer<typeof SegmentCreateSchema>;

export const SegmentSchema = SegmentCreateSchema.safeExtend({
  id: IdentifierSchema,
  ownerId: z.string().min(1),
  provenance: ProvenanceSchema,
  state: ReviewStateSchema,
  createdAt: z.string().datetime()
});
export type Segment = z.infer<typeof SegmentSchema>;

export const JobContractSchema = z.object({
  id: IdentifierSchema,
  ownerId: z.string().min(1),
  type: z.enum(['asset.inspect', 'asset.identify', 'asset.analyze', 'segment.analyze', 'derivative.render']),
  idempotencyKey: z.string().min(1),
  analyze: z.boolean().default(false),
  payload: z.record(z.string(), z.unknown()),
  maxAttempts: z.number().int().min(1).max(10).default(3)
});
export type JobContract = z.infer<typeof JobContractSchema>;

export type AbyEvent =
  | { type: 'aby.asset.committed.v1'; assetId: Identifier; ownerId: string; occurredAt: string }
  | { type: 'aby.segment.created.v1'; segmentId: Identifier; assetId: Identifier; ownerId: string; occurredAt: string };
