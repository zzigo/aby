import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AbyError } from './errors';
import { readConfig } from './config';
import { getRepository, type SourceRetirementCandidate } from './repository';
import { assertSourceObjectKey, normalizeObjectKey } from './storage';

const execFileAsync = promisify(execFile);
const verificationMaxAgeMs = 24 * 60 * 60 * 1_000;

interface RcloneEntry {
  Path: string;
  Name: string;
  Size: number;
  IsDir: boolean;
  Hashes?: Record<string, string>;
}

export interface SourceRetirementFolder {
  folder: string;
  objectCount: number;
  sizeBytes: number;
  sizeComplete: boolean;
  canonicalCount: number;
  state: 'candidate' | 'blocked' | 'verified';
  checkedAt?: string;
  detail?: string;
}

export interface RetirementVerification {
  folder: string;
  verified: boolean;
  verificationId: string;
  checkedAt: string;
  objectCount: number;
  matchedCount: number;
  sizeBytes: number;
  untrackedObjects: string[];
  missingSourceObjects: string[];
  missingCanonicalObjects: string[];
  mismatchedObjects: string[];
}

function sourceFolder(objectKey: string): string {
  const key = assertSourceObjectKey(objectKey, [readConfig().sourceAudioPrefix, readConfig().sourceVideoPrefix]);
  const boundary = key.lastIndexOf('/');
  if (boundary <= 0) throw new AbyError('invalid_source_folder', 'Source candidate is not inside a deletable folder', 409);
  return key.slice(0, boundary);
}

function verificationFor(row: SourceRetirementCandidate) {
  const value = row.provenance.retirementVerification;
  if (!value || typeof value !== 'object') return undefined;
  const verificationId = typeof value.verificationId === 'string' ? value.verificationId : undefined;
  const checkedAt = typeof value.checkedAt === 'string' ? value.checkedAt : undefined;
  const folder = typeof value.folder === 'string' ? value.folder : undefined;
  return verificationId && checkedAt && folder ? { verificationId, checkedAt, folder } : undefined;
}

export function groupSourceRetirementCandidates(rows: SourceRetirementCandidate[]): SourceRetirementFolder[] {
  const groups = new Map<string, SourceRetirementCandidate[]>();
  for (const row of rows) {
    const folder = sourceFolder(row.sourceObjectKey);
    groups.set(folder, [...(groups.get(folder) ?? []), row]);
  }
  return [...groups.entries()].map(([folder, candidates]) => {
    const proofs = candidates.map(verificationFor);
    const firstProof = proofs[0];
    const proofCurrent = Boolean(
      firstProof &&
      Date.now() - new Date(firstProof.checkedAt).getTime() <= verificationMaxAgeMs &&
      proofs.every((proof) => proof?.verificationId === firstProof.verificationId && proof.folder === folder)
    );
    const missingCanonical = candidates.filter((candidate) => !candidate.canonicalAssetId).length;
    const verified = missingCanonical === 0 && proofCurrent && candidates.every((candidate) => candidate.state === 'approved');
    const knownSizes = candidates.filter((candidate) => candidate.canonicalSizeBytes !== undefined);
    return {
      folder,
      objectCount: candidates.length,
      sizeBytes: knownSizes.reduce((total, candidate) => total + candidate.canonicalSizeBytes!, 0),
      sizeComplete: knownSizes.length === candidates.length,
      canonicalCount: candidates.length - missingCanonical,
      state: verified ? 'verified' : missingCanonical ? 'blocked' : 'candidate',
      ...(proofCurrent && firstProof ? { checkedAt: firstProof.checkedAt } : {}),
      ...(missingCanonical ? { detail: `${missingCanonical} catalog mapping${missingCanonical === 1 ? '' : 's'} no longer resolve` } : {})
    };
  });
}

function remotePath(logicalPath: string): string {
  const config = readConfig();
  const root = config.RCLONE_WASABI_ROOT.replace(/\/+$/, '') + '/';
  return `${root}${normalizeObjectKey(logicalPath)}`;
}

async function rclone(args: string[]): Promise<string> {
  const config = readConfig();
  try {
    const result = await execFileAsync(config.RCLONE_PATH, args, {
      timeout: config.ABY_RCLONE_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8'
    });
    return result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AbyError('rclone_failed', `rclone could not complete the storage check: ${message}`, 502);
  }
}

async function lsjson(path: string): Promise<RcloneEntry[]> {
  const output = await rclone(['lsjson', path, '--recursive', '--files-only', '--hash']);
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new AbyError('rclone_invalid_output', 'rclone returned an invalid object list', 502);
  return parsed as RcloneEntry[];
}

function hash(entry: RcloneEntry, algorithm: 'md5' | 'sha256'): string | undefined {
  const hashes = entry.Hashes ?? {};
  const aliases = algorithm === 'md5' ? ['MD5', 'md5'] : ['SHA-256', 'SHA256', 'sha256'];
  for (const alias of aliases) {
    const value = hashes[alias]?.trim().toLowerCase();
    if (value) return value;
  }
  return undefined;
}

async function downloadedSha256(path: string): Promise<string> {
  const output = await rclone(['hashsum', 'SHA-256', path, '--download']);
  const found = output.match(/^([a-fA-F0-9]{64})\s/m)?.[1];
  if (!found) throw new AbyError('rclone_hash_missing', 'rclone could not calculate SHA-256 for an object', 502);
  return found.toLowerCase();
}

async function mapLimit<T, R>(values: T[], limit: number, callback: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await callback(values[index]);
    }
  }));
  return results;
}

