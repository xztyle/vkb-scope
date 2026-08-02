/**
 * Diagnostics — the part that turns a stream of input reports into "is this
 * device healthy?".
 *
 * All thresholds are expressed as a fraction of full axis travel (0..1) so they
 * mean the same thing regardless of whether a device reports 8-bit or 16-bit
 * axes.
 */

export const THRESHOLDS = {
  /** Length of the sliding window drift is judged over. */
  restWindowMs: 2000,
  /**
   * Net displacement across the window, as a fraction of the window's own
   * peak-to-peak band, above which it counts as movement rather than noise.
   *
   * This is the discriminator that matters. Drift is mean-reverting: it
   * wanders about a fixed point and keeps coming back, so it covers a band
   * while ending up near where it started. Deliberate movement is directional:
   * net displacement ≈ the band covered. Crucially this works no matter how
   * *slowly* the axis is moved, which is what defeated earlier attempts that
   * tried to identify rest from sample-to-sample deltas or a fixed band width.
   */
  restTrendRatio: 0.5,
  /**
   * Bands wider than this are movement by definition, not drift. No sensor
   * that still functions wanders across a tenth of its travel, and this stops
   * a sweep that happens to return to its starting point from reading as
   * enormous drift.
   */
  maxDriftBand: 0.1,
  /** Noise band while at rest above this is reported as drift. */
  driftBand: 0.006,
  /**
   * A spike is an out-and-back outlier: the value jumps by more than this and
   * immediately reverses. Requiring the reversal is what separates a glitch
   * from fast movement — at typical report rates a quick sweep legitimately
   * covers a lot of travel between two samples, and that is not a fault.
   */
  spikeDelta: 0.2,
  /** Two edges closer together than this look like contact bounce. */
  chatterMs: 25,
} as const;

export type Severity = "ok" | "warn" | "bad";

export interface AxisHealth {
  readonly axisId: string;
  readonly label: string;
  readonly samples: number;
  /** Normalised current value, 0..1. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** Fraction of full travel actually exercised so far. */
  readonly coverage: number;
  /** Peak-to-peak noise measured while the axis was at rest. */
  readonly restBand: number;
  /** Where the axis rests, relative to centre (-0.5..0.5). */
  readonly centreOffset: number | null;
  readonly spikes: number;
  readonly severity: Severity;
  readonly notes: readonly string[];
}

export interface ButtonHealth {
  readonly buttonId: string;
  readonly number: number;
  readonly pressed: boolean;
  readonly presses: number;
  /** Edge pairs closer together than THRESHOLDS.chatterMs. */
  readonly chatter: number;
  readonly severity: Severity;
}

/**
 * Tracks one axis over time.
 *
 * Drift is separated from deliberate movement by mean reversion, not by speed:
 * over a sliding window, noise covers a band but returns to where it started,
 * while movement covers a band and stays where it went. Speed-based tests fail
 * because a slow enough sweep is indistinguishable from rest sample-to-sample.
 */
export class AxisMonitor {
  private samples = 0;
  private minSeen = Number.POSITIVE_INFINITY;
  private maxSeen = Number.NEGATIVE_INFINITY;
  private last: number | null = null;
  private prev: number | null = null;
  /** Sliding window of recent samples, trimmed to THRESHOLDS.restWindowMs. */
  private readonly window: { value: number; at: number }[] = [];
  private restBandPeak = 0;
  private restValueSum = 0;
  private restValueCount = 0;
  private spikeCount = 0;

  readonly axisId: string;
  readonly label: string;

  constructor(axisId: string, label: string) {
    this.axisId = axisId;
    this.label = label;
  }

  push(value: number, at: number): void {
    this.samples += 1;
    if (value < this.minSeen) this.minSeen = value;
    if (value > this.maxSeen) this.maxSeen = value;

    this.trackSpike(value);
    this.trackRest(value, at);

    this.prev = this.last;
    this.last = value;
  }

  /**
   * A glitch shows up as an out-and-back: the value leaps away and the very
   * next sample leaps back. Sustained movement in one direction, however fast,
   * is the user moving the axis.
   */
  private trackSpike(value: number): void {
    if (this.last === null || this.prev === null) return;
    const inbound = this.last - this.prev;
    const outbound = value - this.last;
    const reversed = Math.sign(inbound) !== Math.sign(outbound);
    if (
      reversed &&
      Math.abs(inbound) > THRESHOLDS.spikeDelta &&
      Math.abs(outbound) > THRESHOLDS.spikeDelta
    ) {
      this.spikeCount += 1;
    }
  }

