/**
 * Blueprint view — a schematic of the *inputs* a device declares, not a picture
 * of the device.
 *
 * A HID descriptor says "128 buttons"; it never says which one is the pinky
 * trigger. Rather than invent a physical layout we can't verify, this draws
 * what is actually known: the XY gate, each axis as a gauge, hats as compass
 * roses, buttons as numbered nodes. It therefore adapts to any device.
 *
 * Per-device physical layouts can be layered on later without changing this —
 * see the note in the README about community-contributed maps.
 */

import type { SessionReport } from "../../application/session.js";
import type { AxisHealth } from "../../domain/diagnostics.js";
import type { DeviceLayout, LayoutPoint } from "../../domain/layout.js";

const SVG = "http://www.w3.org/2000/svg";

const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

interface GaugeParts {
  readonly fill: SVGRectElement;
  readonly marker: SVGLineElement;
  readonly readout: SVGTextElement;
  readonly frame: SVGRectElement;
}

/** Live schematic of everything the device reports. */
export class Blueprint {
  private readonly host: HTMLElement;
  /** Called when the user places a button; the app persists the result. */
  onPlace: ((buttonId: string, point: LayoutPoint) => void) | null = null;
  private layout: DeviceLayout | null = null;
  private editing = false;
  /** Button awaiting placement — set by pressing it on the device. */
  private armed: string | null = null;
  private canvas = { width: 900, height: 600 };
  private root: SVGSVGElement | null = null;
  private gauges = new Map<string, GaugeParts>();
  private crosshair: SVGGElement | null = null;
  private xyIds: [string, string] | null = null;
  private nodes = new Map<string, SVGElement>();
  /** Default grid slot per button, used until one is mapped. */
  private homes = new Map<string, { x: number; y: number }>();
  private built = false;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  update(report: SessionReport): void {
    if (!this.built) this.build(report);
    this.paintAxes(report.axes);
    this.paintButtons(report);
    if (this.editing) this.armFromPress(report);
  }

  setLayout(layout: DeviceLayout | null): void {
    this.layout = layout;
    if (this.built) this.placeNodes();
  }

  setEditing(editing: boolean): void {
    this.editing = editing;
    this.armed = null;
    this.root?.classList.toggle("bp--editing", editing);
    this.updateArmedHighlight();
  }

  /** Which button is waiting to be placed, for the UI to prompt with. */
  armedButton(): string | null {
    return this.armed;
  }

  /**
   * In edit mode, physically pressing a button arms it for placement. That is
   * the whole point: only the person holding the device knows where it is.
   */
  private armFromPress(report: SessionReport): void {
    const pressed = report.buttons.find((b) => b.pressed);
    if (pressed && pressed.buttonId !== this.armed) {
      this.armed = pressed.buttonId;
      this.updateArmedHighlight();
    }
  }

  private updateArmedHighlight(): void {
    for (const [id, node] of this.nodes) {
      node.setAttribute("data-armed", String(this.editing && id === this.armed));
    }
  }

  /** Apply saved positions, falling back to the default grid slot. */
  private placeNodes(): void {
    for (const [id, node] of this.nodes) {
      const point = this.layout?.points[id];
      const home = this.homes.get(id);
      const cx = point ? point.x * this.canvas.width : home?.x;
      const cy = point ? point.y * this.canvas.height : home?.y;
      if (cx === undefined || cy === undefined) continue;
      node.setAttribute("cx", String(cx));
      node.setAttribute("cy", String(cy));
      node.setAttribute("data-mapped", String(Boolean(point)));
    }
  }

  /** Rebuild from scratch — used when a different device connects. */
  reset(): void {
    this.built = false;
    this.gauges.clear();
    this.nodes.clear();
    this.homes.clear();
    this.armed = null;
    this.crosshair = null;
    this.xyIds = null;
    this.host.replaceChildren();
  }

  private build(report: SessionReport): void {
    const axes = report.axes;
    const hasGate = axes.length >= 2;
    this.xyIds = hasGate ? [axes[0]!.axisId, axes[1]!.axisId] : null;

    const gaugeAxes = hasGate ? axes.slice(2) : axes;
    const gaugeRows = Math.max(gaugeAxes.length, 1);
    const buttonRows = Math.ceil(report.buttons.length / 16);

    const width = 900;
    const gateBottom = hasGate ? 300 : 40;
    const gaugesBottom = gateBottom + gaugeRows * 46 + 20;
    const height = gaugesBottom + buttonRows * 30 + 60;

    const svg = svgEl("svg", {
      viewBox: `0 0 ${width} ${height}`,
      class: "bp",
      role: "img",
      "aria-label": "Schematic of detected controls",
    });
    svg.append(this.defs(), this.grid(width, height));

    if (hasGate) svg.append(this.gate(axes[0]!, axes[1]!));
    gaugeAxes.forEach((axis, i) => svg.append(this.gauge(axis, gateBottom + i * 46)));
    svg.append(this.buttonField(report, gaugesBottom));

    svg.addEventListener("click", (event) => this.handleCanvasClick(event));
    this.host.replaceChildren(svg);
    this.root = svg;
    this.canvas = { width, height };
    this.built = true;
    this.placeNodes();
    this.root.classList.toggle("bp--editing", this.editing);
  }

  private defs(): SVGDefsElement {
    const defs = svgEl("defs");
    const pattern = svgEl("pattern", {
      id: "bp-grid",
      width: 20,
      height: 20,
      patternUnits: "userSpaceOnUse",
    });
    pattern.append(svgEl("path", { d: "M20 0H0V20", fill: "none", class: "bp__gridline" }));
    defs.append(pattern);
    return defs;
  }

