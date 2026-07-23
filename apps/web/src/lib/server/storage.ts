import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, ListObjectsV2Command, type _Object } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Asset } from '@zztt/aby-domain';
import { AbyError } from './errors';
import { readConfig } from './config';

export function normalizeObjectKey(value: string): string {
  // Legacy Wasabi keys are byte-sensitive. Do not apply Unicode normalization here:
  // composed/decomposed forms can look identical while naming different S3 objects.
  return value.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
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

export function assertSupplementalObjectKey(value: string): string {
  const config = readConfig();
  const key = normalizeObjectKey(value);
  const prefixes = [config.sourceAudioPrefix, config.audioPrefix];
  if (!key || key.split('/').some((part) => !part || part === '.' || part === '..') || !prefixes.some((prefix) => key.startsWith(prefix))) {
    throw new AbyError('invalid_supplemental_key', `Supplemental source must remain below ${prefixes.join(' or ')}`, 400);
  }
  return key;
}

export function assertScoreObjectKey(value: string): string {
  const key = normalizeObjectKey(value);
  if (!key || key.split('/').some((part) => !part || part === '.' || part === '..') || !key.startsWith('libros/scores/')) {
    throw new AbyError('invalid_score_key', 'Score destination must remain below libros/scores/', 400);
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

export async function downloadWasabiSupplementalObject(objectKey: string, destinationPath: string): Promise<void> {
  const config = readConfig();
  const key = assertSupplementalObjectKey(objectKey);
  const response = await wasabiClient().send(new GetObjectCommand({
    Bucket: config.WASABI_BUCKET!, Key: toWasabiKey(key, config.wasabiRootPrefix)
  }));
  if (!(response.Body instanceof Readable)) throw new AbyError('supplemental_stream_unavailable', 'Wasabi did not return the supplemental file stream', 502);
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

export async function headWasabiObjectOrNull(objectKey: string) {
  return canonicalHeadOrNull(objectKey);
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

export async function copyWasabiCanonicalObject(sourceObjectKey: string, targetObjectKey: string) {
  const config = readConfig();
  const sourceKey = assertAbyObjectKey(sourceObjectKey, config.storagePrefix);
  const targetKey = assertAbyObjectKey(targetObjectKey, config.storagePrefix);
  const source = await headWasabiObject(sourceKey);
  const existing = await canonicalHeadOrNull(targetKey);
  if (existing) return { created: false, sourceObjectKey: sourceKey, targetObjectKey: targetKey, source, head: existing };
  const bucket = config.WASABI_BUCKET!;
  await wasabiClient().send(new CopyObjectCommand({
    Bucket: bucket,
    Key: toWasabiKey(targetKey, config.wasabiRootPrefix),
    CopySource: encodeURIComponent(`${bucket}/${toWasabiKey(sourceKey, config.wasabiRootPrefix)}`),
    MetadataDirective: 'COPY'
  }));
  const head = await headWasabiObject(targetKey);
  return { created: true, sourceObjectKey: sourceKey, targetObjectKey: targetKey, source, head };
}

export async function copyWasabiSupplementalObject(sourceObjectKey: string, targetObjectKey: string, overwrite = false) {
  const config = readConfig();
  const sourceKey = assertSupplementalObjectKey(sourceObjectKey);
  const targetKey = targetObjectKey.startsWith('libros/scores/')
    ? assertScoreObjectKey(targetObjectKey)
    : assertAbyObjectKey(targetObjectKey, config.audioPrefix);
  const bucket = config.WASABI_BUCKET!;
  const physicalTarget = toWasabiKey(targetKey, config.wasabiRootPrefix);
  let exists = false;
  try {
    await wasabiClient().send(new HeadObjectCommand({ Bucket: bucket, Key: physicalTarget }));
    exists = true;
  } catch (error) {
    if (!(typeof error === 'object' && error && '$metadata' in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)) throw error;
  }
  if (!exists || overwrite) {
    await wasabiClient().send(new CopyObjectCommand({
      Bucket: bucket,
      Key: physicalTarget,
      CopySource: encodeURIComponent(`${bucket}/${toWasabiKey(sourceKey, config.wasabiRootPrefix)}`),
      MetadataDirective: 'COPY'
    }));
  }
  return { created: !exists, overwritten: exists && overwrite, sourceObjectKey: sourceKey, targetObjectKey: targetKey };
}

export async function deleteWasabiCanonicalObject(objectKey: string): Promise<void> {
  const config = readConfig();
  const key = assertAbyObjectKey(objectKey, config.storagePrefix);
  await wasabiClient().send(new DeleteObjectCommand({
    Bucket: config.WASABI_BUCKET!,
    Key: toWasabiKey(key, config.wasabiRootPrefix)
  }));
}

function assertRelocationObjectKey(value: string): string {
  const config = readConfig();
  const key = normalizeObjectKey(value);
  const prefixes = [config.storagePrefix, config.sourceAudioPrefix, config.sourceVideoPrefix];
  if (!key || key.split('/').some((part) => !part || part === '.' || part === '..') || !prefixes.some((prefix) => key.startsWith(prefix))) {
    throw new AbyError('invalid_relocation_key', 'Relocation objects must remain inside an Aby source or canonical boundary', 400);
  }
  return key;
}

export async function checksumWasabiRelocationObject(objectKey: string): Promise<{ checksumSha256: string; sizeBytes: number }> {
  const config = readConfig();
  const key = assertRelocationObjectKey(objectKey);
  const response = await wasabiClient().send(new GetObjectCommand({
    Bucket: config.WASABI_BUCKET!,
    Key: toWasabiKey(key, config.wasabiRootPrefix)
  }));
  if (!(response.Body instanceof Readable)) {
    throw new AbyError('relocation_stream_unavailable', 'Wasabi did not return a readable relocation stream', 502);
  }
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of response.Body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    sizeBytes += bytes.byteLength;
  }
  return { checksumSha256: hash.digest('hex'), sizeBytes };
}

export async function deleteWasabiRelocationSource(objectKey: string): Promise<void> {
  const config = readConfig();
  const key = assertRelocationObjectKey(objectKey);
  await wasabiClient().send(new DeleteObjectCommand({
    Bucket: config.WASABI_BUCKET!,
    Key: toWasabiKey(key, config.wasabiRootPrefix)
  }));
}

export async function uploadWasabiArtifact(objectKey: string, localPath: string, contentType: string): Promise<void> {
  const config = readConfig();
  const key = assertAbyObjectKey(objectKey, config.storagePrefix);
  const file = await stat(localPath);
  await wasabiClient().send(new PutObjectCommand({
    Bucket: config.WASABI_BUCKET!,
    Key: toWasabiKey(key, config.wasabiRootPrefix),
    Body: createReadStream(localPath),
    ContentLength: file.size,
    ContentType: contentType,
    Metadata: { derived: 'true' }
  }));
}

export async function artifactUrl(objectKey: string, contentType: string): Promise<{ url: string; expiresAt: string }> {
  const config = readConfig();
  const key = assertAbyObjectKey(objectKey, config.storagePrefix);
  const expiresIn = config.ABY_PRESIGNED_URL_TTL_SECONDS;
  const url = await getSignedUrl(wasabiClient(), new GetObjectCommand({
    Bucket: config.WASABI_BUCKET!,
    Key: toWasabiKey(key, config.wasabiRootPrefix),
    ResponseContentType: contentType,
    ResponseContentDisposition: 'inline'
  }), { expiresIn });
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
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

export async function sourceVideoPlaybackUrl(objectKey: string): Promise<{ url: string; expiresAt: string }> {
  const config = readConfig();
  const key = assertSourceObjectKey(objectKey, [config.sourceVideoPrefix]);
  const expiresIn = config.ABY_PRESIGNED_URL_TTL_SECONDS;
  const url = await getSignedUrl(wasabiClient(), new GetObjectCommand({
    Bucket: config.WASABI_BUCKET!,
    Key: toWasabiKey(key, config.wasabiRootPrefix),
    ResponseContentDisposition: `inline; filename="${key.split('/').at(-1)?.replace(/["\r\n]/g, '_') ?? 'video'}"`
  }), { expiresIn });
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

export async function supplementalArtifactUrl(objectKey: string, contentType?: string): Promise<{ url: string; expiresAt: string }> {
  const config = readConfig();
  const key = assertSupplementalObjectKey(objectKey);
  const expiresIn = config.ABY_PRESIGNED_URL_TTL_SECONDS;
  const url = await getSignedUrl(wasabiClient(), new GetObjectCommand({
    Bucket: config.WASABI_BUCKET!,
    Key: toWasabiKey(key, config.wasabiRootPrefix),
    ...(contentType ? { ResponseContentType: contentType } : {}),
    ResponseContentDisposition: `inline; filename="${key.split('/').at(-1)?.replace(/["\r\n]/g, '_') ?? 'supplement'}"`
  }), { expiresIn });
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

export async function listWasabiSourceKeys(): Promise<string[]> {
  const config = readConfig();
  const bucket = config.WASABI_BUCKET!;
  const root = config.wasabiRootPrefix ? normalizeObjectKey(config.wasabiRootPrefix).replace(/\/+$/, '') + '/' : '';
  const keys: string[] = [];

  for (const prefix of [config.sourceAudioPrefix, config.sourceVideoPrefix]) {
    const physicalPrefix = `${root}${prefix}`;
    let continuationToken: string | undefined;
    do {
      const response = await wasabiClient().send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: physicalPrefix,
        ContinuationToken: continuationToken
      }));

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (!obj.Key || obj.Key.endsWith('/')) continue;
          const ext = extname(obj.Key).toLowerCase();
          if (!['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.mp4', '.mov', '.mkv', '.vob', '.m4v', '.avi', '.webm'].includes(ext)) continue;
          let logicalKey = obj.Key;
          if (root && logicalKey.startsWith(root)) logicalKey = logicalKey.substring(root.length);
          keys.push(logicalKey);
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  return keys;
}

export async function listWasabiSiblingKeys(objectKey: string): Promise<string[]> {
  const config = readConfig();
  const bucket = config.WASABI_BUCKET!;
  const root = config.wasabiRootPrefix ? normalizeObjectKey(config.wasabiRootPrefix).replace(/\/+$/, '') + '/' : '';
  
  const key = normalizeObjectKey(objectKey);
  const lastSlash = key.lastIndexOf('/');
  const dir = lastSlash !== -1 ? key.substring(0, lastSlash) : '';
  const physicalPrefix = `${root}${dir}/`;
  
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await wasabiClient().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: physicalPrefix,
      ContinuationToken: continuationToken
    }));
    if (response.Contents) {
      for (const obj of response.Contents) {
        if (!obj.Key || obj.Key.endsWith('/')) continue;
        const ext = extname(obj.Key).toLowerCase();
        if (!['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.mp4', '.mov', '.mkv', '.vob', '.m4v', '.avi', '.webm'].includes(ext)) continue;
        let logicalKey = obj.Key;
        if (root && logicalKey.startsWith(root)) logicalKey = logicalKey.substring(root.length);
        if (dirname(logicalKey) !== dir) continue;
        keys.push(logicalKey);
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export async function listWasabiSupplementalFiles(objectKey: string, parentLevel = 0): Promise<Array<{
  objectKey: string; sizeBytes: number; contentType: string; modifiedAt?: string;
}>> {
  const config = readConfig();
  const anchor = assertSupplementalObjectKey(objectKey);
  let directory = dirname(anchor);
  for (let level = 0; level < parentLevel; level += 1) {
    const next = dirname(directory);
    if (next === '.' || next === directory || !(`${next}/`).startsWith(config.sourceAudioPrefix) && !(`${next}/`).startsWith(config.audioPrefix)) {
      throw new AbyError('supplemental_parent_outside_boundary', 'Cannot browse above the audio source boundary', 400);
    }
    directory = next;
  }
  const root = config.wasabiRootPrefix ? normalizeObjectKey(config.wasabiRootPrefix).replace(/\/+$/, '') + '/' : '';
  const objects: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await wasabiClient().send(new ListObjectsV2Command({
      Bucket: config.WASABI_BUCKET!, Prefix: `${root}${directory}/`, ContinuationToken: continuationToken
    }));
    objects.push(...(response.Contents ?? []));
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  const contentTypes: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.tif': 'image/tiff', '.tiff': 'image/tiff', '.pdf': 'application/pdf', '.eps': 'application/postscript'
  };
  return objects.flatMap((object) => {
    if (!object.Key || object.Key.endsWith('/')) return [];
    const logicalKey = root && object.Key.startsWith(root) ? object.Key.slice(root.length) : object.Key;
    if (dirname(logicalKey) !== directory || logicalKey === anchor) return [];
    const contentType = contentTypes[extname(logicalKey).toLocaleLowerCase()];
    if (!contentType) return [];
    return [{
      objectKey: logicalKey,
      sizeBytes: Number(object.Size ?? 0),
      contentType,
      ...(object.LastModified ? { modifiedAt: object.LastModified.toISOString() } : {})
    }];
  }).sort((left, right) => left.objectKey.localeCompare(right.objectKey, undefined, { numeric: true }));
}

export async function listWasabiSidecarSubtitles(objectKey: string): Promise<Array<{ objectKey: string; sizeBytes: number }>> {
  const config = readConfig();
  const bucket = config.WASABI_BUCKET!;
  const root = config.wasabiRootPrefix ? normalizeObjectKey(config.wasabiRootPrefix).replace(/\/+$/, '') + '/' : '';
  const videoKey = assertSourceObjectKey(objectKey, [config.sourceVideoPrefix]);
  const dir = dirname(videoKey);
  const videoStem = videoKey.split('/').at(-1)!.replace(/\.[^.]+$/, '').toLocaleLowerCase();
  const response = await wasabiClient().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${root}${dir}/` }));
  return (response.Contents ?? []).flatMap((object) => {
    if (!object.Key || extname(object.Key).toLocaleLowerCase() !== '.srt') return [];
    const logicalKey = root && object.Key.startsWith(root) ? object.Key.slice(root.length) : object.Key;
    if (dirname(logicalKey) !== dir) return [];
    const subtitleStem = logicalKey.split('/').at(-1)!.replace(/\.srt$/i, '').toLocaleLowerCase();
    if (subtitleStem !== videoStem && !subtitleStem.startsWith(`${videoStem}.`) && !subtitleStem.startsWith(`${videoStem}-`) && !subtitleStem.startsWith(`${videoStem}_`)) return [];
    return [{ objectKey: logicalKey, sizeBytes: Number(object.Size ?? 0) }];
  }).sort((left, right) => left.objectKey.localeCompare(right.objectKey, undefined, { numeric: true }));
}
