import pg from 'pg';
import { repairCatalogMetadata, repairLegacyDiacritics } from '../src/lib/server/text-repair';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const apply = process.argv.includes('--apply');
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const titleChanges: Array<{ table: 'works' | 'albums' | 'recordings'; id: string; before: string; after: string }> = [];
  for (const table of ['works', 'albums', 'recordings'] as const) {
    const result = await client.query<{ id: string; title: string }>(`SELECT id,title FROM aby.${table}`);
    for (const row of result.rows) {
      const after = repairLegacyDiacritics(row.title);
      if (after !== row.title) titleChanges.push({ table, id: row.id, before: row.title, after });
    }
  }

  const assetResult = await client.query<{ id: string; canonical_metadata: Record<string, unknown> }>(
    "SELECT id,canonical_metadata FROM aby.assets WHERE state='active'"
  );
  const metadataChanges = assetResult.rows.flatMap((row) => {
    const after = repairCatalogMetadata(row.canonical_metadata);
    return JSON.stringify(after) === JSON.stringify(row.canonical_metadata) ? [] : [{ id: row.id, after }];
  });

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'preview',
    titleChanges: titleChanges.length,
    metadataChanges: metadataChanges.length,
    examples: titleChanges.slice(0, 25).map(({ table, before, after }) => ({ table, before, after }))
  }, null, 2));

  if (apply && (titleChanges.length || metadataChanges.length)) {
    await client.query('BEGIN');
    for (const change of titleChanges) {
      await client.query(`UPDATE aby.${change.table} SET title=$1,updated_at=now() WHERE id=$2`, [change.after, change.id]);
    }
    for (const change of metadataChanges) {
      await client.query('UPDATE aby.assets SET canonical_metadata=$1,updated_at=now() WHERE id=$2', [change.after, change.id]);
    }
    await client.query('COMMIT');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
