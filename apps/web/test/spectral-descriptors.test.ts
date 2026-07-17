import { describe, expect, test } from 'bun:test';
import {
  SpectralDescriptorAccumulator,
  calculateSpectralDescriptors,
  summarizeSpectralObservations,
  type SpectralFrameObservation
} from '../src/lib/server/spectral-descriptors';

const noSmoothing = {
  energy: 0,
  brightness: 0,
  motion: 0,
  gravity: 0,
  tension: 0
} as const;

describe('server-side spectral descriptors', () => {
  test('summarizes ffmpeg-style observations with stable physical reference ranges', () => {
    const summary = summarizeSpectralObservations([
      {
        rmsDb: -36,
        centroidHz: 12_000,
        flux: 1,
        rolloffHz: 12_000,
        spreadHz: 0,
        nyquistHz: 24_000
      }
    ]);

    expect(summary).toEqual({
      energy: 0.5,
      brightness: 0.5,
      motion: 0.5,
      gravity: 0.5,
      tension: 0.5
    });
  });

  test('ignores observations without a usable Nyquist reference', () => {
    expect(summarizeSpectralObservations([
      { rmsDb: 0, centroidHz: 1, flux: 1, rolloffHz: 1, spreadHz: 1, nyquistHz: 0 },
      { rmsDb: 0, centroidHz: 1, flux: 1, rolloffHz: 1, spreadHz: 1, nyquistHz: Number.NaN }
    ])).toEqual({ energy: 0, brightness: 0, motion: 0, gravity: 0, tension: 0 });
  });

  test('ports the relative energy, brightness, motion, gravity and tension curves', () => {
    const observations: SpectralFrameObservation[] = [
      { rms: 0, centroid: 0.2, flux: 0, lowFrequencyRatio: 0.9 },
      { rms: 1, centroid: 0.4, flux: 1, lowFrequencyRatio: 0.5 },
      { rms: 2, centroid: 0.6, flux: 0, lowFrequencyRatio: 0.1 }
    ];

    const result = calculateSpectralDescriptors(observations, { smoothing: noSmoothing });

    expect(result.frameCount).toBe(3);
    expect(result.energy).toEqual([0, 0.5, 1]);
    expect(result.brightness).toEqual([0, 0.5, 1]);
    expect(result.motion).toEqual([0, 1, 0]);
    expect(result.gravity).toEqual([1, 0.5, 0]);
    expect(result.tension).toEqual([0, 1, 0.8387]);
    expect(result.summary).toEqual({
      energy: 0.5,
      brightness: 0.5,
      motion: 0.3333,
      gravity: 0.5,
      tension: 0.6129
    });
  });

  test('accepts incremental frames and matches array processing with deterministic resampling', () => {
    const observations: SpectralFrameObservation[] = [
      { rms: 0.1, centroid: 0.1, flux: 0, lowFrequencyRatio: 0.8 },
      { rms: 0.2, centroid: 0.3, flux: 0.2, lowFrequencyRatio: 0.6 },
      { rms: 0.6, centroid: 0.9, flux: 0.7, lowFrequencyRatio: 0.2 },
      { rms: 0.4, centroid: 0.5, flux: 0.1, lowFrequencyRatio: 0.4 }
    ];
    const options = { targetPointCount: 7, smoothing: noSmoothing };
    const accumulator = new SpectralDescriptorAccumulator();
    for (const observation of observations) accumulator.add(observation);

    const streamed = accumulator.finalize(options);
    const fromArray = calculateSpectralDescriptors(observations, options);

    expect(streamed).toEqual(fromArray);
    expect(streamed.frameCount).toBe(4);
    expect(streamed.energy).toHaveLength(7);
    expect(streamed.energy[0]).toBe(0);
    expect(streamed.energy.at(-1)).toBe(0.6);
  });

  test('keeps every returned descriptor finite and bounded for malformed analyzer values', () => {
    const result = calculateSpectralDescriptors([
      { rms: Number.NaN, centroid: -2, flux: -1, lowFrequencyRatio: 4 },
      { rms: Number.POSITIVE_INFINITY, centroid: 2, flux: Number.NaN, lowFrequencyRatio: -1 },
      { rms: 1, centroid: 0.5, flux: 2, lowFrequencyRatio: 0.5 }
    ], { smoothing: noSmoothing });

    for (const name of ['energy', 'brightness', 'motion', 'gravity', 'tension'] as const) {
      expect(result[name].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
      expect(result.summary[name]).toBeGreaterThanOrEqual(0);
      expect(result.summary[name]).toBeLessThanOrEqual(1);
    }
  });

  test('represents a constant track neutrally and an empty track as empty', () => {
    const constant = calculateSpectralDescriptors(new Array<SpectralFrameObservation>(4).fill({
      rms: 0.2,
      centroid: 0.3,
      flux: 0,
      lowFrequencyRatio: 0.7
    }));
    expect(constant.energy).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(constant.brightness).toEqual(constant.energy);
    expect(constant.motion).toEqual(constant.energy);
    expect(constant.gravity).toEqual(constant.energy);
    expect(constant.tension).toEqual(constant.energy);
    expect(constant.summary).toEqual({
      energy: 0.5,
      brightness: 0.5,
      motion: 0.5,
      gravity: 0.5,
      tension: 0.5
    });

    expect(calculateSpectralDescriptors([])).toEqual({
      frameCount: 0,
      energy: [],
      brightness: [],
      motion: [],
      gravity: [],
      tension: [],
      summary: { energy: 0, brightness: 0, motion: 0, gravity: 0, tension: 0 }
    });
  });
});
