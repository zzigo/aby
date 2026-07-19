import pg from 'pg';
import { getDiscogsRelease, parseDiscogsDuration } from '../src/lib/server/discogs';
import { mergeImageCandidates } from '../src/lib/server/image-candidates';

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const albumId = argument('album');
const parentReleaseId = argument('parent');
const position = argument('position');
const apply = process.argv.includes('--apply');

if (!albumId || !parentReleaseId || !position) {
  throw new Error('Use --album=<uuid> --parent=<Discogs release ID> --position=<CD25> [--apply]');
}

const parent = await getDiscogsRelease(parentReleaseId);
const member = parent.tracklist?.find((track) => track.position?.toLowerCase() === position.toLowerCase());
if (!member) throw new Error(`${position} is not present in Discogs release ${parentReleaseId}`);
const release = member.externalId ? await getDiscogsRelease(member.externalId) : parent;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const current = await pool.query(
  `SELECT al.id,al.owner_id,al.title,al.metadata,
    COALESCE(jsonb_agg(jsonb_build_object('canonicalMetadata',a.canonical_metadata,'technicalMetadata',a.technical_metadata))
      FILTER (WHERE a.id IS NOT NULL),'[]'::jsonb) AS assets
   FROM aby.albums al
   LEFT JOIN aby.recordings r ON r.album_id=al.id AND r.owner_id=al.owner_id
   LEFT JOIN aby.assets a ON a.recording_id=r.id AND a.owner_id=al.owner_id AND a.state='active'
   WHERE al.id=$1 GROUP BY al.id`,
  [albumId]
);
const album = current.rows[0];
if (!album) throw new Error(`Album ${albumId} was not found`);

const declaredTotal = parent.formats?.find((format) => format.name.toLowerCase() === 'cd')?.quantity;
const totalDiscs = declaredTotal && /^\d+$/.test(declaredTotal)
  ? Number(declaredTotal)
  : parent.tracklist?.filter((track) => /^CD\d+$/i.test(track.position ?? '')).length;
const discNumber = Number(position.match(/\d+/)?.[0]);
const albumSet = {
  title: parent.title,
  position: member.position ?? position,
  ...(discNumber ? { discNumber } : {}),
  ...(totalDiscs ? { totalDiscs } : {}),
  authority: 'discogs',
  externalId: parent.id,
  canonicalUrl: parent.canonicalUrl,
  ...(release.id !== parent.id ? { memberExternalId: release.id, memberCanonicalUrl: release.canonicalUrl } : {})
};
const localDurationMs = (album.assets as Array<{ technicalMetadata?: { durationMs?: number } }>)
  .reduce((total, asset) => total + Number(asset.technicalMetadata?.durationMs ?? 0), 0);
const memberDurationMs = member.duration ? parseDiscogsDuration(member.duration) : undefined;
const existingImages = (album.assets[0]?.canonicalMetadata?.imageCandidates ?? []) as Array<any>;
const selectedCover = release.coverUrl ? release : parent;
const imageCandidates = selectedCover.coverUrl ? mergeImageCandidates([{
  authority: 'discogs', url: selectedCover.coverUrl, kind: 'cover', exactRelease: true,
  sourceId: selectedCover.id, provenance: { canonicalUrl: selectedCover.canonicalUrl }
}], existingImages.filter((candidate) => candidate.authority !== 'discogs')) : existingImages;
const fetchedAt = new Date().toISOString();
const metadataSources = [release, ...(release.id !== parent.id ? [parent] : [])].map((source) => ({
  authority: 'discogs', externalId: source.id, canonicalUrl: source.canonicalUrl,
  fetchedAt, reviewState: 'accepted'
}));
const metadata = {
  albumArtist: release.creator,
  releaseDate: release.releaseDate || release.year || null,
  label: release.label || null,
  catalogNumber: release.catalogNumber || null,
  albumDurationMs: release.durationMs ?? memberDurationMs ?? localDurationMs,
  albumTags: release.styles ?? [],
  genres: release.genres ?? [],
  styles: release.styles ?? [],
  roles: (release.credits ?? []).map((credit) => ({ ...credit, authority: 'discogs' })),
  albumSet,
  discogs: release,
  imageCandidates,
  metadataSources,
  discogsRefreshedAt: fetchedAt
};
const proposedTitle = release.id === parent.id ? member.title : release.title;

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview', albumId, currentTitle: album.title, proposedTitle,
  set: albumSet, assetCount: album.assets.length, durationMs: metadata.albumDurationMs
}, null, 2));

if (apply) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE aby.albums SET title=$1,metadata=jsonb_strip_nulls(metadata || $2::jsonb),updated_at=now()
       WHERE id=$3 AND owner_id=$4`,
      [proposedTitle, metadata, albumId, album.owner_id]
    );
    await client.query(
      `UPDATE aby.recordings SET metadata=jsonb_strip_nulls(metadata || $1::jsonb),updated_at=now()
       WHERE album_id=$2 AND owner_id=$3`,
      [{ releaseDate: metadata.releaseDate, label: metadata.label, catalogNumber: metadata.catalogNumber }, albumId, album.owner_id]
    );
    await client.query(
      `UPDATE aby.assets a SET canonical_metadata=jsonb_strip_nulls(a.canonical_metadata || $1::jsonb),updated_at=now()
       FROM aby.recordings r WHERE a.recording_id=r.id AND r.album_id=$2 AND a.owner_id=$3`,
      [{ albumTitle: proposedTitle, ...metadata }, albumId, album.owner_id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

await pool.end();
