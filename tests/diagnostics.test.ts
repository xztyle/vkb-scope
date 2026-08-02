/**
 * Tests for the axis diagnostics.
 *
 * These exist because the drift detector produced false positives on healthy
 * hardware three times running: first it treated slow sweeps as 100% drift,
 * then it capped them at the window width and still reported ~2%. The cases
 * below encode what "healthy" and "faulty" actually look like so that can't
 * silently come back.
 *
 * Run: node --test tests/
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { AxisMonitor, THRESHOLDS } from "../src/domain/diagnostics.ts";

/** Feed a series of values at a fixed report interval. */
function feed(monitor: AxisMonitor, values: number[], hz = 100): void {
  const step = 1000 / hz;
  let at = 0;
  for (const value of values) {
    monitor.push(value, at);
    at += step;
  }
}

const seconds = (n: number, hz = 100): number => n * hz;

test("a perfectly still axis reports no drift", () => {
  // This is the real S-TECS at rest: bit-exact constant, verified from
  // /sys/class/hidraw/*/device/report_descriptor and raw reads.
  const axis = new AxisMonitor("a", "X");
  feed(axis, Array.from({ length: seconds(5) }, () => 0.5));
  const health = axis.health();
  assert.equal(health.restBand, 0, "constant input must not produce a band");
  assert.equal(health.severity, "ok");
  assert.deepEqual(health.notes, []);
});

test("a slow full sweep is movement, not drift", () => {
  // The case that kept producing false positives: every step is tiny, so a
  // naive "is it still?" check sees one long rest period.
  const axis = new AxisMonitor("a", "X");
  const samples = seconds(10);
  feed(
    axis,
    Array.from({ length: samples }, (_, i) => i / (samples - 1)),
  );
  const health = axis.health();
  assert.equal(health.severity, "ok", `slow sweep flagged: ${health.notes.join("; ")}`);
  assert.ok(health.coverage > 0.9, "should still record full travel coverage");
});

test("a very slow nudge within the rest window is not drift", () => {
  // Monotonic movement small enough to stay inside the window the whole time —
  // this is what defeated the previous fix.
  const axis = new AxisMonitor("a", "X");
  const samples = seconds(6);
  const span = THRESHOLDS.restWindow * 0.9;
  feed(
    axis,
    Array.from({ length: samples }, (_, i) => 0.5 + (i / (samples - 1)) * span),
  );
  assert.equal(axis.health().severity, "ok", "steady creep must read as movement");
});

test("genuine noise around a fixed point is reported as drift", () => {
  // A real drifting sensor: oscillates about one point, so it keeps returning.
  const axis = new AxisMonitor("a", "X");
  const band = THRESHOLDS.driftBand * 4;
  feed(
    axis,
    Array.from({ length: seconds(6) }, (_, i) => 0.5 + (i % 2 === 0 ? band / 2 : -band / 2)),
  );
  const health = axis.health();
  assert.ok(health.restBand > THRESHOLDS.driftBand, `band was ${health.restBand}`);
  assert.notEqual(health.severity, "ok", "real drift must be flagged");
});

test("fast movement is not counted as a spike", () => {
  // At 20Hz a quick sweep legitimately covers a lot of ground per sample.
  const axis = new AxisMonitor("a", "X");
  feed(axis, [0, 0.3, 0.6, 0.9, 1], 20);
  assert.equal(axis.health().spikes, 0);
});

test("an out-and-back outlier is counted as a spike", () => {
  const axis = new AxisMonitor("a", "X");
  feed(axis, [0.5, 0.5, 0.5, 0.9, 0.5, 0.5], 100);
  assert.equal(axis.health().spikes, 1);
});

test("reset clears accumulated state", () => {
  const axis = new AxisMonitor("a", "X");
  feed(axis, [0.5, 0.9, 0.5, 0.1]);
  axis.reset();
  const health = axis.health();
  assert.equal(health.samples, 0);
  assert.equal(health.spikes, 0);
  assert.equal(health.restBand, 0);
});
