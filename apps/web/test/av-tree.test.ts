import { describe, expect, test } from 'bun:test';
import { authorSurname, decadeFolder, proposeAvDestination } from '../src/lib/server/av-tree';

describe('AV tree proposals', () => {
  test('defaults author organization to explicit decade and lowercase surname', () => {
    expect(proposeAvDestination({
      sourceObjectKey: 'mov/Stalker 1979 Final.mkv',
      title: 'Stalker', year: 1979, strategy: 'author', treeValue: 'Andrei Tarkovsky'
    })).toBe('aby/mov/1970s/tarkovsky/1979 — Stalker/stalker-1979-final.mkv');
  });

  test('keeps saga and entity as explicit semantic branches', () => {
    expect(proposeAvDestination({
      sourceObjectKey: 'mov/Dune Part Two.mp4',
      title: 'Dune: Part Two', year: 2024, strategy: 'saga', treeValue: 'Dune'
    })).toBe('aby/mov/saga/dune/2024 — Dune: Part Two/dune-part-two.mp4');
  });

  test('normalizes diacritics only for structural slugs', () => {
    expect(authorSurname('Jan Švankmajer')).toBe('svankmajer');
    expect(decadeFolder(1928)).toBe('1920s');
  });
});
