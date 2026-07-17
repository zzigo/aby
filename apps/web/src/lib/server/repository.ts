import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Asset, CatalogItem, IngestPreview, Provenance, Segment, SegmentCreate } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { readConfig } from './config';

export interface AbyRepository {
  savePreview(preview: IngestPreview): Promise<IngestPreview>;
  getPreview(ownerId: string, previewId: string): Promise<IngestPreview | null>;
  markPreviewPromoted(ownerId: string, previewId: string, sourceObjectKey: string, targetObjectKey: string): Promise<IngestPreview>;
  commitPreview(ownerId: string, previewId: string, workTitle: string, recordingTitle: string): Promise<Asset>;
  listCatalog(ownerId: string): Promise<CatalogItem[]>;
  getAsset(ownerId: string, assetId: string): Promise<Asset | null>;
  createSegment(ownerId: string, input: SegmentCreate, provenance: Provenance): Promise<Segment>;
}

function accepted(provenance: Provenance, actorId: string): Provenance {
  return { ...provenance, method: 'human', actorId, reviewState: 'accepted', reviewedBy: actorId, reviewedAt: new Date().toISOString(), timestamp: new Date().toISOString() };
}

export class MemoryAbyRepository implements AbyRepository {
  readonly #previews = new Map<string, IngestPreview>();
  readonly #assets = new Map<string, Asset>();
  readonly #segments = new Map<string, Segment>();

  async savePreview(preview: IngestPreview): Promise<IngestPreview> {
    this.#previews.set(preview.id, structuredClone(preview));
    return structuredClone(preview);
  }

  async getPreview(ownerId: string, previewId: string): Promise<IngestPreview | null> {
    const preview = this.#previews.get(previewId);
    return preview?.ownerId === ownerId ? structuredClone(preview) : null;
  }

