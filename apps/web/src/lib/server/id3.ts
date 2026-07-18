import type { CatalogItem } from '@zztt/aby-domain';

const clean = (value: string) => value.replaceAll('\0', '').replace(/\r?\n/g, ' ').trim();

export interface Id3Values {
  title: string;
  album?: string;
  artist?: string;
  albumArtist?: string;
  track?: string;
  date?: string;
  genre?: string;
  composer?: string;
  involvedPeople?: string;
  abyTags?: string;
  abyStyles?: string;
  discogsReleaseId?: string;
}

export function id3Values(item: CatalogItem): Id3Values {
  const metadata = item.asset.canonicalMetadata;
  const roles = metadata.roles ?? [];
  const composers = roles
    .filter((credit) => /compos/i.test(credit.role))
    .map((credit) => credit.name);
  const involved = roles.map((credit) => `${credit.role}:${credit.name}${credit.tracks ? ` [${credit.tracks}]` : ''}`);
  return {
    title: clean(item.recordingTitle),
    ...(item.albumTitle ? { album: clean(item.albumTitle) } : {}),
    ...(item.creator ? { artist: clean(item.creator) } : {}),
    ...(item.albumArtist ? { albumArtist: clean(item.albumArtist) } : {}),
    ...(item.trackNumber ? { track: String(item.trackNumber) } : {}),
    ...(item.releaseDate ? { date: clean(item.releaseDate) } : {}),
    ...(metadata.genres?.length ? { genre: metadata.genres.map(clean).join('; ') } : {}),
    ...(composers.length ? { composer: [...new Set(composers.map(clean))].join('; ') } : {}),
    ...(involved.length ? { involvedPeople: involved.map(clean).join('; ') } : {}),
    ...(metadata.albumTags?.length ? { abyTags: metadata.albumTags.map(clean).join('; ') } : {}),
    ...(metadata.styles?.length ? { abyStyles: metadata.styles.map(clean).join('; ') } : {}),
    ...(metadata.discogs?.id ? { discogsReleaseId: metadata.discogs.id } : {})
  };
}

export function id3FfmpegArgs(inputPath: string, outputPath: string, values: Id3Values, coverPath?: string): string[] {
  const args = ['-y', '-i', inputPath];
  if (coverPath) args.push('-i', coverPath);
  args.push('-map_metadata', '-1', '-map', '0:a:0');
  if (coverPath) {
    args.push(
      '-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic',
      '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (Front)'
    );
  }
  args.push('-c:a', 'copy');
  const metadata: Array<[string, string | undefined]> = [
    ['title', values.title], ['album', values.album], ['artist', values.artist],
    ['album_artist', values.albumArtist], ['track', values.track], ['date', values.date],
    ['genre', values.genre], ['composer', values.composer], ['INVOLVED_PEOPLE', values.involvedPeople],
    ['ABY_TAGS', values.abyTags], ['ABY_STYLES', values.abyStyles],
    ['DISCOGS_RELEASE_ID', values.discogsReleaseId]
  ];
  for (const [key, value] of metadata) if (value) args.push('-metadata', `${key}=${value}`);
  args.push('-id3v2_version', '3', '-write_id3v1', '0', outputPath);
  return args;
}
