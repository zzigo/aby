import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

export function toWasabiKey(logicalObjectKey: string, rootPrefix = ''): string {
  const key = normalizeObjectKey(logicalObjectKey);
  const root = rootPrefix ? normalizeObjectKey(rootPrefix).replace(/\/+$/, '') + '/' : '';
  return `${root}${key}`;
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
  const response = await wasabiClient().send(new HeadObjectCommand({ Bucket: config.WASABI_BUCKET!, Key: toWasabiKey(key, config.wasabiRootPrefix) }));
  return { objectKey: key, sizeBytes: response.ContentLength, contentType: response.ContentType, etag: response.ETag };
}

export async function headWasabiSourceObject(objectKey: string) {
  const config = readConfig();
  const key = assertSourceObjectKey(objectKey, [config.sourceAudioPrefix, config.sourceVideoPrefix]);
  const response = await wasabiClient().send(new HeadObjectCommand({ Bucket: config.WASABI_BUCKET!, Key: toWasabiKey(key, config.wasabiRootPrefix) }));
  return { objectKey: key, sizeBytes: response.ContentLength, contentType: response.ContentType, etag: response.ETag };
}

export async function downloadWasabiSourceObject(objectKey: string, destinationPath: string): Promise<void> {
  const config = readConfig();
  const key = assertSourceObjectKey(objectKey, [config.sourceAudioPrefix, config.sourceVideoPrefix]);
  const response = await wasabiClient().send(new GetObjectCommand({ Bucket: config.WASABI_BUCKET!, Key: toWasabiKey(key, config.wasabiRootPrefix) }));
  if (!(response.Body instanceof Readable)) {
    throw new AbyError('source_stream_unavailable', 'Wasabi did not return a readable source stream', 502);
  }
  await pipeline(response.Body, createWriteStream(destinationPath, { flags: 'wx' }));
}

export async function downloadWasabiObject(objectKey: string, destinationPath: string): Promise<void> {
  const config = readConfig();
  const key = assertAbyObjectKey(objectKey, config.storagePrefix);
  const response = await wasabiClient().send(new GetObjectCommand({
    Bucket: config.WASABI_BUCKET!,
    Key: toWasabiKey(key, config.wasabiRootPrefix)
  }));
  if (!(response.Body instanceof Readable)) {
    throw new AbyError('canonical_stream_unavailable', 'Wasabi did not return a readable canonical stream', 502);
  }
  await pipeline(response.Body, createWriteStream(destinationPath, { flags: 'wx' }));
}

async function canonicalHeadOrNull(objectKey: string) {
  try {
    return await headWasabiObject(objectKey);
  } catch (error) {
    if (typeof error === 'object' && error && '$metadata' in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function copyWasabiSourceToCanonical(sourceObjectKey: string, targetObjectKey: string) {
  const config = readConfig();
  const sourceKey = assertSourceObjectKey(sourceObjectKey, [config.sourceAudioPrefix, config.sourceVideoPrefix]);
  const targetKey = assertAbyObjectKey(targetObjectKey, config.storagePrefix);
  const existing = await canonicalHeadOrNull(targetKey);
  if (existing) return { created: false, sourceObjectKey: sourceKey, targetObjectKey: targetKey, head: existing };
  const bucket = config.WASABI_BUCKET!;
  const physicalSource = toWasabiKey(sourceKey, config.wasabiRootPrefix);
  await wasabiClient().send(new CopyObjectCommand({
    Bucket: bucket,
    Key: toWasabiKey(targetKey, config.wasabiRootPrefix),
    CopySource: encodeURIComponent(`${bucket}/${physicalSource}`),
    MetadataDirective: 'COPY'
  }));
  const head = await headWasabiObject(targetKey);
  return { created: true, sourceObjectKey: sourceKey, targetObjectKey: targetKey, head };
}

export async function deleteWasabiCanonicalObject(objectKey: string): Promise<void> {
  const config = readConfig();
  const key = assertAbyObjectKey(objectKey, config.storagePrefix);
  await wasabiClient().send(new DeleteObjectCommand({
    Bucket: config.WASABI_BUCKET!,
    Key: toWasabiKey(key, config.wasabiRootPrefix)
  }));
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
    Bucket: asset.bucket || config.WASABI_BUCKET!, Key: toWasabiKey(key, config.wasabiRootPrefix),
    ResponseContentDisposition: `inline; filename="${asset.originalFilename.replace(/["\r\n]/g, '_')}"`
  }), { expiresIn });
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}
