export type SpectralDescriptorName = 'energy' | 'brightness' | 'motion' | 'gravity' | 'tension';

/** Frame metadata shaped for ffmpeg's astats/aspectralstats output. */
export type SpectralObservation = {
  rmsDb: number;
  centroidHz: number;
  flux: number;
  rolloffHz: number;
  spreadHz: number;
  nyquistHz: number;
};

export type SpectralDescriptorSummary = Record<SpectralDescriptorName, number>;

/**
 * One already-decoded analysis frame. The caller may produce these values
 * incrementally (for example from ffmpeg metadata) without retaining PCM audio.
 */
export interface SpectralFrameObservation {
  /** Root-mean-square amplitude. */
  rms: number;
  /** Spectral centroid expressed as a ratio of Nyquist, normally 0..1. */
  centroid: number;
  /** Positive spectral flux. Its absolute scale may vary between analyzers. */
  flux: number;
  /** Share of spectral magnitude below the pipeline's low-frequency cutoff. */
  lowFrequencyRatio: number;
}

export interface SpectralDescriptorSeries {
  energy: number[];
  brightness: number[];
  motion: number[];
  gravity: number[];
  tension: number[];
}

export interface SpectralDescriptorResult extends SpectralDescriptorSeries {
  frameCount: number;
  summary: SpectralDescriptorSummary;
}

export interface SpectralDescriptorOptions {
  /** Optional number of uniformly resampled points in each returned curve. */
  targetPointCount?: number;
  /**
   * Centered moving-average radii, in analysis frames. Defaults preserve the
   * relative descriptor treatment from zzttp's spectrogram worker.
   */
  smoothing?: Partial<Record<SpectralDescriptorName, number>>;
}

const DEFAULT_SMOOTHING: Record<SpectralDescriptorName, number> = {
  energy: 10,
  brightness: 14,
  motion: 8,
  gravity: 14,
  tension: 8
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteRatio(value: number): number {
  return clamp(finiteNonNegative(value));
}

function smoothingRadius(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(0, Math.floor(value));
}

function smoothSeries(series: readonly number[], radius: number): number[] {
  if (radius === 0) return Array.from(series);

  const output = new Array<number>(series.length);
  let sum = 0;
  let left = 0;
  let right = -1;

  for (let index = 0; index < series.length; index += 1) {
    const nextLeft = Math.max(0, index - radius);
    const nextRight = Math.min(series.length - 1, index + radius);

    while (right < nextRight) {
      right += 1;
      sum += series[right] ?? 0;
    }
    while (left < nextLeft) {
      sum -= series[left] ?? 0;
      left += 1;
    }

    output[index] = sum / Math.max(1, right - left + 1);
  }

  return output;
}

function normalizeSeries(series: readonly number[]): number[] {
  if (series.length === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const value of series) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || max - min < 1e-9) {
    return new Array<number>(series.length).fill(0.5);
  }

  const span = max - min;
  return series.map((value) => clamp((value - min) / span));
}

function resampleSeries(series: readonly number[], targetPointCount: number | undefined): number[] {
  if (targetPointCount === undefined || targetPointCount === series.length) return Array.from(series);
  if (targetPointCount <= 0 || series.length === 0) return [];
  if (series.length === 1) return new Array<number>(targetPointCount).fill(series[0] ?? 0.5);
  if (targetPointCount === 1) return [series[0] ?? 0.5];

  const output = new Array<number>(targetPointCount);
  const maxIndex = series.length - 1;
  for (let index = 0; index < targetPointCount; index += 1) {
    const position = (index / (targetPointCount - 1)) * maxIndex;
    const left = Math.floor(position);
    const right = Math.min(maxIndex, left + 1);
    const mix = position - left;
    output[index] = (series[left] ?? 0) * (1 - mix) + (series[right] ?? 0) * mix;
  }
  return output;
}

function roundSeries(series: readonly number[]): number[] {
  return series.map((value) => Number(clamp(value).toFixed(4)));
}

function average(series: readonly number[]): number {
  if (series.length === 0) return 0;
  return series.reduce((sum, value) => sum + value, 0) / series.length;
}

/**
 * Incremental collector for analysis pipelines. It retains only four scalar
 * observations per frame; decoded samples and FFT bins remain the caller's
 * responsibility and can be released immediately.
 */
export class SpectralDescriptorAccumulator {
  readonly #rms: number[] = [];
  readonly #centroid: number[] = [];
  readonly #flux: number[] = [];
  readonly #lowFrequencyRatio: number[] = [];

  get frameCount(): number {
    return this.#rms.length;
  }

  add(observation: SpectralFrameObservation): this {
    this.#rms.push(finiteNonNegative(observation.rms));
    this.#centroid.push(finiteRatio(observation.centroid));
    this.#flux.push(finiteNonNegative(observation.flux));
    this.#lowFrequencyRatio.push(finiteRatio(observation.lowFrequencyRatio));
    return this;
  }

