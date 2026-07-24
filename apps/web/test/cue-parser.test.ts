import { expect, test } from 'bun:test';
import { parseCueContent } from '../src/lib/server/ingest';

test('parses a standard CUE sheet content', () => {
  const content = `
    PERFORMER "Hildegard von Bingen"
    TITLE "Canticles of Ecstasy"
    FILE "CDImage.ape" WAVE
      TRACK 01 AUDIO
        TITLE "O vis aeternitatis"
        PERFORMER "Sequentia"
        INDEX 01 00:00:00
      TRACK 02 AUDIO
        TITLE "Nunc aperuit nobis"
        INDEX 01 07:15:30
  `;
  const result = parseCueContent(content);
  expect(result.file).toBe('CDImage.ape');
  expect(result.title).toBe('Canticles of Ecstasy');
  expect(result.performer).toBe('Hildegard von Bingen');
  expect(result.tracks).toHaveLength(2);
  expect(result.tracks[0]).toEqual({
    trackNumber: 1,
    title: 'O vis aeternitatis',
    performer: 'Sequentia',
    startMs: 0
  });
  // 7 mins * 60 + 15 secs = 435 secs. 30 frames / 75 = 0.4 secs. 435.4 * 1000 = 435400
  expect(result.tracks[1]).toEqual({
    trackNumber: 2,
    title: 'Nunc aperuit nobis',
    startMs: 435400
  });
});
