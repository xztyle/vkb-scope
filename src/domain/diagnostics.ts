/**
 * Diagnostics — the part that turns a stream of input reports into "is this
 * device healthy?".
 *
 * All thresholds are expressed as a fraction of full axis travel (0..1) so they
 * mean the same thing regardless of whether a device reports 8-bit or 16-bit
 * axes.
 */

export const THRESHOLDS = {
  /**
   * How wide the "sitting still" window is. The axis counts as at rest while
   * every sample stays inside a band this size; the moment it leaves, a new
   * window starts from the current value.
   *
   * This is deliberately a *band*, not a per-sample delta. Judging rest from
   * the delta alone means a slow sweep — where each step is tiny — reads as
   * one long rest period spanning the whole travel, reporting drift of ~100%.
   */
  restWindow: 0.02,
  /** How long the axis must stay inside that window before we judge its noise. */
  restAfterMs: 400,
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
  private prev: number | null = null;
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

  private trackRest(value: number, at: number): void {
    const min = Math.min(this.restMin, value);
    const max = Math.max(this.restMax, value);

    if (this.stillSince === null || max - min > THRESHOLDS.restWindow) {
      // Either first sample, or the axis left the window — it is moving, so
      // start a fresh window anchored at where it is now.
      this.stillSince = at;
      this.restMin = value;
      this.restMax = value;
      return;
    }

    this.restMin = min;
    this.restMax = max;
    if (at - this.stillSince < THRESHOLDS.restAfterMs) return;

    const band = max - min;
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
