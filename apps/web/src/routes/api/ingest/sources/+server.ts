import { api } from '$lib/server/errors';
import { listWasabiSourceKeys } from '$lib/server/storage';
import { readConfig } from '$lib/server/config';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => api('ingest.sources', async () => {
  const config = readConfig();
  if (config.demoMode) {
    return {
      sources: [
        {
          objectKey: 'ref/20 late/Gavin Bryars/The Sinking of the Titanic/Sinking of the Titanic.mp3',
          mediaKind: 'aud',
          collectionCode: '20L',
          entitySlug: 'bryars',
          creatorDisplay: 'Gavin Bryars',
          workTitle: 'The Sinking of the Titanic',
          recordingTitle: 'Les Disques du Crépuscule'
        }
      ]
    };
  }

  const keys = await listWasabiSourceKeys();
  const sources = keys.map((key) => {
    const parts = key.split('/');
    const isAudio = key.startsWith(config.sourceAudioPrefix);
    const mediaKind = isAudio ? 'aud' : 'mov';
    
    let collectionCode = isAudio ? '20L' : '20ELE';
    let creatorDisplay = 'Unknown Artist';
    let workTitle = 'Untitled Work';
    let recordingTitle = 'Unspecified Session';

    // Collection detection from anywhere in parts
    for (const part of parts) {
      const n = part.toLowerCase();
      if (n.includes('late') || n === '20l') collectionCode = '20L';
      else if (n.includes('early') || n === '20e') collectionCode = '20E';
      else if (n.includes('lat') || n.includes('latin')) collectionCode = '20LAT';
      else if (n.includes('ele') || n.includes('electro')) collectionCode = '20ELE';
      else if (n.includes('pop')) collectionCode = 'pop';
      else if (n.includes('tec') || n.includes('techno')) collectionCode = 'tec';
      else if (n.includes('ens') || n.includes('ensemble')) collectionCode = 'ens';
    }

    const filename = parts[parts.length - 1];
    const filenameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    const parentFolder = parts.length >= 2 ? parts[parts.length - 2] : '';
    const grandparentFolder = parts.length >= 3 ? parts[parts.length - 3] : '';

    const isCollection = (name: string): boolean => {
      const n = name.toLowerCase();
      return n.includes('late') || n.includes('early') || n.includes('lat') || n.includes('ele') || n.includes('pop') || n.includes('tec') || n.includes('ens') || n === '20l' || n === '20e';
    };

    if (parentFolder && parentFolder !== 'ref' && parentFolder !== 'mov' && !isCollection(parentFolder)) {
      if (grandparentFolder && grandparentFolder !== 'ref' && grandparentFolder !== 'mov' && !isCollection(grandparentFolder)) {
        creatorDisplay = grandparentFolder;
        workTitle = parentFolder;
        recordingTitle = filenameWithoutExt;
      } else {
        creatorDisplay = parentFolder;
        workTitle = filenameWithoutExt;
        recordingTitle = filenameWithoutExt;
      }
    } else {
      workTitle = filenameWithoutExt;
      recordingTitle = filenameWithoutExt;
    }

    const entitySlug = creatorDisplay.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

    return {
      objectKey: key,
      mediaKind,
      collectionCode,
      entitySlug,
      creatorDisplay,
      workTitle,
      recordingTitle
    };
  });

  return { sources };
});
