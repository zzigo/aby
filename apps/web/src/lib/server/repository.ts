import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { AlbumEdit, Asset, CatalogItem, ConversionSettings, IngestPreview, Provenance, Segment, SegmentCreate, TrackEdit } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { readConfig } from './config';

export interface SpectrogramSummary {
  descriptors: { energy: number; brightness: number; motion: number; gravity: number; tension: number };
  observationCount: number;
  width: number;
  height: number;
  generatedAt: string;
}

export interface SpectrogramAnalysis {
  id: string;
  assetId: string;
  sourceAssetChecksum: string;
  artifactObjectKey: string;
  tool: string;
  toolVersion: string;
  summary: SpectrogramSummary;
  reviewState: 'candidate' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface AbyRepository {
  savePreview(preview: IngestPreview): Promise<IngestPreview>;
  getPreview(ownerId: string, previewId: string): Promise<IngestPreview | null>;
  markPreviewPromoted(ownerId: string, previewId: string, sourceObjectKey: string, targetObjectKey: string, updatedCandidateMetadata?: any): Promise<IngestPreview>;
  commitPreview(
    ownerId: string,
    previewId: string,
    workTitle: string,
    recordingTitle: string,
    albumTitle?: string,
    creator?: string,
    date?: string,
    releaseDate?: string,
    label?: string,
    catalogNumber?: string,
    trackOverrides?: Array<{ objectKey: string; recordingTitle: string; trackNumber?: number }>
  ): Promise<Asset>;
  listCatalog(ownerId: string): Promise<CatalogItem[]>;
  getCatalogItem(ownerId: string, assetId: string): Promise<CatalogItem | null>;
  updateCatalogItem(ownerId: string, assetId: string, input: TrackEdit): Promise<CatalogItem>;
  updateAlbum(ownerId: string, albumId: string, input: AlbumEdit): Promise<CatalogItem[]>;
  mergeAlbumMetadata(ownerId: string, albumId: string, metadata: Record<string, unknown>): Promise<CatalogItem[]>;
  softDeleteAsset(ownerId: string, assetId: string): Promise<void>;
  getConversionSettings(ownerId: string): Promise<ConversionSettings>;
  saveConversionSettings(ownerId: string, settings: ConversionSettings): Promise<ConversionSettings>;
  mergeCanonicalMetadata(ownerId: string, assetId: string, metadata: Record<string, unknown>): Promise<CatalogItem>;
  getAsset(ownerId: string, assetId: string): Promise<Asset | null>;
  getSpectrogramAnalysis(ownerId: string, assetId: string): Promise<SpectrogramAnalysis | null>;
  saveSpectrogramAnalysis(ownerId: string, asset: Asset, input: Omit<SpectrogramAnalysis, 'id' | 'assetId' | 'sourceAssetChecksum' | 'createdAt'>): Promise<SpectrogramAnalysis>;
  createSegment(ownerId: string, input: SegmentCreate, provenance: Provenance): Promise<Segment>;
}

function accepted(provenance: Provenance, actorId: string): Provenance {
  return { ...provenance, method: 'human', actorId, reviewState: 'accepted', reviewedBy: actorId, reviewedAt: new Date().toISOString(), timestamp: new Date().toISOString() };
}

export class MemoryAbyRepository implements AbyRepository {
  readonly #previews = new Map<string, IngestPreview>();
  readonly #assets = new Map<string, Asset>();
  readonly #segments = new Map<string, Segment>();
  readonly #spectrograms = new Map<string, SpectrogramAnalysis>();
  readonly #settings = new Map<string, ConversionSettings>();

  async savePreview(preview: IngestPreview): Promise<IngestPreview> {
    this.#previews.set(preview.id, structuredClone(preview));
    return structuredClone(preview);
  }

  async getPreview(ownerId: string, previewId: string): Promise<IngestPreview | null> {
    const preview = this.#previews.get(previewId);
    return preview?.ownerId === ownerId ? structuredClone(preview) : null;
  }

  async markPreviewPromoted(ownerId: string, previewId: string, sourceObjectKey: string, targetObjectKey: string, updatedCandidateMetadata?: any): Promise<IngestPreview> {
    const preview = this.#previews.get(previewId);
    if (!preview || preview.ownerId !== ownerId) throw new AbyError('preview_not_found', 'Ingest preview not found', 404);
    if (preview.status !== 'candidate') throw new AbyError('preview_not_promotable', 'Only candidate previews can be promoted', 409);
    if (preview.objectKey !== sourceObjectKey && preview.objectKey !== targetObjectKey) {
      throw new AbyError('preview_source_changed', 'Preview source changed before promotion completed', 409);
    }
    const promoted: IngestPreview = {
      ...preview,
      objectKey: targetObjectKey,
      candidateMetadata: updatedCandidateMetadata || preview.candidateMetadata,
      provenance: {
        ...preview.provenance,
        parameters: {
          ...preview.provenance.parameters,
          sourceObjectKey,
          promotedObjectKey: targetObjectKey,
          promotedAt: new Date().toISOString(),
          verification: 'sha256'
        }
      }
    };
    this.#previews.set(previewId, structuredClone(promoted));
    return structuredClone(promoted);
  }