  private grid(width: number, height: number): SVGRectElement {
    return svgEl("rect", { width, height, fill: "url(#bp-grid)" });
  }

  /** 2D gate for the first two axes — how a stick or twin levers actually move. */
  private gate(x: AxisHealth, y: AxisHealth): SVGGElement {
    const g = svgEl("g");
    const size = 220;
    const ox = 40;
    const oy = 40;

    g.append(svgEl("rect", { x: ox, y: oy, width: size, height: size, class: "bp__frame" }));
    g.append(
      svgEl("line", { x1: ox, y1: oy + size / 2, x2: ox + size, y2: oy + size / 2, class: "bp__axis" }),
      svgEl("line", { x1: ox + size / 2, y1: oy, x2: ox + size / 2, y2: oy + size, class: "bp__axis" }),
    );
    g.append(this.label(ox, oy - 12, `${x.label} / ${y.label} gate`));

    const cross = svgEl("g", { class: "bp__cross" });
    cross.append(
      svgEl("circle", { cx: 0, cy: 0, r: 7, class: "bp__crossdot" }),
      svgEl("line", { x1: -14, y1: 0, x2: 14, y2: 0, class: "bp__crossarm" }),
      svgEl("line", { x1: 0, y1: -14, x2: 0, y2: 14, class: "bp__crossarm" }),
    );
    cross.dataset["ox"] = String(ox);
    cross.dataset["oy"] = String(oy);
    cross.dataset["size"] = String(size);
    this.crosshair = cross;
    g.append(cross);
    return g;
  }

  private gauge(axis: AxisHealth, y: number): SVGGElement {
    const g = svgEl("g");
    const x = 300;
    const w = 540;
    const h = 14;

    g.append(this.label(x, y - 4, axis.label));
    const frame = svgEl("rect", { x, y: y + 4, width: w, height: h, rx: 3, class: "bp__frame" });
    const fill = svgEl("rect", { x, y: y + 4, width: 0, height: h, rx: 3, class: "bp__fill" });
    const marker = svgEl("line", { x1: x, y1: y, x2: x, y2: y + h + 8, class: "bp__marker" });
    const readout = svgEl("text", { x: x + w + 10, y: y + h, class: "bp__readout" });

    for (let t = 0; t <= 4; t += 1) {
      const tx = x + (w * t) / 4;
      g.append(svgEl("line", { x1: tx, y1: y + h + 5, x2: tx, y2: y + h + 9, class: "bp__tick" }));
    }

    g.append(frame, fill, marker, readout);
    this.gauges.set(axis.axisId, { fill, marker, readout, frame });
    return g;
  }

  private buttonField(report: SessionReport, top: number): SVGGElement {
    const g = svgEl("g");
    g.append(this.label(40, top - 6, `${report.buttons.length} buttons`));
    const perRow = 16;
    const gap = 26;
    report.buttons.forEach((button, i) => {
      const cx = 48 + (i % perRow) * gap;
      const cy = top + 16 + Math.floor(i / perRow) * 30;
      const node = svgEl("circle", { cx, cy, r: 9, class: "bp__node" });
      node.append(svgEl("title", {}));
      node.querySelector("title")!.textContent = `Button ${button.number}`;
      this.nodes.set(button.buttonId, node);
      this.homes.set(button.buttonId, { x: cx, y: cy });
      g.append(node);
    });
    return g;
  }

  /** Clicking the canvas in edit mode drops the armed button at that point. */
  private handleCanvasClick(event: MouseEvent): void {
    if (!this.editing || !this.armed || !this.root) return;
    const rect = this.root.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const point: LayoutPoint = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    this.onPlace?.(this.armed, point);
    this.armed = null;
    this.updateArmedHighlight();
  }

  private label(x: number, y: number, text: string): SVGTextElement {
    const node = svgEl("text", { x, y, class: "bp__label" });
    node.textContent = text;
    return node;
  }

  private paintAxes(axes: readonly AxisHealth[]): void {
    for (const axis of axes) {
      const parts = this.gauges.get(axis.axisId);
      if (!parts) continue;
      const x = Number(parts.frame.getAttribute("x"));
      const w = Number(parts.frame.getAttribute("width"));
      parts.fill.setAttribute("width", String(Math.max(0, axis.value * w)));
      parts.marker.setAttribute("x1", String(x + axis.value * w));
      parts.marker.setAttribute("x2", String(x + axis.value * w));
      parts.readout.textContent = `${(axis.value * 100).toFixed(1)}%`;
      parts.frame.setAttribute("data-severity", axis.severity);
    }

    if (!this.crosshair || !this.xyIds || !this.root) return;
    const x = axes.find((a) => a.axisId === this.xyIds![0]);
    const y = axes.find((a) => a.axisId === this.xyIds![1]);
    if (!x || !y) return;
    const ox = Number(this.crosshair.dataset["ox"]);
    const oy = Number(this.crosshair.dataset["oy"]);
    const size = Number(this.crosshair.dataset["size"]);
    this.crosshair.setAttribute(
      "transform",
      `translate(${ox + x.value * size}, ${oy + y.value * size})`,
    );
  }

  private paintButtons(report: SessionReport): void {
    for (const button of report.buttons) {
      const node = this.nodes.get(button.buttonId);
      if (!node) continue;
      node.setAttribute("data-pressed", String(button.pressed));
      node.setAttribute("data-seen", String(button.presses > 0));
      node.setAttribute("data-severity", button.severity);
    }
  }
}
