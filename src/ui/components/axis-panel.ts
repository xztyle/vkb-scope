import type { AxisHealth } from "../../domain/diagnostics.js";
import { el, severityBadge } from "./dom.js";

interface AxisRow {
  readonly root: HTMLElement;
  readonly value: HTMLElement;
  readonly seen: HTMLElement;
  readonly fill: HTMLElement;
  readonly cursor: HTMLElement;
  readonly notes: HTMLElement;
  readonly badge: HTMLElement;
}

/** Live axis readouts: position, explored range, and health notes. */
export class AxisPanel {
  private readonly rows = new Map<string, AxisRow>();

  constructor(private readonly host: HTMLElement) {}

  update(axes: readonly AxisHealth[]): void {
    if (axes.length === 0) {
      this.host.replaceChildren(el("p", { className: "empty" }, "No axes reported."));
      return;
    }
    for (const axis of axes) {
      const row = this.rows.get(axis.axisId) ?? this.createRow(axis);
      this.paint(row, axis);
    }
  }

  private createRow(axis: AxisHealth): AxisRow {
    const value = el("span", { className: "axis__value" });
    const badge = el("span", { className: "badge badge--ok" }, "ok");
    const seen = el("div", { className: "track__seen" });
    const fill = el("div", { className: "track__fill" });
    const cursor = el("div", { className: "track__cursor" });
    const notes = el("div", { className: "axis__notes" });

    const root = el("div", { className: "axis" }, [
      el("div", { className: "axis__head" }, [
        el("span", { className: "axis__label" }, axis.label),
        badge,
        value,
      ]),
      el("div", { className: "track" }, [seen, fill, cursor]),
      notes,
    ]);

    this.host.appendChild(root);
    const row: AxisRow = { root, value, seen, fill, cursor, notes, badge };
    this.rows.set(axis.axisId, row);
    return row;
  }

  private paint(row: AxisRow, axis: AxisHealth): void {
    const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
    row.value.textContent = `${(axis.value * 100).toFixed(1)}%`;
    row.fill.style.width = pct(axis.value);
    row.cursor.style.left = pct(axis.value);
    row.seen.style.left = pct(axis.min);
    row.seen.style.width = pct(Math.max(0, axis.max - axis.min));

    severityBadge(row.badge, axis.severity);
    row.notes.replaceChildren(
      ...axis.notes.map((note) => el("span", { className: "badge badge--warn" }, note)),
    );
  }
}