  /**
   * Judge the last restWindowMs of samples: a band the axis covered while
   * ending up back where it started is noise; a band it covered while
   * travelling somewhere is the user moving it.
   */
  private trackRest(value: number, at: number): void {
    this.window.push({ value, at });
    const cutoff = at - THRESHOLDS.restWindowMs;
    while (this.window.length > 0 && this.window[0]!.at < cutoff) this.window.shift();
    // Need a full window before judging, or a brief pause mid-sweep reads as rest.
    if (this.window.length < 2 || at - this.window[0]!.at < THRESHOLDS.restWindowMs * 0.9) {
      return;
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const sample of this.window) {
      if (sample.value < min) min = sample.value;
      if (sample.value > max) max = sample.value;
    }

    const band = max - min;
    if (band > THRESHOLDS.maxDriftBand) return; // movement, by definition
    const netMove = Math.abs(value - this.window[0]!.value);
    if (band > 0 && netMove > band * THRESHOLDS.restTrendRatio) return; // directional

    if (band > this.restBandPeak) this.restBandPeak = band;
    this.restValueSum += value;
    this.restValueCount += 1;
  }

  health(): AxisHealth {
    const value = this.last ?? 0;
    const min = Number.isFinite(this.minSeen) ? this.minSeen : 0;
    const max = Number.isFinite(this.maxSeen) ? this.maxSeen : 0;
    const coverage = Math.max(0, max - min);
    const centreOffset =
      this.restValueCount > 0 ? this.restValueSum / this.restValueCount - 0.5 : null;

    const notes: string[] = [];
    let severity: Severity = "ok";

    if (this.restBandPeak > THRESHOLDS.driftBand) {
      notes.push(`drifts ${(this.restBandPeak * 100).toFixed(2)}% while at rest`);
      severity = this.restBandPeak > THRESHOLDS.driftBand * 3 ? "bad" : "warn";
    }
    if (this.spikeCount > 0) {
      notes.push(`${this.spikeCount} sudden jump${this.spikeCount === 1 ? "" : "s"}`);
      if (severity === "ok") severity = "warn";
    }
    if (this.samples > 200 && coverage < 0.9 && coverage > 0) {
      notes.push(`only ${(coverage * 100).toFixed(0)}% of travel seen — sweep it fully`);
    }

    return {
      axisId: this.axisId,
      label: this.label,
      samples: this.samples,
      value,
      min,
      max,
      coverage,
      restBand: this.restBandPeak,
      centreOffset,
      spikes: this.spikeCount,
      severity,
      notes,
    };
  }

  reset(): void {
    this.samples = 0;
    this.minSeen = Number.POSITIVE_INFINITY;
    this.maxSeen = Number.NEGATIVE_INFINITY;
    this.last = null;
    this.prev = null;
    this.window.length = 0;
    this.restBandPeak = 0;
    this.restValueSum = 0;
    this.restValueCount = 0;
    this.spikeCount = 0;
  }
}

/**
 * Tracks one button. Chatter is the interesting signal: a healthy switch
 * produces one clean edge pair per press, a failing one produces several
 * within a few milliseconds.
 */
export class ButtonMonitor {
  private pressed = false;
  private pressCount = 0;
  private chatterCount = 0;
  private lastEdgeAt: number | null = null;

  readonly buttonId: string;
  readonly number: number;

  constructor(buttonId: string, number: number) {
    this.buttonId = buttonId;
    this.number = number;
  }

  push(pressed: boolean, at: number): void {
    if (pressed === this.pressed) return;
    if (this.lastEdgeAt !== null && at - this.lastEdgeAt < THRESHOLDS.chatterMs) {
      this.chatterCount += 1;
    }
    this.lastEdgeAt = at;
    this.pressed = pressed;
    if (pressed) this.pressCount += 1;
  }

  health(): ButtonHealth {
    return {
      buttonId: this.buttonId,
      number: this.number,
      pressed: this.pressed,
      presses: this.pressCount,
      chatter: this.chatterCount,
      severity: this.chatterCount > 2 ? "bad" : this.chatterCount > 0 ? "warn" : "ok",
    };
  }

  reset(): void {
    this.pressed = false;
    this.pressCount = 0;
    this.chatterCount = 0;
    this.lastEdgeAt = null;
  }
}

/** Rolling report-rate estimate, so a device that stalls is visible. */
export class RateMeter {
  private stamps: number[] = [];

  tick(at: number): void {
    this.stamps.push(at);
    const cutoff = at - 1000;
    while (this.stamps.length > 0 && this.stamps[0]! < cutoff) this.stamps.shift();
  }

  perSecond(): number {
    return this.stamps.length;
  }

  reset(): void {
    this.stamps = [];
  }
}
