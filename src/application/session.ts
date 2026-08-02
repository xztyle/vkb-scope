/**
 * A monitoring session: owns the per-axis and per-button monitors for one
 * connected device and produces a health report the UI can render.
 */

import type { DeviceInfo, InputSnapshot, ReportLayout } from "../domain/device.js";
import {
  AxisMonitor,
  ButtonMonitor,
  RateMeter,
  type AxisHealth,
  type ButtonHealth,
} from "../domain/diagnostics.js";

export interface SessionReport {
  readonly axes: readonly AxisHealth[];
  readonly buttons: readonly ButtonHealth[];
  readonly hats: ReadonlyMap<string, number | null>;
  readonly reportsPerSecond: number;
  readonly totalReports: number;
  readonly elapsedMs: number;
}

export class MonitoringSession {
  private readonly axisMonitors = new Map<string, AxisMonitor>();
  private readonly buttonMonitors = new Map<string, ButtonMonitor>();
  private readonly rate = new RateMeter();
  private hats: ReadonlyMap<string, number | null> = new Map();
  private total = 0;
  private startedAt = performance.now();

  readonly info: DeviceInfo;

  constructor(info: DeviceInfo) {
    this.info = info;
    for (const layout of info.layouts) this.registerLayout(layout);
  }

  private registerLayout(layout: ReportLayout): void {
    for (const axis of layout.axes) {
      if (!this.axisMonitors.has(axis.id)) {
        this.axisMonitors.set(axis.id, new AxisMonitor(axis.id, axis.label));
      }
    }
    for (const button of layout.buttons) {
      if (!this.buttonMonitors.has(button.id)) {
        this.buttonMonitors.set(button.id, new ButtonMonitor(button.id, button.number));
      }
    }
  }

  ingest(snapshot: InputSnapshot): void {
    this.total += 1;
    this.rate.tick(snapshot.at);

    for (const [id, value] of snapshot.axes) {
      this.axisMonitors.get(id)?.push(value, snapshot.at);
    }
    for (const [id, pressed] of snapshot.buttons) {
      this.buttonMonitors.get(id)?.push(pressed, snapshot.at);
    }
    if (snapshot.hats.size > 0) this.hats = snapshot.hats;
  }

  report(): SessionReport {
    return {
      axes: [...this.axisMonitors.values()].map((m) => m.health()),
      buttons: [...this.buttonMonitors.values()]
        .map((m) => m.health())
        .sort((a, b) => a.number - b.number),
      hats: this.hats,
      reportsPerSecond: this.rate.perSecond(),
      totalReports: this.total,
      elapsedMs: performance.now() - this.startedAt,
    };
  }

  reset(): void {
    for (const m of this.axisMonitors.values()) m.reset();
    for (const m of this.buttonMonitors.values()) m.reset();
    this.rate.reset();
    this.hats = new Map();
    this.total = 0;
    this.startedAt = performance.now();
  }
}
