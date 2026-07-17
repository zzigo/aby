import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required; no migration was applied');

const migrationsDirectory = resolve('../..', 'migrations');
const migrations = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  for (const migration of migrations) {
    await client.query(await readFile(resolve(migrationsDirectory, migration), 'utf8'));
    console.info(JSON.stringify({ service: 'aby-migrate', migration, status: 'applied' }));
  }
} finally {
  await client.end();
}
