import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from './config';
import { AbyError } from './errors';

export type MediaRelocationState =
  | 'draft' | 'copying' | 'verifying' | 'retirement_pending'
  | 'retiring' | 'succeeded' | 'failed' | 'cancelled';

export interface MediaRelocationFile {
  assetId?: string;
  role: 'media' | 'subtitle' | 'booklet';
  sourceObjectKey: string;
  destinationObjectKey: string;
  sizeBytes: number;
  expectedChecksumSha256?: string;
  sourceChecksumSha256?: string;
  destinationChecksumSha256?: string;
  state: 'planned' | 'copying' | 'copied' | 'verifying' | 'verified' | 'retired' | 'failed';
  error?: string;
}

export interface MediaRelocationOperation {
  id: string;
  ownerId: string;
  mediaKind: 'audio' | 'video';
  entityType: 'album' | 'work' | 'av_item';
  entityId: string;
  title: string;
  sourcePrefix: string;
  destinationPrefix: string;
  collectionCode?: string;
  entitySlug?: string;
  state: MediaRelocationState;
  stage: string;
  files: MediaRelocationFile[];
  pattern: Record<string, unknown>;
  sizeBytes: number;
  transferredBytes: number;
  speedBytesPerSecond: number;
  etaSeconds?: number;
  beaconAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  verifiedAt?: string;
  finishedAt?: string;
}

export interface MediaRelocationCreate {
  mediaKind: MediaRelocationOperation['mediaKind'];
  entityType: MediaRelocationOperation['entityType'];
  entityId: string;
  title: string;
  sourcePrefix: string;
  destinationPrefix: string;
  collectionCode?: string;
  entitySlug?: string;
  files: MediaRelocationFile[];
  pattern: Record<string, unknown>;
}

type OperationPatch = Partial<Pick<
  MediaRelocationOperation,
  'state' | 'stage' | 'files' | 'transferredBytes' | 'speedBytesPerSecond' |
  'etaSeconds' | 'beaconAt' | 'error' | 'startedAt' | 'verifiedAt' | 'finishedAt'
>>;

function mapOperation(row: any): MediaRelocationOperation {
  return {
    id: row.id, ownerId: row.owner_id, mediaKind: row.media_kind, entityType: row.entity_type,
    entityId: row.entity_id, title: row.title, sourcePrefix: row.source_prefix,
    destinationPrefix: row.destination_prefix,
    ...(row.collection_code ? { collectionCode: row.collection_code } : {}),
    ...(row.entity_slug ? { entitySlug: row.entity_slug } : {}),
    state: row.state, stage: row.stage, files: row.files ?? [], pattern: row.pattern ?? {},
    sizeBytes: Number(row.size_bytes), transferredBytes: Number(row.transferred_bytes),
    speedBytesPerSecond: Number(row.speed_bytes_per_second),
    ...(row.eta_seconds !== null ? { etaSeconds: row.eta_seconds } : {}),
    ...(row.beacon_at ? { beaconAt: new Date(row.beacon_at).toISOString() } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.started_at ? { startedAt: new Date(row.started_at).toISOString() } : {}),
    ...(row.verified_at ? { verifiedAt: new Date(row.verified_at).toISOString() } : {}),
    ...(row.finished_at ? { finishedAt: new Date(row.finished_at).toISOString() } : {})
  };
}

export class MediaRelocationRepository {
  readonly #pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.#pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  }

