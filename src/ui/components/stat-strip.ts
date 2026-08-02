import type { SessionReport } from "../../application/session.js";
import { el, formatDuration } from "./dom.js";

interface Stat {
  readonly key: string;
  readonly label: string;
  readonly read: (report: SessionReport) => string;
}

const STATS: readonly Stat[] = [
  { key: "rate", label: "Report rate", read: (r) => `${r.reportsPerSecond} /s` },
  { key: "total", label: "Reports", read: (r) => r.totalReports.toLocaleString() },
  { key: "elapsed", label: "Elapsed", read: (r) => formatDuration(r.elapsedMs) },
  {
    key: "buttons",
    label: "Buttons seen",
    read: (r) => `${r.buttons.filter((b) => b.presses > 0).length} / ${r.buttons.length}`,
  },
  {
    key: "issues",
    label: "Issues",
    read: (r) =>
      String(
        r.axes.filter((a) => a.severity !== "ok").length +
          r.buttons.filter((b) => b.severity !== "ok").length,
      ),
  },
];

/** The header strip of live session numbers. */
export class StatStrip {
  private readonly values = new Map<string, HTMLElement>();

  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    for (const stat of STATS) {
      const value = el("div", { className: "stat__value" }, "—");
      this.values.set(stat.key, value);
      this.host.appendChild(
        el("div", { className: "stat" }, [
          el("div", { className: "stat__label" }, stat.label),
          value,
        ]),
      );
    }
  }

  update(report: SessionReport): void {
    for (const stat of STATS) {
      const node = this.values.get(stat.key);
      if (node) node.textContent = stat.read(report);
    }
  }
}
