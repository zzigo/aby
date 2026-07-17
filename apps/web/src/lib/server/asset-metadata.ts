import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { CatalogItem } from '@zztt/aby-domain';
import { readConfig } from './config';
import { AbyError } from './errors';
import { fetchWikidataEntity } from './wikidata';
import {
  findAlbumArtwork,
  getAudioFingerprint,
  identifyWithMusicBrainz,
  identifyWithMusicBrainzRecordingId,
  lookupAcoustID
} from './musicbrainz';
import type { AbyRepository } from './repository';
import { downloadWasabiObject } from './storage';

export async function regenerateAssetMetadata(ownerId: string, assetId: string, repository: AbyRepository): Promise<CatalogItem> {
  const current = await repository.getCatalogItem(ownerId, assetId);
  if (!current) throw new AbyError('asset_not_found', 'Asset not found', 404);
  if (current.asset.provider === 'local-fixture') throw new AbyError('metadata_unavailable', 'External metadata is unavailable for the local fixture', 409);

  const config = readConfig();
  const directory = await mkdtemp(join(tmpdir(), 'aby-metadata-'));
  try {
    const localPath = join(directory, `source${extname(current.asset.objectKey).toLowerCase()}`);
    await downloadWasabiObject(current.asset.objectKey, localPath);
    let identification = null;
    const fingerprint = await getAudioFingerprint(localPath, config.FPCALC_PATH);
    if (fingerprint) {
      const acoustid = await lookupAcoustID(fingerprint.duration, fingerprint.fingerprint, config.ACOUSTID_CLIENT_API_KEY);
      const recordingId = acoustid?.results?.[0]?.recordings?.[0]?.id;
      if (recordingId) identification = await identifyWithMusicBrainzRecordingId(recordingId, current.asset.technicalMetadata.durationMs);
    }
    if (!identification) {
      identification = await identifyWithMusicBrainz({
        creator: current.creator ?? '',
        workTitle: current.recordingTitle,
        durationMs: current.asset.technicalMetadata.durationMs
      });
    }

    const creator = identification?.artistName || current.creator;
    const albumTitle = identification?.releaseTitle || current.albumTitle;
    const alternativeCover = !identification?.cover && creator && albumTitle
      ? await findAlbumArtwork({ creator, albumTitle })
      : null;
    const cover = identification?.cover ?? alternativeCover;
    const wikidata = creator ? await fetchWikidataEntity(creator) : null;

    const updated = await repository.updateCatalogItem(ownerId, assetId, {
      workTitle: current.workTitle,
      albumTitle: albumTitle ?? null,
      recordingTitle: identification?.recordingTitle || current.recordingTitle,
      trackNumber: current.trackNumber ?? null,
      creator: creator ?? null,
      date: current.asset.canonicalMetadata.date ?? null,
      releaseDate: identification?.releaseDate || current.releaseDate || null,
      label: identification?.label || current.label || null,
      catalogNumber: identification?.catalogNumber || current.asset.canonicalMetadata.catalogNumber || null
    });
    return repository.mergeCanonicalMetadata(ownerId, assetId, {
      ...(identification ? {
        identificationCandidates: [{
          authority: 'musicbrainz', entityType: 'recording', externalId: identification.recordingId,
          title: identification.recordingTitle, score: identification.score,
          canonicalUrl: `https://musicbrainz.org/recording/${identification.recordingId}`,
          metadata: identification
        }]
      } : {}),
      ...(cover ? {
        imageCandidates: [{
          authority: 'cover-art-archive', url: cover.url, kind: 'cover', exactRelease: cover.exactRelease,
          sourceId: cover.sourceId, provenance: { sourceRelease: cover.sourceRelease, fallback: cover.exactRelease ? 'exact-release' : 'release-group-search' }
        }]
      } : {}),
      ...(wikidata ? { wikidata } : {}),
      metadataRegeneratedAt: new Date().toISOString(),
      metadataRegeneratedFrom: updated.asset.checksumSha256
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
