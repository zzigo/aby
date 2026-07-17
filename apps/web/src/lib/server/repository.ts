import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Asset, IngestPreview, Provenance, Segment, SegmentCreate } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { readConfig } from './config';

export interface AbyRepository {
  savePreview(preview: IngestPreview): Promise<IngestPreview>;
  commitPreview(ownerId: string, previewId: string, workTitle: string, recordingTitle: string): Promise<Asset>;
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

  async commitPreview(ownerId: string, previewId: string, workTitle: string, recordingTitle: string): Promise<Asset> {
    const preview = this.#previews.get(previewId);
    if (!preview || preview.ownerId !== ownerId) throw new AbyError('preview_not_found', 'Ingest preview not found', 404);
    if (preview.candidateMetadata.canonicalObjectKey && preview.candidateMetadata.canonicalObjectKey !== preview.objectKey) {
      throw new AbyError('promotion_required', 'The source must be copied, verified and promoted before canonical commit', 409);
    }
    const existing = [...this.#assets.values()].find((value) => value.provenance.jobId === preview.id);
    if (existing) return structuredClone(existing);
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

  async commitPreview(ownerId: string, previewId: string, workTitle: string, recordingTitle: string): Promise<Asset> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM aby.ingest_candidates WHERE id=$1 AND owner_id=$2 FOR UPDATE', [previewId, ownerId]);
      const preview = result.rows[0];
      if (!preview) throw new AbyError('preview_not_found', 'Ingest preview not found', 404);
      if (preview.status === 'committed') {
        const existing = await client.query(
          `SELECT a.*, r.work_id FROM aby.assets a JOIN aby.recordings r ON r.id=a.recording_id
           WHERE a.id=$1 AND a.owner_id=$2`, [preview.committed_asset_id, ownerId]
        );
        await client.query('COMMIT');
        return mapAsset(existing.rows[0]);
      }
      if (preview.candidate_metadata.canonicalObjectKey && preview.candidate_metadata.canonicalObjectKey !== preview.object_key) {
        throw new AbyError('promotion_required', 'The source must be copied, verified and promoted before canonical commit', 409);
      }
      const now = new Date().toISOString();
      const workId = randomUUID();
      const recordingId = randomUUID();
      const assetId = randomUUID();
      const provenance = accepted({ ...preview.provenance, jobId: preview.id }, ownerId);
      const canonicalMetadata = { ...preview.candidate_metadata, title: workTitle, recordingTitle };
      await client.query('INSERT INTO aby.works(id,owner_id,title,provenance) VALUES($1,$2,$3,$4)', [workId, ownerId, workTitle, provenance]);
      await client.query('INSERT INTO aby.recordings(id,owner_id,work_id,title,provenance) VALUES($1,$2,$3,$4,$5)', [recordingId, ownerId, workId, recordingTitle, provenance]);
      await client.query(
        `INSERT INTO aby.assets
         (id,owner_id,recording_id,provider,bucket,object_key,original_filename,original_object_key,original_directory,checksum_sha256,imported_at,technical_metadata,canonical_metadata,provenance)
         VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,$9,$10,$11,$12,$13)`,
        [assetId, ownerId, recordingId, preview.provider, preview.bucket, preview.object_key, preview.original_filename,
          preview.original_directory, preview.checksum_sha256, now, preview.technical_metadata, canonicalMetadata, provenance]
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