function candidatesForFolder(rows: SourceRetirementCandidate[], folder: string) {
  const safeFolder = normalizeObjectKey(folder).replace(/\/$/, '');
  const candidates = rows.filter((row) => sourceFolder(row.sourceObjectKey) === safeFolder);
  if (!candidates.length) throw new AbyError('retirement_folder_not_found', 'This source folder is not in your retirement queue', 404);
  return { safeFolder, candidates };
}

export async function listSourceRetirementFolders(ownerId: string): Promise<SourceRetirementFolder[]> {
  return groupSourceRetirementCandidates(await getRepository().listSourceRetirementCandidates(ownerId));
}

export async function verifySourceRetirementFolder(ownerId: string, requestedFolder: string): Promise<RetirementVerification> {
  const repository = getRepository();
  const rows = await repository.listSourceRetirementCandidates(ownerId);
  const { safeFolder, candidates } = candidatesForFolder(rows, requestedFolder);
  const bucket = candidates[0].bucket;
  if (candidates.some((candidate) => candidate.bucket !== bucket)) {
    throw new AbyError('retirement_mixed_buckets', 'A source folder cannot span storage buckets', 409);
  }

  const sourceEntries = await lsjson(remotePath(safeFolder));
  const sourceByKey = new Map(sourceEntries.map((entry) => [
    `${safeFolder}/${normalizeObjectKey(entry.Path)}`,
    entry
  ]));
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.sourceObjectKey, candidate]));
  const untrackedObjects = [...sourceByKey.keys()].filter((key) => !candidateByKey.has(key));
  const missingSourceObjects = candidates.filter((candidate) => !sourceByKey.has(candidate.sourceObjectKey)).map((candidate) => candidate.sourceObjectKey);
  const missingCanonicalObjects = candidates.filter((candidate) => !candidate.canonicalAssetId).map((candidate) => candidate.canonicalObjectKey);

  const eligible = candidates.filter((candidate) => sourceByKey.has(candidate.sourceObjectKey) && candidate.canonicalAssetId);
  const comparisons = await mapLimit(eligible, 4, async (candidate) => {
    const source = sourceByKey.get(candidate.sourceObjectKey)!;
    const canonicalEntries = await lsjson(remotePath(candidate.canonicalObjectKey));
    const canonical = canonicalEntries[0];
    if (!canonical) return { candidate, matched: false, reason: `${candidate.sourceObjectKey} → canonical object missing` };
    if (source.Size !== canonical.Size) return { candidate, matched: false, reason: `${candidate.sourceObjectKey} → size mismatch` };

    let sourceHash = hash(source, 'md5');
    let canonicalHash = hash(canonical, 'md5');
    let algorithm = 'md5';
    if (!sourceHash || !canonicalHash) {
      algorithm = 'sha256';
      [sourceHash, canonicalHash] = await Promise.all([
        downloadedSha256(remotePath(candidate.sourceObjectKey)),
        downloadedSha256(remotePath(candidate.canonicalObjectKey))
      ]);
    }
    const matched = sourceHash === canonicalHash && (algorithm !== 'sha256' || sourceHash === candidate.checksumSha256);
    return {
      candidate,
      matched,
      reason: matched ? undefined : `${candidate.sourceObjectKey} → ${algorithm.toUpperCase()} mismatch`,
      proof: { algorithm, sourceHash, canonicalHash, sizeBytes: source.Size }
    };
  });

  const mismatchedObjects = comparisons.filter((comparison) => !comparison.matched).map((comparison) => comparison.reason!);
  const checkedAt = new Date().toISOString();
  const verificationId = randomUUID();
  const verified = sourceEntries.length > 0 && untrackedObjects.length === 0 && missingSourceObjects.length === 0 &&
    missingCanonicalObjects.length === 0 && mismatchedObjects.length === 0 && comparisons.length === candidates.length;

  if (verified) {
    await repository.approveSourceRetirementCandidates(ownerId, comparisons.map((comparison) => ({
      id: comparison.candidate.id,
      verification: {
        verificationId,
        checkedAt,
        folder: safeFolder,
        method: 'rclone-manifest-hash-v1',
        ...comparison.proof
      }
    })));
  }

  return {
    folder: safeFolder,
    verified,
    verificationId,
    checkedAt,
    objectCount: sourceEntries.length,
    matchedCount: comparisons.filter((comparison) => comparison.matched).length,
    sizeBytes: sourceEntries.reduce((total, entry) => total + entry.Size, 0),
    untrackedObjects: untrackedObjects.slice(0, 20),
    missingSourceObjects: missingSourceObjects.slice(0, 20),
    missingCanonicalObjects: missingCanonicalObjects.slice(0, 20),
    mismatchedObjects: mismatchedObjects.slice(0, 20)
  };
}

export async function deleteVerifiedSourceFolder(ownerId: string, requestedFolder: string) {
  const verification = await verifySourceRetirementFolder(ownerId, requestedFolder);
  if (!verification.verified) {
    throw new AbyError('retirement_verification_failed', 'The folder changed or did not pass its rclone preflight; nothing was deleted', 409);
  }

  const repository = getRepository();
  const rows = await repository.listSourceRetirementCandidates(ownerId);
  const { candidates } = candidatesForFolder(rows, verification.folder);
  let deletedBytes = 0;
  for (const candidate of candidates) {
    await rclone(['deletefile', remotePath(candidate.sourceObjectKey)]);
    deletedBytes += candidate.canonicalSizeBytes ?? 0;
    await repository.markSourceRetired(ownerId, candidate.id, {
      deletedAt: new Date().toISOString(),
      method: 'rclone-deletefile-v1',
      verificationId: verification.verificationId,
      canonicalObjectKey: candidate.canonicalObjectKey
    });
  }
  return { folder: verification.folder, deletedObjects: candidates.length, deletedBytes };
}