  async create(ownerId: string, input: MediaRelocationCreate): Promise<MediaRelocationOperation> {
    const active = await this.#pool.query(
      `SELECT * FROM aby.media_relocation_operations
       WHERE owner_id=$1 AND media_kind=$2 AND entity_type=$3 AND entity_id=$4
         AND state NOT IN ('succeeded','cancelled')
       ORDER BY created_at DESC LIMIT 1`,
      [ownerId, input.mediaKind, input.entityType, input.entityId]
    );
    if (active.rows[0] && !['draft', 'failed'].includes(active.rows[0].state)) {
      throw new AbyError('relocation_already_active', 'This item already has an active storage operation', 409);
    }
    if (active.rows[0]) {
      const result = await this.#pool.query(
        `UPDATE aby.media_relocation_operations SET
          title=$1,source_prefix=$2,destination_prefix=$3,collection_code=$4,entity_slug=$5,
          state='draft',stage='planned',files=$6,pattern=$7,size_bytes=$8,transferred_bytes=0,
          speed_bytes_per_second=0,eta_seconds=NULL,beacon_at=NULL,error=NULL,updated_at=now(),
          started_at=NULL,verified_at=NULL,finished_at=NULL
         WHERE id=$9 AND owner_id=$10 RETURNING *`,
        [input.title, input.sourcePrefix, input.destinationPrefix, input.collectionCode ?? null,
          input.entitySlug ?? null, JSON.stringify(input.files), JSON.stringify(input.pattern),
          input.files.reduce((total, file) => total + file.sizeBytes, 0), active.rows[0].id, ownerId]
      );
      return mapOperation(result.rows[0]);
    }
    const result = await this.#pool.query(
      `INSERT INTO aby.media_relocation_operations
       (id,owner_id,media_kind,entity_type,entity_id,title,source_prefix,destination_prefix,
        collection_code,entity_slug,files,pattern,size_bytes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [randomUUID(), ownerId, input.mediaKind, input.entityType, input.entityId, input.title,
        input.sourcePrefix, input.destinationPrefix, input.collectionCode ?? null, input.entitySlug ?? null,
        JSON.stringify(input.files), JSON.stringify(input.pattern),
        input.files.reduce((total, file) => total + file.sizeBytes, 0)]
    );
    return mapOperation(result.rows[0]);
  }

  async list(ownerId: string): Promise<MediaRelocationOperation[]> {
    const result = await this.#pool.query(
      'SELECT * FROM aby.media_relocation_operations WHERE owner_id=$1 ORDER BY created_at DESC',
      [ownerId]
    );
    return result.rows.map(mapOperation);
  }

  async get(ownerId: string, id: string): Promise<MediaRelocationOperation | null> {
    const result = await this.#pool.query(
      'SELECT * FROM aby.media_relocation_operations WHERE id=$1 AND owner_id=$2',
      [id, ownerId]
    );
    return result.rows[0] ? mapOperation(result.rows[0]) : null;
  }

  async update(ownerId: string, id: string, patch: OperationPatch): Promise<MediaRelocationOperation> {
    const current = await this.get(ownerId, id);
    if (!current) throw new AbyError('relocation_not_found', 'Storage relocation not found', 404);
    const next = { ...current, ...patch };
    const result = await this.#pool.query(
      `UPDATE aby.media_relocation_operations SET state=$1,stage=$2,files=$3,transferred_bytes=$4,
       speed_bytes_per_second=$5,eta_seconds=$6,beacon_at=$7,error=$8,started_at=$9,
       verified_at=$10,finished_at=$11,updated_at=now() WHERE id=$12 AND owner_id=$13 RETURNING *`,
      [next.state, next.stage, JSON.stringify(next.files), next.transferredBytes,
        next.speedBytesPerSecond, next.etaSeconds ?? null, next.beaconAt ?? null,
        next.error ?? null, next.startedAt ?? null, next.verifiedAt ?? null,
        next.finishedAt ?? null, id, ownerId]
    );
    return mapOperation(result.rows[0]);
  }
}

let repository: MediaRelocationRepository | undefined;
export function getMediaRelocationRepository() {
  if (repository) return repository;
  const config = readConfig();
  if (!config.DATABASE_URL) {
    throw new AbyError('relocation_database_required', 'Storage relocation requires PostgreSQL', 503);
  }
  repository = new MediaRelocationRepository(config.DATABASE_URL);
  return repository;
}
