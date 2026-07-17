import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const endpoint = process.env.ABY_LOGTO_ENDPOINT || 'https://logto.zztt.org';
const envPath = process.env.ABY_ENV_PATH || '/opt/apps/aby/.env';
const managementResource = 'https://default.logto.app/api';
const redirectUri = 'https://aby.zztt.org/callback';
const postLogoutRedirectUri = 'https://aby.zztt.org';

async function dockerNode<T>(source: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'logto', 'node'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (value) => { stdout += value; });
    child.stderr.setEncoding('utf8').on('data', (value) => { stderr += value; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`Logto container query failed: ${stderr.trim() || `exit ${code}`}`));
      else {
        try { resolve(JSON.parse(stdout) as T); }
        catch { reject(new Error('Logto container returned an invalid response')); }
      }
    });
    child.stdin.end(source);
  });
}

async function managementCredentials() {
  return dockerNode<{ id: string; secret: string }>(String.raw`
    (async()=>{
      const {Client}=require('pg');
      const {randomBytes}=require('crypto');
      const client=new Client({connectionString:process.env.DB_URL});
      await client.connect();
      let result=await client.query(
        "select a.id,s.value as secret from applications a join application_secrets s on s.application_id=a.id where a.id='m-default' and (s.expires_at is null or s.expires_at>now()) order by s.created_at desc limit 1"
      );
      if(!result.rows[0]){
        const secret=randomBytes(24).toString('base64url');
        await client.query(
          "insert into application_secrets(tenant_id,application_id,name,value,created_at,expires_at) select tenant_id,id,'Aby provisioning', $1,now(),null from applications where id='m-default' on conflict do nothing",
          [secret]
        );
        result=await client.query(
          "select a.id,s.value as secret from applications a join application_secrets s on s.application_id=a.id where a.id='m-default' and (s.expires_at is null or s.expires_at>now()) order by s.created_at desc limit 1"
        );
      }
      await client.end();
      if(!result.rows[0]) throw new Error('Management application secret not found');
      console.log(JSON.stringify({id:result.rows[0].id,secret:result.rows[0].secret}));
    })().catch(error=>{console.error(error.message);process.exit(1)});
  `);
}

async function applicationSecret(applicationId: string) {
  return dockerNode<{ secret: string }>(String.raw`
    (async()=>{
      const {Client}=require('pg');
      const {randomBytes}=require('crypto');
      const client=new Client({connectionString:process.env.DB_URL});
      await client.connect();
      let result=await client.query(
        "select s.value as secret from application_secrets s where s.application_id=$1 and (s.expires_at is null or s.expires_at>now()) order by s.created_at desc limit 1",
        [${JSON.stringify(applicationId)}]
      );
      if(!result.rows[0]){
        const secret=randomBytes(24).toString('base64url');
        await client.query(
          "insert into application_secrets(tenant_id,application_id,name,value,created_at,expires_at) select tenant_id,id,'Default secret',$2,now(),null from applications where id=$1 on conflict do nothing",
          [${JSON.stringify(applicationId)},secret]
        );
        result=await client.query(
          "select value as secret from application_secrets where application_id=$1 and (expires_at is null or expires_at>now()) order by created_at desc limit 1",
          [${JSON.stringify(applicationId)}]
        );
      }
      await client.end();
      if(!result.rows[0]) throw new Error('Aby application secret not found');
      console.log(JSON.stringify({secret:result.rows[0].secret}));
    })().catch(error=>{console.error(error.message);process.exit(1)});
  `);
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers }
  });
  if (!response.ok) throw new Error(`Logto Management API ${path} failed with HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function setEnv(source: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const expression = new RegExp(`^${key}=.*$`, 'm');
  return expression.test(source) ? source.replace(expression, line) : `${source.trimEnd()}\n${line}\n`;
}

const management = await managementCredentials();
const tokenResponse = await fetch(`${endpoint}/oidc/token`, {
  method: 'POST',
  headers: {
    authorization: `Basic ${Buffer.from(`${management.id}:${management.secret}`).toString('base64')}`,
    'content-type': 'application/x-www-form-urlencoded'
  },
  body: new URLSearchParams({ grant_type: 'client_credentials', resource: managementResource, scope: 'all' })
});
if (!tokenResponse.ok) {
  const detail = (await tokenResponse.text()).replace(/\s+/g, ' ').slice(0, 300);
  throw new Error(`Logto Management token failed with HTTP ${tokenResponse.status}: ${detail}`);
}
const { access_token: accessToken } = await tokenResponse.json() as { access_token?: string };
if (!accessToken) throw new Error('Logto Management token response omitted access_token');

const applications = await api<Array<{ id: string; name: string; type: string }>>('/api/applications?page=1&page_size=100', accessToken);
let application = applications.find((candidate) => candidate.name.toLowerCase() === 'aby');
const applicationConfig = {
  name: 'aby',
  description: 'Aby temporal media intelligence',
  oidcClientMetadata: {
    redirectUris: [redirectUri],
    postLogoutRedirectUris: [postLogoutRedirectUri],
    backchannelLogoutSessionRequired: false
  },
  customClientMetadata: {
    idTokenTtl: 3600,
    allowTokenExchange: false,
    corsAllowedOrigins: [],
    rotateRefreshToken: true,
    refreshTokenTtlInDays: 14,
    alwaysIssueRefreshToken: false
  },
  customData: { boundedContext: 'aby' }
};
if (!application) {
  application = await api<{ id: string; name: string; type: string }>('/api/applications', accessToken, {
    method: 'POST',
    body: JSON.stringify({ ...applicationConfig, type: 'Traditional' })
  });
} else {
  application = await api<{ id: string; name: string; type: string }>(`/api/applications/${application.id}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify(applicationConfig)
  });
}
if (application.type !== 'Traditional') throw new Error('Existing Aby Logto application is not a Traditional app');
const { secret } = await applicationSecret(application.id);
let environment = await readFile(envPath, 'utf8');
environment = setEnv(environment, 'ABY_STORAGE_PREFIX', 'aby/');
environment = setEnv(environment, 'ABY_AUDIO_PREFIX', 'aby/aud/');
environment = setEnv(environment, 'ABY_VIDEO_PREFIX', 'aby/mov/');
environment = setEnv(environment, 'ABY_SOURCE_AUDIO_PREFIX', 'ref/');
environment = setEnv(environment, 'ABY_SOURCE_VIDEO_PREFIX', 'mov/');
environment = setEnv(environment, 'ABY_INGEST_MAX_SOURCE_BYTES', '1073741824');
environment = setEnv(environment, 'MUSICBRAINZ_BASE_URL', 'https://musicbrainz.org/ws/2');
environment = setEnv(environment, 'COVER_ART_ARCHIVE_BASE_URL', 'https://coverartarchive.org');
environment = setEnv(environment, 'ABY_EXTERNAL_METADATA_CONTACT', 'https://aby.zztt.org');
environment = setEnv(environment, 'LOGTO_ISSUER_URL', `${endpoint}/oidc`);
environment = setEnv(environment, 'LOGTO_CLIENT_ID', application.id);
environment = setEnv(environment, 'LOGTO_CLIENT_SECRET', secret);
if (!/^AUTH_SECRET=.+$/m.test(environment)) environment = setEnv(environment, 'AUTH_SECRET', randomBytes(32).toString('hex'));
const temporaryPath = `${envPath}.logto-${process.pid}`;
await writeFile(temporaryPath, environment, { mode: 0o600 });
await rename(temporaryPath, envPath);
console.info(JSON.stringify({ status: 'configured', applicationId: application.id, type: application.type, redirectUri, postLogoutRedirectUri }));
