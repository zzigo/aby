import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { AvCatalogCreate, AvCatalogItem, Capture, CaptureCreate, StorageOperation } from '@zztt/aby-domain';
import { readConfig } from './config';
import { AbyError } from './errors';

type TechnicalMetadata = AvCatalogItem['technicalMetadata'];
type OperationPatch = Partial<Pick<StorageOperation, 'state' | 'sizeBytes' | 'transferredBytes' | 'speedBytesPerSecond' | 'etaSeconds' | 'beaconAt' | 'error' | 'startedAt' | 'finishedAt'>>;

export function postgresJson(value: unknown) {
  return JSON.stringify(value);
}

export interface AvRepository {
  createItem(ownerId: string, bucket: string, input: AvCatalogCreate, technicalMetadata: TechnicalMetadata): Promise<{ item: AvCatalogItem; operation: StorageOperation }>;
  listItems(ownerId: string): Promise<AvCatalogItem[]>;
  getItem(ownerId: string, id: string): Promise<AvCatalogItem | null>;
  updateItemMetadata(ownerId: string, id: string, patch: { title?: string; director?: string; summary?: string }): Promise<AvCatalogItem>;
  updateItemTechnicalMetadata(ownerId: string, id: string, technicalMetadata: TechnicalMetadata): Promise<AvCatalogItem>;
  setItemState(ownerId: string, id: string, state: AvCatalogItem['state']): Promise<void>;
  listOperations(ownerId: string): Promise<StorageOperation[]>;
  getOperation(ownerId: string, id: string): Promise<StorageOperation | null>;
  updateOperation(ownerId: string, id: string, patch: OperationPatch): Promise<StorageOperation>;
  updatePendingDestination(ownerId: string, id: string, destinationObjectKey: string): Promise<{ item: AvCatalogItem; operation: StorageOperation }>;
  createCapture(ownerId: string, input: CaptureCreate): Promise<Capture>;
  listCaptures(ownerId: string): Promise<Capture[]>;
  getCaptureByToken(token: string): Promise<Capture | null>;
}

function now() { return new Date().toISOString(); }

export class MemoryAvRepository implements AvRepository {
  #items = new Map<string, AvCatalogItem>();
  #operations = new Map<string, StorageOperation>();
  #captures = new Map<string, Capture>();

