import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import pg from 'pg';
import { sha256File } from '@zztt/aby-media-ingest';
import { relocatedCatalogObjectKey } from '../src/lib/server/catalog-path';
import { copyWasabiCanonicalObject, deleteWasabiCanonicalObject, downloadWasabiObject } from '../src/lib/server/storage';
import { repairLegacyDiacritics } from '../src/lib/server/text-repair';

function argument(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const albumId = argument('album');
const collectionCode = argument('collection')?.toUpperCase();
const entitySlug = argument('entity');
const creator = argument('creator');
const apply = process.argv.includes('--apply');
if (!albumId || !collectionCode || !entitySlug) {
  throw new Error('Use --album=<uuid> --collection=<code> --entity=<slug> [--apply]');
}
if (!/^[A-Z0-9]{1,8}$/.test(collectionCode) || !/^[a-z0-9]+$/.test(entitySlug)) {
  throw new Error('Collection or entity folder is invalid');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
await database.connect();
const directory = await mkdtemp(join(tmpdir(), 'aby-album-relocate-'));

try {
  const result = await database.query<{
    id: string;
    owner_id: string;
    object_key: string;
    checksum_sha256: string;
    canonical_metadata: Record<string, unknown>;
  }>(
    `SELECT a.id,a.owner_id,a.object_key,a.checksum_sha256,a.canonical_metadata
     FROM aby.assets a JOIN aby.recordings r ON r.id=a.recording_id
     WHERE r.album_id=$1 AND a.state='active' ORDER BY a.object_key`,
    [albumId]
  );
  if (!result.rows.length) throw new Error('Album has no active assets');
  const plan = result.rows.map((row) => ({
    ...row,
    target: relocatedCatalogObjectKey(row.object_key, collectionCode, entitySlug, {
      recordingTitle: String(row.canonical_metadata.recordingTitle ?? ''),
      ...(Number(row.canonical_metadata.trackNumber) > 0 ? { trackNumber: Number(row.canonical_metadata.trackNumber) } : {}),
      ...(row.canonical_metadata.creator ? { creator: String(row.canonical_metadata.creator) } : {}),
      ...(row.canonical_metadata.albumTitle ? { albumTitle: String(row.canonical_metadata.albumTitle) } : {})
    })
  })).filter((row) => row.target !== row.object_key);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'preview', albumId, collectionCode, entitySlug, creator,
    assets: result.rows.length, changes: plan.length,
    examples: plan.slice(0, 8).map((row) => ({ source: row.object_key, target: row.target }))
  }, null, 2));

  if (apply) {
    for (const row of plan) {
      const copy = await copyWasabiCanonicalObject(row.object_key, row.target);
      if (copy.source.sizeBytes !== copy.head.sizeBytes) {
        if (copy.created) await deleteWasabiCanonicalObject(row.target).catch(() => undefined);
        throw new Error(`Copied object size differs for ${row.target}`);
      }
      const localPath = join(directory, `${randomUUID()}${extname(row.target).toLowerCase()}`);
      await downloadWasabiObject(row.target, localPath);
      if (await sha256File(localPath) !== row.checksum_sha256) {
        if (copy.created) await deleteWasabiCanonicalObject(row.target).catch(() => undefined);
        throw new Error(`Copied object checksum differs for ${row.target}`);
      }
      const candidates = Array.isArray(row.canonical_metadata.storageRetirementCandidates)
        ? row.canonical_metadata.storageRetirementCandidates
        : [];
      const canonicalMetadata = {
        ...row.canonical_metadata,
        collectionCode,
        entitySlug,
        ...(creator ? { creator: repairLegacyDiacritics(creator) } : {}),
        canonicalObjectKey: row.target,
        storageRetirementCandidates: [{
          sourceObjectKey: row.object_key,
          targetObjectKey: row.target,
          checksumSha256: row.checksum_sha256,
          state: 'candidate',
          copiedAt: new Date().toISOString()
        }, ...candidates]
      };
      const updated = await database.query(
        `UPDATE aby.assets SET object_key=$1,canonical_metadata=$2,updated_at=now()
         WHERE id=$3 AND owner_id=$4 AND object_key=$5 AND state='active' RETURNING id`,
        [row.target, canonicalMetadata, row.id, row.owner_id, row.object_key]
      );
      if (!updated.rows[0]) {
        if (copy.created) await deleteWasabiCanonicalObject(row.target).catch(() => undefined);
        throw new Error(`Catalog asset changed before relocation: ${row.id}`);
      }
      await rm(localPath, { force: true });
    }
    if (creator) {
      await database.query(
        `UPDATE aby.albums SET metadata=jsonb_strip_nulls(metadata || $1::jsonb),updated_at=now()
         WHERE id=$2`,
        [{ creator: repairLegacyDiacritics(creator) }, albumId]
      );
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
  await database.end();
}
