export interface SourceRecord {
  objectKey: string;
  mediaKind: 'aud' | 'mov';
  collectionCode: string;
  entitySlug: string;
  creatorDisplay: string;
  workTitle: string;
  recordingTitle: string;
}

interface SourcePrefixes {
  sourceAudioPrefix: string;
}

function collectionCodeFor(parts: string[], mediaKind: 'aud' | 'mov') {
  let collectionCode = mediaKind === 'aud' ? '20L' : '20ELE';
  for (const part of parts) {
    const normalized = part.toLowerCase().trim();
    if (/^\d{2}$/.test(normalized)) collectionCode = normalized;
    else if (normalized.includes('late') || normalized === '20l') collectionCode = '20L';
    else if (normalized.includes('early') || normalized === '20e') collectionCode = '20E';
    else if (normalized.includes('lat') || normalized.includes('latin')) collectionCode = '20LAT';
    else if (normalized.includes('ele') || normalized.includes('electro')) collectionCode = '20ELE';
    else if (normalized.includes('pop')) collectionCode = 'pop';
    else if (normalized.includes('tec') || normalized.includes('techno')) collectionCode = 'tec';
    else if (normalized.includes('ens') || normalized.includes('ensemble')) collectionCode = 'ens';
  }
  return collectionCode;
}

function isCollectionFolder(name: string) {
  const normalized = name.toLowerCase().trim();
  return /^\d{2}$/.test(normalized) || normalized.includes('late') || normalized.includes('early')
    || normalized.includes('lat') || normalized.includes('ele') || normalized.includes('pop')
    || normalized.includes('tec') || normalized.includes('ens') || normalized.includes('impro')
    || normalized === '20l' || normalized === '20e';
}

function artistFromAlbumFolder(folder: string) {
  const match = folder.match(/^(.+?)\s+[-–—]\s+(.+)$/u);
  return match?.[1]?.trim() || null;
}

export function sourceRecord(key: string, config: SourcePrefixes): SourceRecord {
  const parts = key.split('/').filter(Boolean);
  const mediaKind = key.startsWith(config.sourceAudioPrefix) ? 'aud' : 'mov';
  const filename = parts.at(-1) ?? '';
  const filenameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  const folders = parts.slice(1, -1);
  const parentFolder = folders.at(-1) ?? '';
  const grandparentFolder = folders.at(-2) ?? '';
  let creatorDisplay = 'Unknown Artist';
  let workTitle = filenameWithoutExt || 'Untitled Work';
  const recordingTitle = filenameWithoutExt || 'Unspecified Session';

  if (parentFolder) {
    if (grandparentFolder && !isCollectionFolder(grandparentFolder)) {
      creatorDisplay = grandparentFolder;
      workTitle = parentFolder;
    } else {
      creatorDisplay = artistFromAlbumFolder(parentFolder) ?? parentFolder;
      workTitle = artistFromAlbumFolder(parentFolder) ? parentFolder : workTitle;
    }
  }

  const entitySlug = creatorDisplay.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown';
  return {
    objectKey: key,
    mediaKind,
    collectionCode: collectionCodeFor(folders, mediaKind),
    entitySlug,
    creatorDisplay,
    workTitle,
    recordingTitle
  };
}