  async commitPreview(
    ownerId: string,
    previewId: string,
    workTitle: string,
    recordingTitle: string,
    albumTitle?: string,
    creator?: string,
    date?: string,
    releaseDate?: string,
    label?: string,
    catalogNumber?: string,
    trackOverrides?: Array<{ objectKey: string; recordingTitle: string; trackNumber?: number }>
  ): Promise<Asset> {
    const preview = this.#previews.get(previewId);
    if (!preview || preview.ownerId !== ownerId) throw new AbyError('preview_not_found', 'Ingest preview not found', 404);
    if (preview.status === 'rejected') throw new AbyError('preview_not_committable', 'Rejected previews cannot be committed', 409);
    if (preview.candidateMetadata.canonicalObjectKey && preview.candidateMetadata.canonicalObjectKey !== preview.objectKey) {
      throw new AbyError('promotion_required', 'The source must be copied, verified and promoted before canonical commit', 409);
    }
    const existing = [...this.#assets.values()].find((value) =>
      value.provenance.jobId === preview.id || (
        value.ownerId === ownerId &&
        value.provider === preview.provider &&
        value.bucket === preview.bucket &&
        value.objectKey === preview.objectKey
      )
    );
    if (existing) {
      if (existing.checksumSha256 !== preview.checksumSha256) {
        throw new AbyError('canonical_asset_conflict', 'Canonical object key is already registered with a different checksum', 409);
      }
      if (existing.canonicalMetadata.title !== workTitle || existing.canonicalMetadata.recordingTitle !== recordingTitle) {
        throw new AbyError('canonical_metadata_conflict', 'Canonical asset already exists with different work or recording metadata', 409);
      }
      this.#previews.set(preview.id, { ...preview, status: 'committed' });
      return structuredClone(existing);
    }
    const now = new Date().toISOString();
    const workId = randomUUID();
    const albumId = albumTitle || preview.candidateMetadata.albumTitle ? randomUUID() : undefined;
    const provenance = accepted({ ...preview.provenance, jobId: preview.id }, ownerId);
    
    const tracks = preview.candidateMetadata.tracks || [{
      objectKey: preview.objectKey,
      originalFilename: preview.originalFilename,
      checksumSha256: preview.checksumSha256,
      technicalMetadata: preview.technicalMetadata,
      recordingTitle: recordingTitle,
      trackNumber: preview.candidateMetadata.trackNumber
    }];

    const finalCreator = creator !== undefined ? creator : preview.candidateMetadata.creator;
    const finalDate = date !== undefined ? date : preview.candidateMetadata.date;
    const finalReleaseDate = releaseDate !== undefined ? releaseDate : preview.candidateMetadata.releaseDate;
    const finalLabel = label !== undefined ? label : preview.candidateMetadata.label;
    const finalCatalogNumber = catalogNumber !== undefined ? catalogNumber : preview.candidateMetadata.catalogNumber;
    const overrides = new Map(trackOverrides?.map((track) => [track.objectKey, track]) ?? []);

    let mainAsset: Asset | undefined;

    for (const track of tracks) {
      const override = overrides.get(track.objectKey);
      const finalTrackTitle = override?.recordingTitle ?? track.recordingTitle;
      const finalTrackNumber = override?.trackNumber ?? track.trackNumber;
      const duplicateChecksum = [...this.#assets.values()].find(
        (value) => value.ownerId === ownerId && value.checksumSha256 === track.checksumSha256
      );
      if (duplicateChecksum) {
        throw new AbyError('canonical_checksum_conflict', 'These bytes are already registered under another canonical object key; explicit reconciliation is required', 409);
      }

      const asset: Asset = {
        id: randomUUID(), ownerId, workId, recordingId: randomUUID(), ...(albumId ? { albumId } : {}), provider: preview.provider,
        ...(preview.bucket ? { bucket: preview.bucket } : {}), objectKey: track.objectKey,
        originalFilename: track.originalFilename, checksumSha256: track.checksumSha256,
        technicalMetadata: track.technicalMetadata,
        canonicalMetadata: { 
          ...preview.candidateMetadata, 
          title: workTitle, 
          recordingTitle: finalTrackTitle,
          ...(albumTitle || preview.candidateMetadata.albumTitle ? { albumTitle: albumTitle || preview.candidateMetadata.albumTitle } : {}),
          ...(finalTrackNumber !== undefined ? { trackNumber: finalTrackNumber } : {}),
          creator: finalCreator,
          date: finalDate,
          releaseDate: finalReleaseDate,
          label: finalLabel,
          catalogNumber: finalCatalogNumber,
          tracks: undefined 
        },
        provenance, createdAt: now
      };
      this.#assets.set(asset.id, asset);
      if (track.objectKey === preview.objectKey || track.objectKey === preview.candidateMetadata.canonicalObjectKey) {
        mainAsset = asset;
      }
    }
    
    this.#previews.set(preview.id, { ...preview, status: 'committed' });
    return structuredClone(mainAsset || [...this.#assets.values()][0]);
  }

  async getAsset(ownerId: string, assetId: string): Promise<Asset | null> {
    const asset = this.#assets.get(assetId);
    return asset?.ownerId === ownerId ? structuredClone(asset) : null;
  }

  async getSpectrogramAnalysis(ownerId: string, assetId: string): Promise<SpectrogramAnalysis | null> {
    const asset = await this.getAsset(ownerId, assetId);
    const analysis = this.#spectrograms.get(assetId);
    return asset && analysis?.sourceAssetChecksum === asset.checksumSha256 ? structuredClone(analysis) : null;
  }

  async saveSpectrogramAnalysis(ownerId: string, asset: Asset, input: Omit<SpectrogramAnalysis, 'id' | 'assetId' | 'sourceAssetChecksum' | 'createdAt'>): Promise<SpectrogramAnalysis> {
    if (asset.ownerId !== ownerId) throw new AbyError('asset_not_found', 'Asset not found', 404);
    const analysis: SpectrogramAnalysis = {
      id: randomUUID(), assetId: asset.id, sourceAssetChecksum: asset.checksumSha256,
      ...input, createdAt: new Date().toISOString()
    };
    this.#spectrograms.set(asset.id, analysis);
    return structuredClone(analysis);
  }

  async listCatalog(ownerId: string): Promise<CatalogItem[]> {
    return [...this.#assets.values()]
      .filter((asset) => asset.ownerId === ownerId)
      .map((asset) => ({
        asset: structuredClone(asset),
        workTitle: asset.canonicalMetadata.title,
        recordingTitle: asset.canonicalMetadata.recordingTitle,
        ...(asset.albumId ? { albumId: asset.albumId } : {}),
        ...(asset.canonicalMetadata.albumTitle ? { albumTitle: asset.canonicalMetadata.albumTitle } : {}),
        ...(asset.canonicalMetadata.trackNumber ? { trackNumber: asset.canonicalMetadata.trackNumber } : {}),
        ...(asset.canonicalMetadata.creator ? { creator: asset.canonicalMetadata.creator } : {}),
        ...(asset.canonicalMetadata.imageCandidates?.[0]?.url ? { coverUrl: asset.canonicalMetadata.imageCandidates[0].url } : {}),
        ...(asset.canonicalMetadata.releaseDate ? { releaseDate: asset.canonicalMetadata.releaseDate } : {}),
        ...(asset.canonicalMetadata.label ? { label: asset.canonicalMetadata.label } : {}),
        segments: [...this.#segments.values()]
          .filter((segment) => segment.ownerId === ownerId && segment.assetId === asset.id)
          .map((segment) => ({
            id: segment.id,
            startTimeMs: segment.startTimeMs,
            endTimeMs: segment.endTimeMs,
            ...(segment.label ? { label: segment.label } : {}),
            ...(segment.sourceContext ? { sourceContext: segment.sourceContext } : {})
          }))
      }));
  }

  async getCatalogItem(ownerId: string, assetId: string): Promise<CatalogItem | null> {
    return (await this.listCatalog(ownerId)).find((item) => item.asset.id === assetId) ?? null;
  }

  async updateCatalogItem(ownerId: string, assetId: string, input: TrackEdit): Promise<CatalogItem> {
    const asset = this.#assets.get(assetId);
    if (!asset || asset.ownerId !== ownerId) throw new AbyError('asset_not_found', 'Asset not found', 404);
    asset.canonicalMetadata = {
      ...asset.canonicalMetadata,
      title: input.workTitle,
      recordingTitle: input.recordingTitle,
      ...(input.albumTitle ? { albumTitle: input.albumTitle } : { albumTitle: undefined }),
      ...(input.trackNumber ? { trackNumber: input.trackNumber } : { trackNumber: undefined }),
      ...(input.creator ? { creator: input.creator } : { creator: undefined }),
      ...(input.date ? { date: input.date } : { date: undefined }),
      ...(input.releaseDate ? { releaseDate: input.releaseDate } : { releaseDate: undefined }),
      ...(input.label ? { label: input.label } : { label: undefined }),
      ...(input.catalogNumber ? { catalogNumber: input.catalogNumber } : { catalogNumber: undefined })
    };
    return (await this.getCatalogItem(ownerId, assetId))!;
  }

  async updateAlbum(ownerId: string, albumId: string, input: AlbumEdit): Promise<CatalogItem[]> {
    const assets = [...this.#assets.values()].filter((asset) => asset.ownerId === ownerId && asset.albumId === albumId);
    if (!assets.length) throw new AbyError('album_not_found', 'Album not found', 404);
    for (const asset of assets) {
      asset.canonicalMetadata = {
        ...asset.canonicalMetadata,
        albumTitle: input.title,
        ...(input.creator ? { creator: input.creator } : { creator: undefined }),
        ...(input.releaseDate ? { releaseDate: input.releaseDate } : { releaseDate: undefined }),
        ...(input.label ? { label: input.label } : { label: undefined }),
        ...(input.catalogNumber ? { catalogNumber: input.catalogNumber } : { catalogNumber: undefined })
      };
    }
    return (await this.listCatalog(ownerId)).filter((item) => item.albumId === albumId);
  }

  async mergeAlbumMetadata(ownerId: string, albumId: string, metadata: Record<string, unknown>): Promise<CatalogItem[]> {
    const assets = [...this.#assets.values()].filter((asset) => asset.ownerId === ownerId && asset.albumId === albumId);
    if (!assets.length) throw new AbyError('album_not_found', 'Album not found', 404);
    for (const asset of assets) asset.canonicalMetadata = { ...asset.canonicalMetadata, ...metadata };
    return (await this.listCatalog(ownerId)).filter((item) => item.albumId === albumId);
  }

  async softDeleteAsset(ownerId: string, assetId: string): Promise<void> {
    const asset = this.#assets.get(assetId);
    if (!asset || asset.ownerId !== ownerId) throw new AbyError('asset_not_found', 'Asset not found', 404);
    this.#assets.delete(assetId);
  }

  async getConversionSettings(ownerId: string): Promise<ConversionSettings> {
    return structuredClone(this.#settings.get(ownerId) ?? { container: 'ogg', codec: 'libvorbis', quality: 6 });
  }

  async saveConversionSettings(ownerId: string, settings: ConversionSettings): Promise<ConversionSettings> {
    this.#settings.set(ownerId, structuredClone(settings));
    return structuredClone(settings);
  }

  async mergeCanonicalMetadata(ownerId: string, assetId: string, metadata: Record<string, unknown>): Promise<CatalogItem> {
    const asset = this.#assets.get(assetId);
    if (!asset || asset.ownerId !== ownerId) throw new AbyError('asset_not_found', 'Asset not found', 404);
    asset.canonicalMetadata = { ...asset.canonicalMetadata, ...metadata };
    return (await this.getCatalogItem(ownerId, assetId))!;
  }

  async createSegment(ownerId: string, input: SegmentCreate, provenance: Provenance): Promise<Segment> {
    if (!await this.getAsset(ownerId, input.assetId)) throw new AbyError('asset_not_found', 'Asset not found', 404);
    const segment: Segment = { id: randomUUID(), ownerId, ...input, provenance, state: 'accepted', createdAt: new Date().toISOString() };
    this.#segments.set(segment.id, segment);
    return structuredClone(segment);
  }
}

function mapAsset(row: any): Asset {
  return {
    id: row.id, ownerId: row.owner_id, workId: row.work_id, recordingId: row.recording_id,
    ...(row.album_id ? { albumId: row.album_id } : {}),
    provider: row.provider, ...(row.bucket ? { bucket: row.bucket } : {}), objectKey: row.object_key,
    originalFilename: row.original_filename, checksumSha256: row.checksum_sha256,
    technicalMetadata: row.technical_metadata, canonicalMetadata: row.canonical_metadata,
    provenance: row.provenance, createdAt: new Date(row.created_at).toISOString()
  };
}

function mapPreview(row: any): IngestPreview {
  return {
    id: row.id,
    ownerId: row.owner_id,
    provider: row.provider,
    ...(row.bucket ? { bucket: row.bucket } : {}),
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    originalDirectory: row.original_directory,
    checksumSha256: row.checksum_sha256,
    technicalMetadata: row.technical_metadata,
    candidateMetadata: row.candidate_metadata,
    provenance: row.provenance,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString()
  };
}

export class PostgresAbyRepository implements AbyRepository {
  readonly #pool: pg.Pool;
  constructor(databaseUrl: string) { this.#pool = new pg.Pool({ connectionString: databaseUrl, max: 10 }); }

  async savePreview(preview: IngestPreview): Promise<IngestPreview> {
    await this.#pool.query(
      `INSERT INTO aby.ingest_candidates
       (id,owner_id,provider,bucket,object_key,original_filename,original_directory,checksum_sha256,technical_metadata,candidate_metadata,provenance,status,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [preview.id, preview.ownerId, preview.provider, preview.bucket ?? null, preview.objectKey, preview.originalFilename,
        preview.originalDirectory, preview.checksumSha256, preview.technicalMetadata, preview.candidateMetadata,
        preview.provenance, preview.status, preview.createdAt]
    );
    return preview;
  }

  async getPreview(ownerId: string, previewId: string): Promise<IngestPreview | null> {
    const result = await this.#pool.query(
      'SELECT * FROM aby.ingest_candidates WHERE id=$1 AND owner_id=$2',
      [previewId, ownerId]
    );
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async markPreviewPromoted(ownerId: string, previewId: string, sourceObjectKey: string, targetObjectKey: string, updatedCandidateMetadata?: any): Promise<IngestPreview> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'SELECT * FROM aby.ingest_candidates WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [previewId, ownerId]
      );
      const row = result.rows[0];
      if (!row) throw new AbyError('preview_not_found', 'Ingest preview not found', 404);
      if (row.status !== 'candidate') throw new AbyError('preview_not_promotable', 'Only candidate previews can be promoted', 409);
      if (row.object_key !== sourceObjectKey && row.object_key !== targetObjectKey) {
        throw new AbyError('preview_source_changed', 'Preview source changed before promotion completed', 409);
      }
      const provenance = {
        ...row.provenance,
        parameters: {
          ...row.provenance.parameters,
          sourceObjectKey,
          promotedObjectKey: targetObjectKey,
          promotedAt: new Date().toISOString(),
          verification: 'sha256'
        }
      };
      const updated = await client.query(
        'UPDATE aby.ingest_candidates SET object_key=$1,provenance=$2,candidate_metadata=COALESCE($3, candidate_metadata),updated_at=now() WHERE id=$4 RETURNING *',
        [targetObjectKey, provenance, updatedCandidateMetadata ?? null, previewId]
      );
      const retirementTracks = row.candidate_metadata.tracks?.length
        ? row.candidate_metadata.tracks
        : [{ objectKey: sourceObjectKey, canonicalObjectKey: targetObjectKey, checksumSha256: row.checksum_sha256 }];
      for (const track of retirementTracks) {
        const retirementProvenance: Provenance = {
          method: 'human', source: `promotion:${previewId}`, actorId: ownerId,
          parameters: {
            sourceObjectKey: track.objectKey,
            canonicalObjectKey: track.canonicalObjectKey,
            reason: 'canonical-copy-verified'
          },
          timestamp: new Date().toISOString(), sourceAssetChecksum: track.checksumSha256,
          reviewState: 'candidate'
        };
        await client.query(
          `INSERT INTO aby.source_retirement_candidates
           (id,owner_id,preview_id,provider,bucket,source_object_key,canonical_object_key,checksum_sha256,state,provenance)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,'candidate',$9)
           ON CONFLICT(provider,bucket,source_object_key) DO UPDATE SET
             owner_id=excluded.owner_id,preview_id=excluded.preview_id,
             canonical_object_key=excluded.canonical_object_key,checksum_sha256=excluded.checksum_sha256,
             state=CASE WHEN aby.source_retirement_candidates.state='retired' THEN 'retired' ELSE 'candidate' END,
             provenance=excluded.provenance,updated_at=now()`,
          [randomUUID(), ownerId, previewId, row.provider, row.bucket, track.objectKey, track.canonicalObjectKey, track.checksumSha256, retirementProvenance]
        );
      }
      await client.query('COMMIT');
      return mapPreview(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async commitPreview(
    ownerId: string,
    previewId: string,
    workTitle: string,
    recordingTitle: string,
    albumTitle?: string,
    creator?: string,
    date?: string,
    releaseDate?: string,
    label?: string,
    catalogNumber?: string,
    trackOverrides?: Array<{ objectKey: string; recordingTitle: string; trackNumber?: number }>
  ): Promise<Asset> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM aby.ingest_candidates WHERE id=$1 AND owner_id=$2 FOR UPDATE', [previewId, ownerId]);
      const preview = result.rows[0];
      if (!preview) throw new AbyError('preview_not_found', 'Ingest preview not found', 404);
      if (preview.status === 'committed') {
        if (!preview.committed_asset_id) {
          throw new AbyError('committed_asset_missing', 'Committed preview no longer points to an asset', 409);
        }
        const existing = await client.query(
          `SELECT a.*, r.work_id, r.album_id FROM aby.assets a JOIN aby.recordings r ON r.id=a.recording_id
           WHERE a.id=$1 AND a.owner_id=$2`, [preview.committed_asset_id, ownerId]
        );
        if (!existing.rows[0]) throw new AbyError('committed_asset_missing', 'Committed preview asset no longer exists', 409);
        await client.query('COMMIT');
        return mapAsset(existing.rows[0]);
      }
      if (preview.status !== 'candidate') throw new AbyError('preview_not_committable', 'Only candidate previews can be committed', 409);
      if (preview.candidate_metadata.canonicalObjectKey && preview.candidate_metadata.canonicalObjectKey !== preview.object_key) {
        throw new AbyError('promotion_required', 'The source must be copied, verified and promoted before canonical commit', 409);
      }

      const now = new Date().toISOString();
      const workId = randomUUID();
      const finalAlbumTitle = albumTitle !== undefined ? albumTitle.trim() || undefined : preview.candidate_metadata.albumTitle;
      const albumId = finalAlbumTitle ? randomUUID() : undefined;
      const provenance = accepted({ ...preview.provenance, jobId: preview.id }, ownerId);
      
      const tracks = preview.candidate_metadata.tracks || [{
        objectKey: preview.object_key,
        originalFilename: preview.original_filename,
        checksumSha256: preview.checksum_sha256,
        technicalMetadata: preview.technical_metadata,
        recordingTitle: recordingTitle,
        trackNumber: preview.candidate_metadata.trackNumber
      }];

      const finalCreator = creator !== undefined ? creator : preview.candidate_metadata.creator;
      const finalDate = date !== undefined ? date : preview.candidate_metadata.date;
      const finalReleaseDate = releaseDate !== undefined ? releaseDate : preview.candidate_metadata.releaseDate;
      const finalLabel = label !== undefined ? label : preview.candidate_metadata.label;
      const finalCatalogNumber = catalogNumber !== undefined ? catalogNumber : preview.candidate_metadata.catalogNumber;
      const overrides = new Map(trackOverrides?.map((track) => [track.objectKey, track]) ?? []);

      // Lock all locations and checksums
      const lockKeys = [];
      for (const track of tracks) {
        lockKeys.push(JSON.stringify(['asset-location', ownerId, preview.provider, preview.bucket ?? null, track.objectKey]));
        lockKeys.push(JSON.stringify(['asset-checksum', ownerId, track.checksumSha256]));
      }
      lockKeys.sort();
      for (const lockKey of lockKeys) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lockKey]);
      }

      // 1. Insert unified Work with composition date in metadata
      const workMetadata = { date: finalDate };
      await client.query('INSERT INTO aby.works(id,owner_id,title,metadata,provenance) VALUES($1,$2,$3,$4,$5)', [workId, ownerId, workTitle, workMetadata, provenance]);
      if (albumId && finalAlbumTitle) {
        await client.query(
          'INSERT INTO aby.albums(id,owner_id,work_id,title,metadata,provenance) VALUES($1,$2,$3,$4,$5,$6)',
          [albumId, ownerId, workId, finalAlbumTitle, {
            releaseDate: finalReleaseDate,
            label: finalLabel,
            catalogNumber: finalCatalogNumber,
            imageCandidates: preview.candidate_metadata.imageCandidates
          }, provenance]
        );
      }

      let mainAssetId = '';
      let firstAssetId = '';
      let mainAsset: Asset | undefined;

      // 2. Insert all tracks
      for (const track of tracks) {
        const override = overrides.get(track.objectKey);
        const finalTrackTitle = override?.recordingTitle ?? track.recordingTitle;
        const finalTrackNumber = override?.trackNumber ?? track.trackNumber;
        const recordingId = randomUUID();
        const assetId = randomUUID();

        const duplicate = await client.query(
          `SELECT a.*,r.work_id,r.album_id,r.title AS existing_recording_title,w.title AS existing_work_title FROM aby.assets a
           JOIN aby.recordings r ON r.id=a.recording_id
           JOIN aby.works w ON w.id=r.work_id
           WHERE a.owner_id=$1 AND a.provider=$2 AND a.bucket IS NOT DISTINCT FROM $3 AND a.object_key=$4
           FOR UPDATE`,
          [ownerId, preview.provider, preview.bucket, track.objectKey]
        );
        if (duplicate.rows[0]) {
          const existing = duplicate.rows[0];
          if (existing.state !== 'active') {
            throw new AbyError('canonical_asset_inactive', 'Canonical object is already registered but is not active', 409);
          }
          if (existing.checksum_sha256 !== track.checksumSha256) {
            throw new AbyError('canonical_asset_conflict', 'Canonical object key is already registered with a different checksum', 409);
          }
          if (track.objectKey === preview.object_key || track.objectKey === preview.candidate_metadata.canonicalObjectKey) {
            mainAssetId = existing.id;
          }
          continue;
        }

        const checksumDuplicate = await client.query(
          `SELECT id FROM aby.assets WHERE owner_id=$1 AND checksum_sha256=$2 FOR UPDATE`,
          [ownerId, track.checksumSha256]
        );
        if (checksumDuplicate.rows[0]) {
          throw new AbyError(
            'canonical_checksum_conflict',
            'These bytes are already registered under another canonical object key; explicit reconciliation is required',
            409
          );
        }

        const canonicalMetadata = { 
          ...preview.candidate_metadata, 
          title: workTitle, 
          recordingTitle: finalTrackTitle,
          albumTitle: finalAlbumTitle,
          trackNumber: finalTrackNumber,
          creator: finalCreator,
          date: finalDate,
          releaseDate: finalReleaseDate,
          label: finalLabel,
          catalogNumber: finalCatalogNumber,
          tracks: undefined 
        };
        const recordingMetadata = {
          recordingFolder: preview.candidate_metadata.recordingFolder,
          releaseDate: finalReleaseDate,
          label: finalLabel,
          catalogNumber: finalCatalogNumber,
          trackNumber: finalTrackNumber,
          identificationCandidates: preview.candidate_metadata.identificationCandidates
        };

        await client.query(
          'INSERT INTO aby.recordings(id,owner_id,work_id,album_id,title,metadata,provenance) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [recordingId, ownerId, workId, albumId ?? null, finalTrackTitle, recordingMetadata, provenance]
        );

        const originalObjectKey = track.sourceObjectKey ?? (typeof preview.provenance.parameters?.sourceObjectKey === 'string'
          ? (preview.provenance.parameters.sourceObjectKey === preview.object_key
              ? track.objectKey
              : preview.provenance.parameters.sourceObjectKey)
          : track.objectKey);

        await client.query(
          `INSERT INTO aby.assets
           (id,owner_id,recording_id,provider,bucket,object_key,original_filename,original_object_key,original_directory,checksum_sha256,imported_at,technical_metadata,canonical_metadata,provenance)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [assetId, ownerId, recordingId, preview.provider, preview.bucket, track.objectKey, track.originalFilename,
            originalObjectKey, preview.original_directory, track.checksumSha256, now, track.technicalMetadata, canonicalMetadata, provenance]
        );

        const createdAsset = {
          id: assetId, ownerId, workId, recordingId, ...(albumId ? { albumId } : {}), provider: preview.provider,
          ...(preview.bucket ? { bucket: preview.bucket } : {}), objectKey: track.objectKey,
          originalFilename: track.originalFilename, checksumSha256: track.checksumSha256,
          technicalMetadata: track.technicalMetadata, canonicalMetadata, provenance, createdAt: now
        };
        if (!firstAssetId) firstAssetId = assetId;

        if (track.objectKey === preview.object_key || track.objectKey === preview.candidate_metadata.canonicalObjectKey) {
          mainAsset = createdAsset;
          mainAssetId = assetId;
        }
      }

      const finalAssetId = mainAssetId || firstAssetId;
      await client.query("UPDATE aby.ingest_candidates SET status='committed',committed_asset_id=$1,updated_at=now() WHERE id=$2", [finalAssetId, previewId]);
      await client.query('COMMIT');

      if (mainAsset) return mainAsset;
      const finalAsset = await client.query(`SELECT a.*, r.work_id, r.album_id FROM aby.assets a JOIN aby.recordings r ON r.id=a.recording_id WHERE a.id=$1`, [finalAssetId]);
      return mapAsset(finalAsset.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAsset(ownerId: string, assetId: string): Promise<Asset | null> {
    const result = await this.#pool.query(
      `SELECT a.*, r.work_id, r.album_id FROM aby.assets a JOIN aby.recordings r ON r.id=a.recording_id
       WHERE a.id=$1 AND a.owner_id=$2`, [assetId, ownerId]
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }

  async getSpectrogramAnalysis(ownerId: string, assetId: string): Promise<SpectrogramAnalysis | null> {
    const result = await this.#pool.query(
      `SELECT an.* FROM aby.analysis an
       JOIN aby.assets a ON a.id=an.asset_id AND a.owner_id=an.owner_id
       WHERE an.owner_id=$1 AND an.asset_id=$2 AND an.tool='ffmpeg-showspectrumpic'
         AND an.source_asset_checksum=a.checksum_sha256 AND an.review_state<>'rejected'
       ORDER BY an.created_at DESC LIMIT 1`,
      [ownerId, assetId]
    );
    const row = result.rows[0];
    return row?.artifact_object_key ? {
      id: row.id,
      assetId: row.asset_id,
      sourceAssetChecksum: row.source_asset_checksum,
      artifactObjectKey: row.artifact_object_key,
      tool: row.tool,
      toolVersion: row.tool_version,
      summary: row.summary,
      reviewState: row.review_state,
      createdAt: new Date(row.created_at).toISOString()
    } : null;
  }

  async saveSpectrogramAnalysis(ownerId: string, asset: Asset, input: Omit<SpectrogramAnalysis, 'id' | 'assetId' | 'sourceAssetChecksum' | 'createdAt'>): Promise<SpectrogramAnalysis> {
    if (asset.ownerId !== ownerId) throw new AbyError('asset_not_found', 'Asset not found', 404);
    const client = await this.#pool.connect();
    const jobId = randomUUID();
    const idempotencyKey = `spectrogram:v1:${ownerId}:${asset.id}:${asset.checksumSha256}`;
    try {
      await client.query('BEGIN');
      const job = await client.query(
        `INSERT INTO aby.jobs
         (id,owner_id,type,idempotency_key,state,analysis_requested,payload,result,attempts,started_at,finished_at)
         VALUES($1,$2,'asset.analyze',$3,'succeeded',true,$4,$5,1,now(),now())
         ON CONFLICT(idempotency_key) DO UPDATE SET
           state='succeeded',result=excluded.result,attempts=aby.jobs.attempts+1,finished_at=now(),updated_at=now()
         RETURNING id`,
        [jobId, ownerId, idempotencyKey, { assetId: asset.id, checksum: asset.checksumSha256, analysis: 'spectrogram-v1' }, { artifactObjectKey: input.artifactObjectKey }]
      );
      const existing = await client.query(
        'SELECT id FROM aby.analysis WHERE owner_id=$1 AND asset_id=$2 AND job_id=$3 LIMIT 1',
        [ownerId, asset.id, job.rows[0].id]
      );
      const analysisId = existing.rows[0]?.id ?? randomUUID();
      const saved = await client.query(
        `INSERT INTO aby.analysis
         (id,owner_id,asset_id,job_id,tool,tool_version,parameters,source_asset_checksum,summary,artifact_object_key,confidence,review_state)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11)
         ON CONFLICT(id) DO UPDATE SET
           tool=excluded.tool,tool_version=excluded.tool_version,parameters=excluded.parameters,
           source_asset_checksum=excluded.source_asset_checksum,summary=excluded.summary,
           artifact_object_key=excluded.artifact_object_key,confidence=excluded.confidence,
           review_state=excluded.review_state
         RETURNING *`,
        [analysisId, ownerId, asset.id, job.rows[0].id, input.tool, input.toolVersion,
          { width: input.summary.width, height: input.summary.height, descriptorVersion: 1 },
          asset.checksumSha256, input.summary, input.artifactObjectKey, input.reviewState]
      );
      const row = saved.rows[0];
      if (!row) throw new AbyError('spectrogram_not_saved', 'Spectrogram analysis could not be saved', 500);
      await client.query('COMMIT');
      return {
        id: row.id, assetId: row.asset_id, sourceAssetChecksum: row.source_asset_checksum,
        artifactObjectKey: row.artifact_object_key, tool: row.tool, toolVersion: row.tool_version,
        summary: row.summary, reviewState: row.review_state, createdAt: new Date(row.created_at).toISOString()
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listCatalog(ownerId: string): Promise<CatalogItem[]> {
    const result = await this.#pool.query(
      `SELECT a.*,r.title AS recording_title,r.work_id,r.album_id,r.metadata AS recording_metadata,
        w.title AS work_title,al.title AS album_title,
        COALESCE(jsonb_agg(jsonb_build_object(
          'id',s.id,
          'startTimeMs',s.start_time_ms,
          'endTimeMs',s.end_time_ms,
          'label',s.label,
          'sourceContext',s.source_context
        ) ORDER BY s.start_time_ms) FILTER (WHERE s.id IS NOT NULL),'[]'::jsonb) AS segments
       FROM aby.assets a
       JOIN aby.recordings r ON r.id=a.recording_id
       JOIN aby.works w ON w.id=r.work_id
       LEFT JOIN aby.albums al ON al.id=r.album_id
       LEFT JOIN aby.segments s ON s.asset_id=a.id AND s.owner_id=a.owner_id
       WHERE a.owner_id=$1 AND a.state='active'
       GROUP BY a.id,r.title,r.work_id,r.album_id,r.metadata,w.title,al.title
       ORDER BY lower(w.title),lower(COALESCE(al.title,'')),COALESCE((r.metadata->>'trackNumber')::int,2147483647),a.created_at`,
      [ownerId]
    );
    return result.rows.map((row) => {
      const asset = mapAsset(row);
      const imageCandidate = asset.canonicalMetadata.imageCandidates?.[0];
      return {
        asset,
        workTitle: row.work_title,
        recordingTitle: row.recording_title,
        ...(row.album_id ? { albumId: row.album_id } : {}),
        ...(row.album_title ? { albumTitle: row.album_title } : {}),
        ...(row.recording_metadata?.trackNumber ? { trackNumber: Number(row.recording_metadata.trackNumber) } : {}),
        ...(asset.canonicalMetadata.creator ? { creator: asset.canonicalMetadata.creator } : {}),
        ...(imageCandidate?.url ? { coverUrl: imageCandidate.url } : {}),
        ...(asset.canonicalMetadata.releaseDate ? { releaseDate: asset.canonicalMetadata.releaseDate } : {}),
        ...(asset.canonicalMetadata.label ? { label: asset.canonicalMetadata.label } : {}),
        segments: row.segments.map((segment: { id: string; startTimeMs: number | string; endTimeMs: number | string; label?: string | null; sourceContext?: string }) => ({
          id: segment.id,
          startTimeMs: Number(segment.startTimeMs),
          endTimeMs: Number(segment.endTimeMs),
          ...(segment.label ? { label: segment.label } : {}),
          ...(segment.sourceContext ? { sourceContext: segment.sourceContext } : {})
        }))
      };
    });
  }

  async getCatalogItem(ownerId: string, assetId: string): Promise<CatalogItem | null> {
    return (await this.listCatalog(ownerId)).find((item) => item.asset.id === assetId) ?? null;
  }

  async updateCatalogItem(ownerId: string, assetId: string, input: TrackEdit): Promise<CatalogItem> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT a.canonical_metadata,r.id AS recording_id,r.work_id,r.album_id,r.metadata AS recording_metadata,
                w.provenance AS work_provenance,r.provenance AS recording_provenance
         FROM aby.assets a JOIN aby.recordings r ON r.id=a.recording_id JOIN aby.works w ON w.id=r.work_id
         WHERE a.id=$1 AND a.owner_id=$2 FOR UPDATE`,
        [assetId, ownerId]
      );
      const row = found.rows[0];
      if (!row) throw new AbyError('asset_not_found', 'Asset not found', 404);

      await client.query('UPDATE aby.works SET title=$1,updated_at=now() WHERE id=$2 AND owner_id=$3', [input.workTitle, row.work_id, ownerId]);

      let albumId: string | null = row.album_id;
      const albumTitle = input.albumTitle?.trim() || null;
      if (!albumTitle) {
        albumId = null;
      } else if (albumId) {
        await client.query('UPDATE aby.albums SET title=$1,updated_at=now() WHERE id=$2 AND owner_id=$3', [albumTitle, albumId, ownerId]);
      } else {
        albumId = randomUUID();
        await client.query(
          'INSERT INTO aby.albums(id,owner_id,work_id,title,metadata,provenance) VALUES($1,$2,$3,$4,$5,$6)',
          [albumId, ownerId, row.work_id, albumTitle, {}, accepted(row.recording_provenance, ownerId)]
        );
      }

      const recordingMetadata = {
        ...row.recording_metadata,
        trackNumber: input.trackNumber ?? undefined,
        releaseDate: input.releaseDate ?? undefined,
        label: input.label ?? undefined,
        catalogNumber: input.catalogNumber ?? undefined
      };
      const canonicalMetadata = {
        ...row.canonical_metadata,
        title: input.workTitle,
        recordingTitle: input.recordingTitle,
        albumTitle: albumTitle ?? undefined,
        trackNumber: input.trackNumber ?? undefined,
        creator: input.creator ?? undefined,
        date: input.date ?? undefined,
        releaseDate: input.releaseDate ?? undefined,
        label: input.label ?? undefined,
        catalogNumber: input.catalogNumber ?? undefined
      };
      await client.query(
        'UPDATE aby.recordings SET album_id=$1,title=$2,metadata=$3,updated_at=now() WHERE id=$4 AND owner_id=$5',
        [albumId, input.recordingTitle, recordingMetadata, row.recording_id, ownerId]
      );
      await client.query('UPDATE aby.assets SET canonical_metadata=$1,updated_at=now() WHERE id=$2 AND owner_id=$3', [canonicalMetadata, assetId, ownerId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return (await this.getCatalogItem(ownerId, assetId))!;
  }

  async updateAlbum(ownerId: string, albumId: string, input: AlbumEdit): Promise<CatalogItem[]> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const album = await client.query(
        'SELECT id FROM aby.albums WHERE id=$1 AND owner_id=$2 FOR UPDATE', [albumId, ownerId]
      );
      if (!album.rows[0]) throw new AbyError('album_not_found', 'Album not found', 404);
      const albumMetadata = {
        creator: input.creator ?? null,
        releaseDate: input.releaseDate ?? null,
        label: input.label ?? null,
        catalogNumber: input.catalogNumber ?? null
      };
      const canonicalMetadata = { albumTitle: input.title, ...albumMetadata };
      await client.query(
        'UPDATE aby.albums SET title=$1,metadata=jsonb_strip_nulls(metadata || $2::jsonb),updated_at=now() WHERE id=$3 AND owner_id=$4',
        [input.title, albumMetadata, albumId, ownerId]
      );
      await client.query(
        `UPDATE aby.recordings SET metadata=jsonb_strip_nulls(metadata || $1::jsonb),updated_at=now()
         WHERE album_id=$2 AND owner_id=$3`,
        [albumMetadata, albumId, ownerId]
      );
      await client.query(
        `UPDATE aby.assets a SET canonical_metadata=jsonb_strip_nulls(a.canonical_metadata || $1::jsonb),updated_at=now()
         FROM aby.recordings r WHERE a.recording_id=r.id AND r.album_id=$2 AND a.owner_id=$3`,
        [canonicalMetadata, albumId, ownerId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return (await this.listCatalog(ownerId)).filter((item) => item.albumId === albumId);
  }

  async mergeAlbumMetadata(ownerId: string, albumId: string, metadata: Record<string, unknown>): Promise<CatalogItem[]> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const album = await client.query(
        `UPDATE aby.albums SET metadata=metadata || $1::jsonb,updated_at=now()
         WHERE id=$2 AND owner_id=$3 RETURNING id`,
        [metadata, albumId, ownerId]
      );
      if (!album.rows[0]) throw new AbyError('album_not_found', 'Album not found', 404);
      await client.query(
        `UPDATE aby.assets a SET canonical_metadata=a.canonical_metadata || $1::jsonb,updated_at=now()
         FROM aby.recordings r WHERE a.recording_id=r.id AND r.album_id=$2 AND a.owner_id=$3`,
        [metadata, albumId, ownerId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return (await this.listCatalog(ownerId)).filter((item) => item.albumId === albumId);
  }

  async softDeleteAsset(ownerId: string, assetId: string): Promise<void> {
    const result = await this.#pool.query(
      "UPDATE aby.assets SET state='deleted',updated_at=now() WHERE id=$1 AND owner_id=$2 AND state='active' RETURNING id",
      [assetId, ownerId]
    );
    if (!result.rows[0]) throw new AbyError('asset_not_found', 'Asset not found', 404);
  }

  async getConversionSettings(ownerId: string): Promise<ConversionSettings> {
    const result = await this.#pool.query('SELECT conversion FROM aby.user_settings WHERE owner_id=$1', [ownerId]);
    return result.rows[0]?.conversion ?? { container: 'ogg', codec: 'libvorbis', quality: 6 };
  }

  async saveConversionSettings(ownerId: string, settings: ConversionSettings): Promise<ConversionSettings> {
    const result = await this.#pool.query(
      `INSERT INTO aby.user_settings(owner_id,conversion) VALUES($1,$2)
       ON CONFLICT(owner_id) DO UPDATE SET conversion=excluded.conversion,updated_at=now()
       RETURNING conversion`,
      [ownerId, settings]
    );
    return result.rows[0].conversion;
  }

  async mergeCanonicalMetadata(ownerId: string, assetId: string, metadata: Record<string, unknown>): Promise<CatalogItem> {
    const result = await this.#pool.query(
      `UPDATE aby.assets SET canonical_metadata=canonical_metadata || $1::jsonb,updated_at=now()
       WHERE id=$2 AND owner_id=$3 AND state='active' RETURNING id`,
      [metadata, assetId, ownerId]
    );
    if (!result.rows[0]) throw new AbyError('asset_not_found', 'Asset not found', 404);
    return (await this.getCatalogItem(ownerId, assetId))!;
  }

  async createSegment(ownerId: string, input: SegmentCreate, provenance: Provenance): Promise<Segment> {
    if (!await this.getAsset(ownerId, input.assetId)) throw new AbyError('asset_not_found', 'Asset not found', 404);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.#pool.query(
      `INSERT INTO aby.segments
       (id,owner_id,asset_id,start_time_ms,end_time_ms,channel_selection,fade_in_ms,fade_out_ms,label,state,provenance,created_at,source_context)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'accepted',$10,$11,$12)`,
      [id, ownerId, input.assetId, input.startTimeMs, input.endTimeMs, input.channelSelection, input.fadeInMs, input.fadeOutMs, input.label ?? null, provenance, createdAt, input.sourceContext]
    );
    return { id, ownerId, ...input, provenance, state: 'accepted', createdAt };
  }
}

let repository: AbyRepository | undefined;

export function getRepository(): AbyRepository {
  if (repository) return repository;
  const config = readConfig();
  if (config.DATABASE_URL) repository = new PostgresAbyRepository(config.DATABASE_URL);
  else if (config.demoMode) repository = new MemoryAbyRepository();
  else throw new AbyError('database_not_configured', 'DATABASE_URL is required outside local demo mode', 503);
  return repository;
}
