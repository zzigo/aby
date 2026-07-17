import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required; no migration was applied');

const sql = await readFile(resolve('../..', 'migrations/0001_aby_core.sql'), 'utf8');
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query(sql);
  console.info(JSON.stringify({ service: 'aby-migrate', migration: '0001_aby_core', status: 'applied' }));
} finally {
  await client.end();
}