  finalize(options: SpectralDescriptorOptions = {}): SpectralDescriptorResult {
    const radii: Record<SpectralDescriptorName, number> = {
      energy: smoothingRadius(options.smoothing?.energy, DEFAULT_SMOOTHING.energy),
      brightness: smoothingRadius(options.smoothing?.brightness, DEFAULT_SMOOTHING.brightness),
      motion: smoothingRadius(options.smoothing?.motion, DEFAULT_SMOOTHING.motion),
      gravity: smoothingRadius(options.smoothing?.gravity, DEFAULT_SMOOTHING.gravity),
      tension: smoothingRadius(options.smoothing?.tension, DEFAULT_SMOOTHING.tension)
    };

    const energyFrames = normalizeSeries(smoothSeries(this.#rms, radii.energy));
    const brightnessFrames = normalizeSeries(smoothSeries(this.#centroid, radii.brightness));
    const motionFrames = normalizeSeries(smoothSeries(this.#flux, radii.motion));
    const gravityFrames = normalizeSeries(smoothSeries(this.#lowFrequencyRatio, radii.gravity));
    const tensionFrames = energyFrames.map((energy, index) =>
      energy * 0.42
      + (motionFrames[index] ?? 0) * 0.36
      + (brightnessFrames[index] ?? 0) * 0.16
      + (gravityFrames[index] ?? 0) * 0.06
    );
    const normalizedTension = normalizeSeries(smoothSeries(tensionFrames, radii.tension));

    const targetPointCount = options.targetPointCount === undefined
      ? undefined
      : Math.max(0, Math.floor(options.targetPointCount));
    const energy = roundSeries(resampleSeries(energyFrames, targetPointCount));
    const brightness = roundSeries(resampleSeries(brightnessFrames, targetPointCount));
    const motion = roundSeries(resampleSeries(motionFrames, targetPointCount));
    const gravity = roundSeries(resampleSeries(gravityFrames, targetPointCount));
    const tension = roundSeries(resampleSeries(normalizedTension, targetPointCount));

    return {
      frameCount: this.frameCount,
      energy,
      brightness,
      motion,
      gravity,
      tension,
      summary: {
        energy: Number(average(energy).toFixed(4)),
        brightness: Number(average(brightness).toFixed(4)),
        motion: Number(average(motion).toFixed(4)),
        gravity: Number(average(gravity).toFixed(4)),
        tension: Number(average(tension).toFixed(4))
      }
    };
  }
}

export function calculateSpectralDescriptors(
  observations: Iterable<SpectralFrameObservation>,
  options: SpectralDescriptorOptions = {}
): SpectralDescriptorResult {
  const accumulator = new SpectralDescriptorAccumulator();
  for (const observation of observations) accumulator.add(observation);
  return accumulator.finalize(options);
}

/**
 * Reduces ffmpeg-style frame metadata to five stable 0..1 track descriptors.
 * Unlike the relative curves above, these values retain meaning for uniform or
 * single-frame input: -72 dB maps to silence, Hz values map against Nyquist,
 * and unbounded flux is compressed monotonically.
 */
export function summarizeSpectralObservations(
  observations: Iterable<SpectralObservation>
): SpectralDescriptorSummary {
  let count = 0;
  let energyTotal = 0;
  let brightnessTotal = 0;
  let motionTotal = 0;
  let gravityTotal = 0;

  for (const observation of observations) {
    const nyquist = finiteNonNegative(observation.nyquistHz);
    if (nyquist <= 0) continue;

    const rmsDb = Number.isFinite(observation.rmsDb) ? observation.rmsDb : -72;
    const energy = clamp((rmsDb + 72) / 72);
    const brightness = clamp(finiteNonNegative(observation.centroidHz) / nyquist);
    const flux = finiteNonNegative(observation.flux);
    const motion = flux / (1 + flux);
    const spectralReach = finiteNonNegative(observation.rolloffHz)
      + finiteNonNegative(observation.spreadHz) * 0.25;
    const gravity = 1 - clamp(spectralReach / nyquist);

    energyTotal += energy;
    brightnessTotal += brightness;
    motionTotal += motion;
    gravityTotal += gravity;
    count += 1;
  }

  if (count === 0) {
    return { energy: 0, brightness: 0, motion: 0, gravity: 0, tension: 0 };
  }

  const energy = energyTotal / count;
  const brightness = brightnessTotal / count;
  const motion = motionTotal / count;
  const gravity = gravityTotal / count;
  const tension = clamp(energy * 0.42 + motion * 0.36 + brightness * 0.16 + gravity * 0.06);

  return {
    energy: Number(energy.toFixed(4)),
    brightness: Number(brightness.toFixed(4)),
    motion: Number(motion.toFixed(4)),
    gravity: Number(gravity.toFixed(4)),
    tension: Number(tension.toFixed(4))
  };
}
