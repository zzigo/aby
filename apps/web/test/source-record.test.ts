import { expect, test } from 'bun:test';
import { sourceRecord } from '../src/lib/server/source-record';

const config = { sourceAudioPrefix: 'ref/' };

test('reads creator and work from the classical hierarchy', () => {
  expect(sourceRecord('ref/20 late/Gavin Bryars/The Sinking of the Titanic/01 Sinking.mp3', config)).toMatchObject({
    mediaKind: 'aud', collectionCode: '20L', creatorDisplay: 'Gavin Bryars', entitySlug: 'gavinbryars',
    workTitle: 'The Sinking of the Titanic', recordingTitle: 'Sinking'
  });
});

test('extracts the creator from a collective album directly below Impro', () => {
  expect(sourceRecord('ref/Impro/axel dorner - sind (2007)/22 track 22.mp3', config)).toMatchObject({
    mediaKind: 'aud', collectionCode: '20L', creatorDisplay: 'axel dorner', entitySlug: 'axeldorner',
    workTitle: 'axel dorner - sind (2007)', recordingTitle: '22'
  });
});

test('preserves century folders as collection codes', () => {
  expect(sourceRecord('ref/19/Claude Debussy/La Mer/01 De l’aube.mp3', config).collectionCode).toBe('19');
});