  async createItem(ownerId: string, bucket: string, input: AvCatalogCreate, technicalMetadata: TechnicalMetadata) {
    if ([...this.#items.values()].some((item) => item.ownerId === ownerId && item.sourceObjectKey === input.sourceObjectKey)) {
      throw new AbyError('av_source_already_cataloged', 'This video is already in the AV catalog', 409);
    }
    const timestamp = now();
    const item: AvCatalogItem = { id: randomUUID(), ownerId, provider: 'wasabi', bucket, ...input, technicalMetadata, state: 'queued', createdAt: timestamp, updatedAt: timestamp };
    const operation: StorageOperation = {
      id: randomUUID(), ownerId, avItemId: item.id, operation: 'copy', sourceObjectKey: input.sourceObjectKey,
      destinationObjectKey: input.destinationObjectKey, state: 'pending', sizeBytes: technicalMetadata.sizeBytes + (technicalMetadata.sidecarSubtitles ?? []).reduce((total, subtitle) => total + subtitle.sizeBytes, 0),
      transferredBytes: 0, speedBytesPerSecond: 0, createdAt: timestamp
    };
    this.#items.set(item.id, structuredClone(item));
    this.#operations.set(operation.id, structuredClone(operation));
    return { item, operation };
  }

  async listItems(ownerId: string) { return [...this.#items.values()].filter((item) => item.ownerId === ownerId).map((item) => structuredClone(item)); }
  async getItem(ownerId: string, id: string) { const item = this.#items.get(id); return item?.ownerId === ownerId ? structuredClone(item) : null; }
  async updateItemMetadata(ownerId: string, id: string, patch: { title?: string; director?: string; summary?: string }) {
    const item = this.#items.get(id);
    if (!item || item.ownerId !== ownerId) throw new AbyError('av_item_not_found', 'AV item not found', 404);
    const updated = { ...item, ...patch, updatedAt: now() };
    this.#items.set(id, updated);
    return structuredClone(updated);
  }
  async updateItemTechnicalMetadata(ownerId: string, id: string, technicalMetadata: TechnicalMetadata) {
    const item = this.#items.get(id);
    if (!item || item.ownerId !== ownerId) throw new AbyError('av_item_not_found', 'AV item not found', 404);
    const updated = { ...item, technicalMetadata, updatedAt: now() };
    this.#items.set(id, updated);
    return structuredClone(updated);
  }
  async setItemState(ownerId: string, id: string, state: AvCatalogItem['state']) {
    const item = this.#items.get(id);
    if (!item || item.ownerId !== ownerId) throw new AbyError('av_item_not_found', 'AV item not found', 404);
    this.#items.set(id, { ...item, state, updatedAt: now() });
  }
  async listOperations(ownerId: string) { return [...this.#operations.values()].filter((operation) => operation.ownerId === ownerId).map((operation) => structuredClone(operation)); }
  async getOperation(ownerId: string, id: string) { const operation = this.#operations.get(id); return operation?.ownerId === ownerId ? structuredClone(operation) : null; }
  async updateOperation(ownerId: string, id: string, patch: OperationPatch) {
    const operation = this.#operations.get(id);
    if (!operation || operation.ownerId !== ownerId) throw new AbyError('operation_not_found', 'Storage operation not found', 404);
    const updated = { ...operation, ...patch };
    this.#operations.set(id, updated);
    return structuredClone(updated);
  }
  async updatePendingDestination(ownerId: string, id: string, destinationObjectKey: string) {
    const operation = this.#operations.get(id);
    if (!operation || operation.ownerId !== ownerId) throw new AbyError('operation_not_found', 'Storage operation not found', 404);
    if (operation.state !== 'pending') throw new AbyError('operation_destination_locked', 'Destination can only be edited while the operation is pending', 409);
    if ([...this.#operations.values()].some((candidate) => candidate.id !== id && candidate.ownerId === ownerId && candidate.destinationObjectKey === destinationObjectKey)) {
      throw new AbyError('av_destination_conflict', 'Another AV operation already uses this destination', 409);
    }
    const item = this.#items.get(operation.avItemId);
    if (!item || item.ownerId !== ownerId) throw new AbyError('av_item_not_found', 'AV item not found', 404);
    const directory = destinationObjectKey.slice(0, destinationObjectKey.lastIndexOf('/'));
    const technicalMetadata = {
      ...item.technicalMetadata,
      ...(item.technicalMetadata.sidecarSubtitles ? {
        sidecarSubtitles: item.technicalMetadata.sidecarSubtitles.map((subtitle) => ({
          ...subtitle,
          destinationObjectKey: `${directory}/${subtitle.sourceObjectKey.split('/').at(-1)}`
        }))
      } : {})
    };
    const updatedItem = { ...item, destinationObjectKey, technicalMetadata, updatedAt: now() };
    const updatedOperation = { ...operation, destinationObjectKey };
    this.#items.set(item.id, structuredClone(updatedItem));
    this.#operations.set(id, structuredClone(updatedOperation));
    return { item: structuredClone(updatedItem), operation: structuredClone(updatedOperation) };
  }
  async createCapture(ownerId: string, input: CaptureCreate) {
    if (input.avItemId && !await this.getItem(ownerId, input.avItemId)) throw new AbyError('av_item_not_found', 'AV item not found', 404);
    const timestamp = now();
    const capture: Capture = { id: randomUUID(), ownerId, ...input, shareToken: randomBytes(24).toString('base64url'), shareUrl: '', createdAt: timestamp, updatedAt: timestamp };
    capture.shareUrl = `/share/${capture.shareToken}`;
    this.#captures.set(capture.id, structuredClone(capture));
    return capture;
  }
  async listCaptures(ownerId: string) { return [...this.#captures.values()].filter((capture) => capture.ownerId === ownerId).map((capture) => structuredClone(capture)); }
  async getCaptureByToken(token: string) { const capture = [...this.#captures.values()].find((candidate) => candidate.shareToken === token); return capture ? structuredClone(capture) : null; }
}

function mapItem(row: any): AvCatalogItem {
  return {
    id: row.id, ownerId: row.owner_id, provider: 'wasabi', bucket: row.bucket,
    sourceObjectKey: row.source_object_key, destinationObjectKey: row.destination_object_key,
    title: row.title, ...(row.original_title ? { originalTitle: row.original_title } : {}), kind: row.kind,
    ...(row.year ? { year: row.year } : {}), ...(row.director ? { director: row.director } : {}),
    ...(row.composer ? { composer: row.composer } : {}),
    ...(row.entity ? { entity: row.entity } : {}), ...(row.saga ? { saga: row.saga } : {}),
    ...(row.country ? { country: row.country } : {}), countries: row.countries?.length ? row.countries : row.country?.split(',').map((value: string) => value.trim()).filter(Boolean) ?? [],
    languages: row.languages ?? [], tags: row.tags ?? [],
    ...(row.summary ? { summary: row.summary } : {}), ...(row.poster_url ? { posterUrl: row.poster_url } : {}),
    ...(row.edition_notes ? { editionNotes: row.edition_notes } : {}),
    credits: row.credits ?? [], externalIds: row.external_ids ?? {}, metadataSources: row.metadata_sources ?? [],
    technicalMetadata: row.technical_metadata, treeStrategy: row.tree_strategy, treeValue: row.tree_value,
    state: row.state, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
  };
}

function mapOperation(row: any): StorageOperation {
  return {
    id: row.id, ownerId: row.owner_id, avItemId: row.av_item_id, operation: 'copy',
    sourceObjectKey: row.source_object_key, destinationObjectKey: row.destination_object_key, state: row.state,
    sizeBytes: Number(row.size_bytes), transferredBytes: Number(row.transferred_bytes), speedBytesPerSecond: Number(row.speed_bytes_per_second),
    ...(row.eta_seconds !== null ? { etaSeconds: row.eta_seconds } : {}),
    ...(row.beacon_at ? { beaconAt: new Date(row.beacon_at).toISOString() } : {}),
    ...(row.error ? { error: row.error } : {}), createdAt: new Date(row.created_at).toISOString(),
    ...(row.started_at ? { startedAt: new Date(row.started_at).toISOString() } : {}),
    ...(row.finished_at ? { finishedAt: new Date(row.finished_at).toISOString() } : {})
  };
}

function mapCapture(row: any): Capture {
  return {
    id: row.id, ownerId: row.owner_id, mediaKind: row.media_kind,
    ...(row.asset_id ? { assetId: row.asset_id } : {}), ...(row.av_item_id ? { avItemId: row.av_item_id } : {}),
    startTimeMs: Number(row.start_time_ms), endTimeMs: Number(row.end_time_ms),
    ...(row.label ? { label: row.label } : {}), annotations: row.annotations ?? [],
    shareToken: row.share_token, shareUrl: `/share/${row.share_token}`,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
  };
}

export class PostgresAvRepository implements AvRepository {
  #pool: pg.Pool;
  constructor(databaseUrl: string) { this.#pool = new pg.Pool({ connectionString: databaseUrl, max: 5 }); }

  async createItem(ownerId: string, bucket: string, input: AvCatalogCreate, technicalMetadata: TechnicalMetadata) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const itemId = randomUUID(); const operationId = randomUUID();
      const itemResult = await client.query(
        `INSERT INTO aby.av_catalog_items
         (id,owner_id,bucket,source_object_key,destination_object_key,title,original_title,kind,year,director,composer,entity,saga,country,countries,languages,tags,summary,edition_notes,poster_url,credits,external_ids,metadata_sources,technical_metadata,tree_strategy,tree_value,state)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'queued') RETURNING *`,
        [itemId, ownerId, bucket, input.sourceObjectKey, input.destinationObjectKey, input.title, input.originalTitle ?? null, input.kind, input.year ?? null,
          input.director ?? null, input.composer ?? null, input.entity ?? null, input.saga ?? null, input.countries[0] ?? input.country ?? null,
          postgresJson(input.countries), postgresJson(input.languages), postgresJson(input.tags), input.summary ?? null, input.editionNotes ?? null, input.posterUrl ?? null,
          postgresJson(input.credits), postgresJson(input.externalIds), postgresJson(input.metadataSources), postgresJson(technicalMetadata), input.treeStrategy, input.treeValue]
      );
      const operationResult = await client.query(
        `INSERT INTO aby.storage_operations
         (id,owner_id,av_item_id,source_object_key,destination_object_key,size_bytes)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [operationId, ownerId, itemId, input.sourceObjectKey, input.destinationObjectKey, technicalMetadata.sizeBytes + (technicalMetadata.sidecarSubtitles ?? []).reduce((total, subtitle) => total + subtitle.sizeBytes, 0)]
      );
      await client.query('COMMIT');
      return { item: mapItem(itemResult.rows[0]), operation: mapOperation(operationResult.rows[0]) };
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') throw new AbyError('av_item_conflict', 'Source or proposed destination is already queued', 409);
      throw error;
    } finally { client.release(); }
  }
  async listItems(ownerId: string) { const result = await this.#pool.query('SELECT * FROM aby.av_catalog_items WHERE owner_id=$1 ORDER BY created_at DESC', [ownerId]); return result.rows.map(mapItem); }
  async getItem(ownerId: string, id: string) { const result = await this.#pool.query('SELECT * FROM aby.av_catalog_items WHERE id=$1 AND owner_id=$2', [id, ownerId]); return result.rows[0] ? mapItem(result.rows[0]) : null; }
  async updateItemMetadata(ownerId: string, id: string, patch: { title?: string; director?: string; summary?: string }) {
    const result = await this.#pool.query(
      `UPDATE aby.av_catalog_items SET title=COALESCE($1,title),director=COALESCE($2,director),summary=COALESCE($3,summary),updated_at=now()
       WHERE id=$4 AND owner_id=$5 RETURNING *`,
      [patch.title ?? null, patch.director ?? null, patch.summary ?? null, id, ownerId]
    );
    if (!result.rows[0]) throw new AbyError('av_item_not_found', 'AV item not found', 404);
    return mapItem(result.rows[0]);
  }
  async updateItemTechnicalMetadata(ownerId: string, id: string, technicalMetadata: TechnicalMetadata) {
    const result = await this.#pool.query(
      'UPDATE aby.av_catalog_items SET technical_metadata=$1,updated_at=now() WHERE id=$2 AND owner_id=$3 RETURNING *',
      [postgresJson(technicalMetadata), id, ownerId]
    );
    if (!result.rows[0]) throw new AbyError('av_item_not_found', 'AV item not found', 404);
    return mapItem(result.rows[0]);
  }
  async setItemState(ownerId: string, id: string, state: AvCatalogItem['state']) {
    const result = await this.#pool.query('UPDATE aby.av_catalog_items SET state=$1,updated_at=now() WHERE id=$2 AND owner_id=$3 RETURNING id', [state, id, ownerId]);
    if (!result.rows[0]) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  }
  async listOperations(ownerId: string) { const result = await this.#pool.query('SELECT * FROM aby.storage_operations WHERE owner_id=$1 ORDER BY created_at DESC', [ownerId]); return result.rows.map(mapOperation); }
  async getOperation(ownerId: string, id: string) { const result = await this.#pool.query('SELECT * FROM aby.storage_operations WHERE id=$1 AND owner_id=$2', [id, ownerId]); return result.rows[0] ? mapOperation(result.rows[0]) : null; }
  async updateOperation(ownerId: string, id: string, patch: OperationPatch) {
    const current = await this.getOperation(ownerId, id);
    if (!current) throw new AbyError('operation_not_found', 'Storage operation not found', 404);
    const next = { ...current, ...patch };
    const result = await this.#pool.query(
      `UPDATE aby.storage_operations SET state=$1,size_bytes=$2,transferred_bytes=$3,speed_bytes_per_second=$4,eta_seconds=$5,beacon_at=$6,error=$7,started_at=$8,finished_at=$9 WHERE id=$10 AND owner_id=$11 RETURNING *`,
      [next.state, next.sizeBytes, next.transferredBytes, next.speedBytesPerSecond, next.etaSeconds ?? null, next.beaconAt ?? null, next.error ?? null, next.startedAt ?? null, next.finishedAt ?? null, id, ownerId]
    );
    return mapOperation(result.rows[0]);
  }
  async updatePendingDestination(ownerId: string, id: string, destinationObjectKey: string) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT so.*,i.technical_metadata
         FROM aby.storage_operations so JOIN aby.av_catalog_items i ON i.id=so.av_item_id
         WHERE so.id=$1 AND so.owner_id=$2 FOR UPDATE`,
        [id, ownerId]
      );
      const row = found.rows[0];
      if (!row) throw new AbyError('operation_not_found', 'Storage operation not found', 404);
      if (row.state !== 'pending') throw new AbyError('operation_destination_locked', 'Destination can only be edited while the operation is pending', 409);
      const directory = destinationObjectKey.slice(0, destinationObjectKey.lastIndexOf('/'));
      const technicalMetadata: TechnicalMetadata = {
        ...row.technical_metadata,
        ...(row.technical_metadata.sidecarSubtitles ? {
          sidecarSubtitles: row.technical_metadata.sidecarSubtitles.map((subtitle: NonNullable<TechnicalMetadata['sidecarSubtitles']>[number]) => ({
            ...subtitle,
            destinationObjectKey: `${directory}/${subtitle.sourceObjectKey.split('/').at(-1)}`
          }))
        } : {})
      };
      const itemResult = await client.query(
        'UPDATE aby.av_catalog_items SET destination_object_key=$1,technical_metadata=$2,updated_at=now() WHERE id=$3 AND owner_id=$4 RETURNING *',
        [destinationObjectKey, postgresJson(technicalMetadata), row.av_item_id, ownerId]
      );
      const operationResult = await client.query(
        'UPDATE aby.storage_operations SET destination_object_key=$1 WHERE id=$2 AND owner_id=$3 RETURNING *',
        [destinationObjectKey, id, ownerId]
      );
      await client.query('COMMIT');
      return { item: mapItem(itemResult.rows[0]), operation: mapOperation(operationResult.rows[0]) };
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') throw new AbyError('av_destination_conflict', 'Another AV operation already uses this destination', 409);
      throw error;
    } finally { client.release(); }
  }
  async createCapture(ownerId: string, input: CaptureCreate) {
    const result = await this.#pool.query(
      `INSERT INTO aby.captures(id,owner_id,media_kind,asset_id,av_item_id,start_time_ms,end_time_ms,label,annotations,share_token)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [randomUUID(), ownerId, input.mediaKind, input.assetId ?? null, input.avItemId ?? null, input.startTimeMs, input.endTimeMs, input.label ?? null, postgresJson(input.annotations), randomBytes(24).toString('base64url')]
    );
    return mapCapture(result.rows[0]);
  }
  async listCaptures(ownerId: string) { const result = await this.#pool.query('SELECT * FROM aby.captures WHERE owner_id=$1 ORDER BY created_at DESC', [ownerId]); return result.rows.map(mapCapture); }
  async getCaptureByToken(token: string) { const result = await this.#pool.query('SELECT * FROM aby.captures WHERE share_token=$1', [token]); return result.rows[0] ? mapCapture(result.rows[0]) : null; }
}

let avRepository: AvRepository | undefined;
export function getAvRepository(): AvRepository {
  if (avRepository) return avRepository;
  const config = readConfig();
  avRepository = config.DATABASE_URL ? new PostgresAvRepository(config.DATABASE_URL) : new MemoryAvRepository();
  return avRepository;
}