  async markPreviewPromoted(ownerId: string, previewId: string, sourceObjectKey: string, targetObjectKey: string): Promise<IngestPreview> {
    const preview = this.#previews.get(previewId);
    if (!preview || preview.ownerId !== ownerId) throw new AbyError('preview_not_found', 'Ingest preview not found', 404);
    if (preview.status !== 'candidate') throw new AbyError('preview_not_promotable', 'Only candidate previews can be promoted', 409);
    if (preview.objectKey !== sourceObjectKey && preview.objectKey !== targetObjectKey) {
      throw new AbyError('preview_source_changed', 'Preview source changed before promotion completed', 409);
    }
    const promoted: IngestPreview = {
      ...preview,
      objectKey: targetObjectKey,
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

  async commitPreview(ownerId: string, previewId: string, workTitle: string, recordingTitle: string): Promise<Asset> {
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
    const asset: Asset = {
      id: randomUUID(), ownerId, workId: randomUUID(), recordingId: randomUUID(), provider: preview.provider,
      ...(preview.bucket ? { bucket: preview.bucket } : {}), objectKey: preview.objectKey,
      originalFilename: preview.originalFilename, checksumSha256: preview.checksumSha256,
      technicalMetadata: preview.technicalMetadata,
      canonicalMetadata: { ...preview.candidateMetadata, title: workTitle, recordingTitle },
      provenance: accepted({ ...preview.provenance, jobId: preview.id }, ownerId), createdAt: now
    };
    this.#assets.set(asset.id, asset);
    this.#previews.set(preview.id, { ...preview, status: 'committed' });
    return structuredClone(asset);
  }

  async getAsset(ownerId: string, assetId: string): Promise<Asset | null> {
    const asset = this.#assets.get(assetId);
    return asset?.ownerId === ownerId ? structuredClone(asset) : null;
  }

  async listCatalog(ownerId: string): Promise<CatalogItem[]> {
    return [...this.#assets.values()]
      .filter((asset) => asset.ownerId === ownerId)
      .map((asset) => ({
        asset: structuredClone(asset),
        workTitle: asset.canonicalMetadata.title,
        recordingTitle: asset.canonicalMetadata.recordingTitle,
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
            ...(segment.label ? { label: segment.label } : {})
          }))
      }));
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

  async markPreviewPromoted(ownerId: string, previewId: string, sourceObjectKey: string, targetObjectKey: string): Promise<IngestPreview> {
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
        'UPDATE aby.ingest_candidates SET object_key=$1,provenance=$2,updated_at=now() WHERE id=$3 RETURNING *',
        [targetObjectKey, provenance, previewId]
      );
      const retirementProvenance: Provenance = {
        method: 'human',
        source: `promotion:${previewId}`,
        actorId: ownerId,
        parameters: {
          sourceObjectKey,
          canonicalObjectKey: targetObjectKey,
          reason: 'canonical-copy-verified'
        },
        timestamp: new Date().toISOString(),
        sourceAssetChecksum: row.checksum_sha256,
        reviewState: 'candidate'
      };
      await client.query(
        `INSERT INTO aby.source_retirement_candidates
         (id,owner_id,preview_id,provider,bucket,source_object_key,canonical_object_key,checksum_sha256,state,provenance)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'candidate',$9)
         ON CONFLICT(provider,bucket,source_object_key) DO UPDATE SET
           owner_id=excluded.owner_id,
           preview_id=excluded.preview_id,
           canonical_object_key=excluded.canonical_object_key,
           checksum_sha256=excluded.checksum_sha256,
           state=CASE WHEN aby.source_retirement_candidates.state='retired' THEN 'retired' ELSE 'candidate' END,
           provenance=excluded.provenance,
           updated_at=now()`,
        [randomUUID(), ownerId, previewId, row.provider, row.bucket, sourceObjectKey, targetObjectKey, row.checksum_sha256, retirementProvenance]
      );
      await client.query('COMMIT');
      return mapPreview(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async commitPreview(ownerId: string, previewId: string, workTitle: string, recordingTitle: string): Promise<Asset> {
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
          `SELECT a.*, r.work_id FROM aby.assets a JOIN aby.recordings r ON r.id=a.recording_id
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
      const lockKeys = [
        JSON.stringify(['asset-location', ownerId, preview.provider, preview.bucket ?? null, preview.object_key]),
        JSON.stringify(['asset-checksum', ownerId, preview.checksum_sha256])
      ].sort();
      for (const lockKey of lockKeys) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lockKey]);
      }
      const duplicate = await client.query(
        `SELECT a.*,r.work_id,r.title AS existing_recording_title,w.title AS existing_work_title FROM aby.assets a
         JOIN aby.recordings r ON r.id=a.recording_id
         JOIN aby.works w ON w.id=r.work_id
         WHERE a.owner_id=$1 AND a.provider=$2 AND a.bucket IS NOT DISTINCT FROM $3 AND a.object_key=$4
         FOR UPDATE`,
        [ownerId, preview.provider, preview.bucket, preview.object_key]
      );
      if (duplicate.rows[0]) {
        const existing = duplicate.rows[0];
        if (existing.state !== 'active') {
          throw new AbyError('canonical_asset_inactive', 'Canonical object is already registered but is not active', 409);
        }
        if (existing.checksum_sha256 !== preview.checksum_sha256) {
          throw new AbyError('canonical_asset_conflict', 'Canonical object key is already registered with a different checksum', 409);
        }
        if (existing.existing_work_title !== workTitle || existing.existing_recording_title !== recordingTitle) {
          throw new AbyError('canonical_metadata_conflict', 'Canonical asset already exists with different work or recording metadata', 409);
        }
        await client.query(
          "UPDATE aby.ingest_candidates SET status='committed',committed_asset_id=$1,updated_at=now() WHERE id=$2",
          [existing.id, previewId]
        );
        await client.query('COMMIT');
        return mapAsset(existing);
      }
      const checksumDuplicate = await client.query(
        `SELECT id,provider,bucket,object_key,state FROM aby.assets
         WHERE owner_id=$1 AND checksum_sha256=$2
         FOR UPDATE`,
        [ownerId, preview.checksum_sha256]
      );
      if (checksumDuplicate.rows[0]) {
        throw new AbyError(
          'canonical_checksum_conflict',
          'These bytes are already registered under another canonical object key; explicit reconciliation is required',
          409
        );
      }
      const now = new Date().toISOString();
      const workId = randomUUID();
      const recordingId = randomUUID();
      const assetId = randomUUID();
      const provenance = accepted({ ...preview.provenance, jobId: preview.id }, ownerId);
      const canonicalMetadata = { ...preview.candidate_metadata, title: workTitle, recordingTitle };
      const recordingMetadata = {
        recordingFolder: preview.candidate_metadata.recordingFolder,
        releaseDate: preview.candidate_metadata.releaseDate,
        label: preview.candidate_metadata.label,
        catalogNumber: preview.candidate_metadata.catalogNumber,
        identificationCandidates: preview.candidate_metadata.identificationCandidates
      };
      await client.query('INSERT INTO aby.works(id,owner_id,title,provenance) VALUES($1,$2,$3,$4)', [workId, ownerId, workTitle, provenance]);
      await client.query('INSERT INTO aby.recordings(id,owner_id,work_id,title,metadata,provenance) VALUES($1,$2,$3,$4,$5,$6)', [recordingId, ownerId, workId, recordingTitle, recordingMetadata, provenance]);
      const originalObjectKey = typeof preview.provenance.parameters?.sourceObjectKey === 'string'
        ? preview.provenance.parameters.sourceObjectKey
        : preview.object_key;
      await client.query(
        `INSERT INTO aby.assets
         (id,owner_id,recording_id,provider,bucket,object_key,original_filename,original_object_key,original_directory,checksum_sha256,imported_at,technical_metadata,canonical_metadata,provenance)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [assetId, ownerId, recordingId, preview.provider, preview.bucket, preview.object_key, preview.original_filename,
          originalObjectKey, preview.original_directory, preview.checksum_sha256, now, preview.technical_metadata, canonicalMetadata, provenance]
      );
      await client.query("UPDATE aby.ingest_candidates SET status='committed',committed_asset_id=$1,updated_at=now() WHERE id=$2", [assetId, previewId]);
      await client.query('COMMIT');
      return {
        id: assetId, ownerId, workId, recordingId, provider: preview.provider,
        ...(preview.bucket ? { bucket: preview.bucket } : {}), objectKey: preview.object_key,
        originalFilename: preview.original_filename, checksumSha256: preview.checksum_sha256,
        technicalMetadata: preview.technical_metadata, canonicalMetadata, provenance, createdAt: now
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAsset(ownerId: string, assetId: string): Promise<Asset | null> {
    const result = await this.#pool.query(
      `SELECT a.*, r.work_id FROM aby.assets a JOIN aby.recordings r ON r.id=a.recording_id
       WHERE a.id=$1 AND a.owner_id=$2`, [assetId, ownerId]
    );
    return result.rows[0] ? mapAsset(result.rows[0]) : null;
  }

  async listCatalog(ownerId: string): Promise<CatalogItem[]> {
    const result = await this.#pool.query(
      `SELECT a.*,r.title AS recording_title,r.work_id,w.title AS work_title,
        COALESCE(jsonb_agg(jsonb_build_object(
          'id',s.id,
          'startTimeMs',s.start_time_ms,
          'endTimeMs',s.end_time_ms,
          'label',s.label
        ) ORDER BY s.start_time_ms) FILTER (WHERE s.id IS NOT NULL),'[]'::jsonb) AS segments
       FROM aby.assets a
       JOIN aby.recordings r ON r.id=a.recording_id
       JOIN aby.works w ON w.id=r.work_id
       LEFT JOIN aby.segments s ON s.asset_id=a.id AND s.owner_id=a.owner_id
       WHERE a.owner_id=$1 AND a.state='active'
       GROUP BY a.id,r.title,r.work_id,w.title
       ORDER BY lower(w.title),a.created_at`,
      [ownerId]
    );
    return result.rows.map((row) => {
      const asset = mapAsset(row);
      const imageCandidate = asset.canonicalMetadata.imageCandidates?.[0];
      return {
        asset,
        workTitle: row.work_title,
        recordingTitle: row.recording_title,
        ...(asset.canonicalMetadata.creator ? { creator: asset.canonicalMetadata.creator } : {}),
        ...(imageCandidate?.url ? { coverUrl: imageCandidate.url } : {}),
        ...(asset.canonicalMetadata.releaseDate ? { releaseDate: asset.canonicalMetadata.releaseDate } : {}),
        ...(asset.canonicalMetadata.label ? { label: asset.canonicalMetadata.label } : {}),
        segments: row.segments.map((segment: { id: string; startTimeMs: number | string; endTimeMs: number | string; label?: string | null }) => ({
          id: segment.id,
          startTimeMs: Number(segment.startTimeMs),
          endTimeMs: Number(segment.endTimeMs),
          ...(segment.label ? { label: segment.label } : {})
        }))
      };
    });
  }

  async createSegment(ownerId: string, input: SegmentCreate, provenance: Provenance): Promise<Segment> {
    if (!await this.getAsset(ownerId, input.assetId)) throw new AbyError('asset_not_found', 'Asset not found', 404);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.#pool.query(
      `INSERT INTO aby.segments
       (id,owner_id,asset_id,start_time_ms,end_time_ms,channel_selection,fade_in_ms,fade_out_ms,label,state,provenance,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'accepted',$10,$11)`,
      [id, ownerId, input.assetId, input.startTimeMs, input.endTimeMs, input.channelSelection, input.fadeInMs, input.fadeOutMs, input.label ?? null, provenance, createdAt]
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
