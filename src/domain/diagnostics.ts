/**
 * Diagnostics — the part that turns a stream of input reports into "is this
 * device healthy?".
 *
 * All thresholds are expressed as a fraction of full axis travel (0..1) so they
 * mean the same thing regardless of whether a device reports 8-bit or 16-bit
 * axes.
 */

export const THRESHOLDS = {
  /** Movement below this is treated as the axis sitting still. */
  restMovement: 0.004,
  /** How long an axis must sit still before we start judging its noise. */
  restAfterMs: 400,
  /** Noise band while at rest above this is reported as drift. */
  driftBand: 0.006,
  /** A single-sample jump larger than this is a spike. */
  spikeDelta: 0.15,
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
 * "At rest" is decided by watching how much the value moves: once it has been
 * still for restAfterMs we start accumulating the peak-to-peak band, which is
 * what actually reveals a drifting or noisy sensor. Judging noise while the
 * user is moving the axis would just measure the movement.
 */
export class AxisMonitor {
  private samples = 0;
  private minSeen = Number.POSITIVE_INFINITY;
  private maxSeen = Number.NEGATIVE_INFINITY;
  private last: number | null = null;
  private stillSince: number | null = null;
  private restMin = Number.POSITIVE_INFINITY;
  private restMax = Number.NEGATIVE_INFINITY;
  private restBandPeak = 0;
  private restValueSum = 0;
  private restValueCount = 0;
  private spikeCount = 0;

  constructor(
    readonly axisId: string,
    readonly label: string,
  ) {}

  push(value: number, at: number): void {
    this.samples += 1;
    if (value < this.minSeen) this.minSeen = value;
    if (value > this.maxSeen) this.maxSeen = value;

    if (this.last !== null) {
      const delta = Math.abs(value - this.last);
      if (delta > THRESHOLDS.spikeDelta) this.spikeCount += 1;

      if (delta <= THRESHOLDS.restMovement) {
        if (this.stillSince === null) {
          this.stillSince = at;
          this.restMin = value;
          this.restMax = value;
        } else {
          if (value < this.restMin) this.restMin = value;
          if (value > this.restMax) this.restMax = value;
          if (at - this.stillSince >= THRESHOLDS.restAfterMs) {
            const band = this.restMax - this.restMin;
            if (band > this.restBandPeak) this.restBandPeak = band;
            this.restValueSum += value;
            this.restValueCount += 1;
          }
        }
      } else {
        // Movement — start a fresh rest window next time it settles.
        this.stillSince = null;
        this.restMin = Number.POSITIVE_INFINITY;
        this.restMax = Number.NEGATIVE_INFINITY;
      }
    }
    this.last = value;
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
    this.stillSince = null;
    this.restMin = Number.POSITIVE_INFINITY;
    this.restMax = Number.NEGATIVE_INFINITY;
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

  constructor(
    readonly buttonId: string,
    readonly number: number,
  ) {}

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
