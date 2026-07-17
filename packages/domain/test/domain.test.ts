import { describe, expect, test } from 'bun:test';
import { CollectionCodeSchema, EntitySlugSchema, JobContractSchema, SegmentCreateSchema } from '../src/index';

describe('segment invariants', () => {
  test('accepts a logical interval', () => {
    const segment = SegmentCreateSchema.parse({ assetId: crypto.randomUUID(), startTimeMs: 310, endTimeMs: 350 });
    expect(segment.channelSelection).toEqual([]);
  });

  test('rejects inverted time and oversized fades', () => {
    expect(SegmentCreateSchema.safeParse({ assetId: crypto.randomUUID(), startTimeMs: 400, endTimeMs: 300 }).success).toBe(false);
    expect(SegmentCreateSchema.safeParse({ assetId: crypto.randomUUID(), startTimeMs: 0, endTimeMs: 100, fadeInMs: 60, fadeOutMs: 60 }).success).toBe(false);
  });
});

test('analysis remains opt-in in job contracts', () => {
  const job = JobContractSchema.parse({
    id: crypto.randomUUID(), ownerId: 'user-1', type: 'asset.inspect', idempotencyKey: 'inspect:sha', payload: {}
  });
  expect(job.analyze).toBe(false);
});

test('catalog codes and entity slugs follow the Luciano-readable convention', () => {
  for (const code of ['20E', '20L', '20LAT', '20ELE', '21E', 'pop', 'tec', 'ens']) {
    expect(CollectionCodeSchema.parse(code)).toBe(code);
  }
  expect(EntitySlugSchema.parse('pinkfloyd')).toBe('pinkfloyd');
  expect(() => EntitySlugSchema.parse('Pink Floyd')).toThrow();
});
