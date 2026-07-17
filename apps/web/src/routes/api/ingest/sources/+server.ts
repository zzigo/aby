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
    let entitySlug = 'unknown';
    let workTitle = 'Untitled Work';
    let recordingTitle = 'Unspecified Session';

    if (parts.length >= 4) {
      const colPart = parts[1].toLowerCase();
      if (colPart.includes('late') || colPart === '20l') collectionCode = '20L';
      else if (colPart.includes('early') || colPart === '20e') collectionCode = '20E';
      else if (colPart.includes('lat') || colPart.includes('latin')) collectionCode = '20LAT';
      else if (colPart.includes('ele') || colPart.includes('electro')) collectionCode = '20ELE';
      else if (colPart.includes('pop')) collectionCode = 'pop';
      else if (colPart.includes('tec') || colPart.includes('techno')) collectionCode = 'tec';
      else if (colPart.includes('ens') || colPart.includes('ensemble')) collectionCode = 'ens';

      creatorDisplay = parts[2];
      entitySlug = creatorDisplay.normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');

      workTitle = parts[3];
      if (parts.length >= 5) {
        recordingTitle = parts[4].replace(/\.[^/.]+$/, "");
      }
    } else if (parts.length === 3) {
      creatorDisplay = parts[1];
      entitySlug = creatorDisplay.normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
      workTitle = parts[2].replace(/\.[^/.]+$/, "");
    } else {
      workTitle = parts[parts.length - 1].replace(/\.[^/.]+$/, "");
    }

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
