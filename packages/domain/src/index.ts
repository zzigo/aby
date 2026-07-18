import { z } from 'zod';

export const IdentifierSchema = z.string().uuid();
export type Identifier = z.infer<typeof IdentifierSchema>;

export const ReviewStateSchema = z.enum(['candidate', 'accepted', 'rejected']);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const SourceContextSchema = z.enum(['manual_selection', 'mobile_draft', 'studio_validated', 'auto_boundary']);
export type SourceContext = z.infer<typeof SourceContextSchema>;

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

export const AlbumRoleSchema = z.object({
  name: z.string().trim().min(1).max(500),
  role: z.string().trim().min(1).max(200),
  tracks: z.string().trim().max(200).optional(),
  externalId: z.string().trim().max(200).optional(),
  authority: z.string().trim().max(100).optional()
});
export type AlbumRole = z.infer<typeof AlbumRoleSchema>;

export const CandidateMetadataSchema = z.object({
  title: z.string().min(1),
  recordingTitle: z.string().min(1),
  albumTitle: z.string().min(1).optional(),
  trackNumber: z.number().int().positive().optional(),
  recordingFolder: z.string().min(1).optional(),
  creator: z.string().optional(),
  albumArtist: z.string().optional(),
  albumDurationMs: z.number().int().nonnegative().optional(),
  albumTags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  genres: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  styles: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  roles: z.array(AlbumRoleSchema).max(250).optional(),
  notes: z.string().trim().max(20_000).optional(),
  albumNotes: z.string().trim().max(20_000).optional(),
  waveform: z.object({
    artifactObjectKey: z.string().min(1),
    sourceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    generatedAt: z.string().datetime()
  }).optional(),
  storageRetirementCandidates: z.array(z.object({
    sourceObjectKey: z.string().min(1),
    targetObjectKey: z.string().min(1),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(['candidate', 'retired']),
    copiedAt: z.string().datetime(),
    retiredAt: z.string().datetime().optional()
  })).max(250).optional(),
  date: z.string().optional(),
  releaseDate: z.string().optional(),
  label: z.string().optional(),
  catalogNumber: z.string().optional(),
  entitySlug: z.string().regex(/^[a-z0-9]+$/).optional(),
  collectionCode: z.string().optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
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
    url: z.string().min(1),
    kind: z.enum(['cover', 'feature']),
    exactRelease: z.boolean(),
    sourceId: z.string().min(1),
    provenance: z.record(z.string(), z.unknown()).default({})
  })).optional(),
  wikidata: z.object({
    qid: z.string(),
    label: z.string(),
    description: z.string(),
    imageUrl: z.string().url().optional(),
    birthDate: z.string().optional()
  }).optional(),
  discogs: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    creator: z.string().min(1),
    year: z.string().optional(),
    label: z.string().optional(),
    catalogNumber: z.string().optional(),
    coverUrl: z.string().url().optional(),
    canonicalUrl: z.string().url(),
    releaseDate: z.string().optional(),
    country: z.string().optional(),
    labels: z.array(z.object({
      name: z.string().min(1),
      catalogNumber: z.string().optional(),
      externalId: z.string().optional(),
      entityType: z.string().optional()
    })).optional(),
    companies: z.array(z.object({
      name: z.string().min(1),
      role: z.string().optional(),
      catalogNumber: z.string().optional(),
      externalId: z.string().optional()
    })).optional(),
    credits: z.array(z.object({
      name: z.string().min(1),
      role: z.string().min(1),
      tracks: z.string().optional(),
      externalId: z.string().optional()
    })).optional(),
    genres: z.array(z.string()).optional(),
    styles: z.array(z.string()).optional(),
    formats: z.array(z.object({
      name: z.string().min(1),
      quantity: z.string().optional(),
      descriptions: z.array(z.string()).optional()
    })).optional(),
    tracklist: z.array(z.object({
      position: z.string().optional(),
      title: z.string().min(1),
      duration: z.string().optional(),
      type: z.string().optional()
    })).optional(),
    dataQuality: z.string().optional(),
    notes: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional()
  }).optional(),
  discogsRefreshedAt: z.string().datetime().optional(),
  metadataSources: z.array(z.object({
    authority: z.string().min(1),
    externalId: z.string().min(1),
    canonicalUrl: z.string().url(),
    fetchedAt: z.string().datetime(),
    reviewState: ReviewStateSchema
  })).optional(),
  derivatives: z.array(z.object({
    kind: z.string(),
    objectKey: z.string(),
    format: z.string(),
    codec: z.string(),
    quality: z.number().optional(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    sourceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    metadataVersion: z.string().optional(),
    createdAt: z.string().datetime()
  })).optional(),
  tracks: z.array(z.object({
    objectKey: z.string(),
    sourceObjectKey: z.string().optional(),
    canonicalObjectKey: z.string(),
    originalFilename: z.string(),
    checksumSha256: z.string(),
    technicalMetadata: TechnicalMetadataSchema,
    recordingTitle: z.string(),
    trackNumber: z.number().int().positive().optional()
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

export const PromoteIngestSchema = z.object({
  previewId: IdentifierSchema
});
export type PromoteIngest = z.infer<typeof PromoteIngestSchema>;

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
  recordingTitle: z.string().trim().min(1).max(500),
  albumTitle: z.string().trim().max(500).optional(),
  creator: z.string().trim().max(500).optional(),
  date: z.string().trim().max(500).optional(),
  releaseDate: z.string().trim().max(500).optional(),
  label: z.string().trim().max(500).optional(),
  catalogNumber: z.string().trim().max(500).optional(),
  tracks: z.array(z.object({
    objectKey: z.string().min(1),
    recordingTitle: z.string().trim().min(1).max(500),
    trackNumber: z.number().int().positive().optional()
  })).optional()
});
export type CommitIngest = z.infer<typeof CommitIngestSchema>;

export const AssetSchema = z.object({
  id: IdentifierSchema,
  ownerId: z.string().min(1),
  workId: IdentifierSchema,
  recordingId: IdentifierSchema,
  albumId: IdentifierSchema.optional(),
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

export const CatalogSegmentSchema = z.object({
  id: IdentifierSchema,
  startTimeMs: z.number().int().nonnegative(),
  endTimeMs: z.number().int().positive(),
  label: z.string().optional(),
  sourceContext: SourceContextSchema.optional()
});
export type CatalogSegment = z.infer<typeof CatalogSegmentSchema>;

export const TimedTextCueSchema = z.object({
  id: IdentifierSchema.optional(),
  position: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().positive().nullable(),
  text: z.string().min(1).max(20_000),
  speaker: z.string().max(500).nullable().optional(),
  words: z.array(z.object({
    text: z.string().min(1).max(500),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive()
  })).default([])
});
export type TimedTextCue = z.infer<typeof TimedTextCueSchema>;

export const TimedTextDocumentSchema = z.object({
  id: IdentifierSchema,
  assetId: IdentifierSchema,
  provider: z.string().min(1).max(100),
  providerItemId: z.string().max(500).nullable().optional(),
  textType: z.enum(['lyrics', 'subtitles', 'transcript']),
  language: z.string().min(1).max(20),
  originalFormat: z.enum(['plain', 'lrc', 'enhanced-lrc', 'srt', 'vtt', 'ass', 'ttml', 'json']),
  syncLevel: z.enum(['none', 'line', 'word']),
  originalText: z.string().max(1_000_000).nullable().optional(),
  plainText: z.string().max(1_000_000),
  offsetMs: z.number().int(),
  timeScale: z.number().positive(),
  matchConfidence: z.number().min(0).max(1).nullable().optional(),
  humanVerified: z.boolean(),
  licenseStatus: z.string().min(1).max(100),
  retrievedAt: z.string().datetime(),
  cues: z.array(TimedTextCueSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type TimedTextDocument = z.infer<typeof TimedTextDocumentSchema>;

export const LyricsEditSchema = z.object({
  plainLyrics: z.string().trim().max(1_000_000),
  syncedLyrics: z.string().trim().max(1_000_000).nullable().optional(),
  language: z.string().trim().min(1).max(20).default('und'),
  provider: z.string().trim().min(1).max(100).default('manual'),
  providerItemId: z.string().trim().max(500).nullable().optional(),
  matchConfidence: z.number().min(0).max(1).nullable().optional(),
  licenseStatus: z.string().trim().min(1).max(100).default('user-provided')
}).refine((value) => value.plainLyrics.length > 0 || Boolean(value.syncedLyrics?.length), {
  message: 'Add plain or synchronized lyrics'
});
export type LyricsEdit = z.infer<typeof LyricsEditSchema>;

export const CatalogItemSchema = z.object({
  asset: AssetSchema,
  workTitle: z.string().min(1),
  recordingTitle: z.string().min(1),
  albumId: IdentifierSchema.optional(),
  albumTitle: z.string().optional(),
  trackNumber: z.number().int().positive().optional(),
  creator: z.string().optional(),
  albumArtist: z.string().optional(),
  coverUrl: z.string().min(1).optional(),
  releaseDate: z.string().optional(),
  label: z.string().optional(),
  hasLyrics: z.boolean().optional(),
  segments: z.array(CatalogSegmentSchema)
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const ConversionSettingsSchema = z.object({
  container: z.literal('ogg').default('ogg'),
  codec: z.enum(['libvorbis', 'libopus']).default('libvorbis'),
  quality: z.number().int().min(0).max(10).default(6)
});
export type ConversionSettings = z.infer<typeof ConversionSettingsSchema>;

export const TrackEditSchema = z.object({
  workTitle: z.string().trim().min(1).max(500),
  albumTitle: z.string().trim().max(500).nullable().optional(),
  recordingTitle: z.string().trim().min(1).max(500),
  trackNumber: z.number().int().positive().nullable().optional(),
  creator: z.string().trim().max(500).nullable().optional(),
  date: z.string().trim().max(500).nullable().optional(),
  releaseDate: z.string().trim().max(500).nullable().optional(),
  label: z.string().trim().max(500).nullable().optional(),
  catalogNumber: z.string().trim().max(500).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  notes: z.string().trim().max(20_000).nullable().optional()
});
export type TrackEdit = z.infer<typeof TrackEditSchema>;

export const AlbumEditSchema = z.object({
  title: z.string().trim().min(1).max(500),
  albumArtist: z.string().trim().max(500).nullable().optional(),
  // Backward-compatible input for the first album editor implementation.
  creator: z.string().trim().max(500).nullable().optional(),
  releaseDate: z.string().trim().max(500).nullable().optional(),
  label: z.string().trim().max(500).nullable().optional(),
  catalogNumber: z.string().trim().max(500).nullable().optional(),
  albumDurationMs: z.number().int().nonnegative().nullable().optional(),
  albumTags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  genres: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  styles: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  roles: z.array(AlbumRoleSchema).max(250).optional(),
  notes: z.string().trim().max(20_000).nullable().optional(),
  collectionCode: z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/).optional(),
  tracks: z.array(z.object({
    assetId: IdentifierSchema,
    recordingTitle: z.string().trim().min(1).max(500),
    trackNumber: z.number().int().positive().nullable().optional()
  })).max(2_000).refine(
    (tracks) => new Set(tracks.map((track) => track.assetId)).size === tracks.length,
    { message: 'Album track edits must use unique asset IDs' }
  ).optional()
});
export type AlbumEdit = z.infer<typeof AlbumEditSchema>;

export const SegmentCreateSchema = z.object({
  assetId: IdentifierSchema,
  startTimeMs: z.number().int().nonnegative(),
  endTimeMs: z.number().int().positive(),
  channelSelection: z.array(z.number().int().nonnegative()).default([]),
  fadeInMs: z.number().int().nonnegative().default(0),
  fadeOutMs: z.number().int().nonnegative().default(0),
  label: z.string().trim().max(500).optional(),
  sourceContext: SourceContextSchema.default('manual_selection')
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
