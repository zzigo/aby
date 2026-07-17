import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Asset } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { readConfig } from './config';

export function normalizeObjectKey(value: string): string {
  return value.normalize('NFC').replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

export function assertAbyObjectKey(value: string, prefix = 'aby/'): string {
  const key = normalizeObjectKey(value);
  if (!key || key.split('/').some((part) => !part || part === '.' || part === '..') || !key.startsWith(prefix)) {
    throw new AbyError('invalid_storage_key', `Object key must remain below ${prefix}`, 400);
  }
  return key;
}

export function assertSourceObjectKey(value: string, prefixes = ['ref/', 'mov/']): string {
  const key = normalizeObjectKey(value);
  if (!key || key.split('/').some((part) => !part || part === '.' || part === '..') || !prefixes.some((prefix) => key.startsWith(prefix))) {
    throw new AbyError('invalid_source_key', `Source object key must remain below ${prefixes.join(' or ')}`, 400);
  }
  return key;
}

let client: S3Client | undefined;

function wasabiClient(): S3Client {
  if (client) return client;
  const config = readConfig();
  if (!config.wasabiConfigured) throw new AbyError('wasabi_not_configured', 'Wasabi credentials are not configured for Aby', 503);
  client = new S3Client({
    endpoint: config.WASABI_ENDPOINT,
    region: config.WASABI_REGION,
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.WASABI_ACCESS_KEY_ID!,
      secretAccessKey: config.WASABI_SECRET_ACCESS_KEY!
    }
  });
  return client;
}

export async function headWasabiObject(objectKey: string) {
  const config = readConfig();
  const key = assertAbyObjectKey(objectKey, config.storagePrefix);
  const response = await wasabiClient().send(new HeadObjectCommand({ Bucket: config.WASABI_BUCKET!, Key: key }));
  return { objectKey: key, sizeBytes: response.ContentLength, contentType: response.ContentType, etag: response.ETag };
}

export async function headWasabiSourceObject(objectKey: string) {
  const config = readConfig();
  const key = assertSourceObjectKey(objectKey, [config.sourceAudioPrefix, config.sourceVideoPrefix]);
  const response = await wasabiClient().send(new HeadObjectCommand({ Bucket: config.WASABI_BUCKET!, Key: key }));
  return { objectKey: key, sizeBytes: response.ContentLength, contentType: response.ContentType, etag: response.ETag };
}

export async function downloadWasabiSourceObject(objectKey: string, destinationPath: string): Promise<void> {
  const config = readConfig();
  const key = assertSourceObjectKey(objectKey, [config.sourceAudioPrefix, config.sourceVideoPrefix]);
  const response = await wasabiClient().send(new GetObjectCommand({ Bucket: config.WASABI_BUCKET!, Key: key }));
  if (!(response.Body instanceof Readable)) {
    throw new AbyError('source_stream_unavailable', 'Wasabi did not return a readable source stream', 502);
  }
  await pipeline(response.Body, createWriteStream(destinationPath, { flags: 'wx' }));
}

export async function playbackUrl(asset: Asset): Promise<{ url: string; expiresAt: string }> {
  const config = readConfig();
  if (asset.provider === 'local-fixture') {
    if (!config.demoMode) throw new AbyError('fixture_disabled', 'Local fixtures are disabled', 403);
    return { url: '/demo/aby-phase-0.wav', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
  const key = assertAbyObjectKey(asset.objectKey, config.storagePrefix);
  const expiresIn = config.ABY_PRESIGNED_URL_TTL_SECONDS;
  const url = await getSignedUrl(wasabiClient(), new GetObjectCommand({
    Bucket: asset.bucket || config.WASABI_BUCKET!, Key: key,
    ResponseContentDisposition: `inline; filename="${asset.originalFilename.replace(/["\r\n]/g, '_')}"`
  }), { expiresIn });
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}
