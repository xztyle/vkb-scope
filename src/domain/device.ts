/**
 * Device and input models.
 *
 * Pure data — nothing here touches WebHID or the DOM, so the parsing and
 * diagnostics logic can be reasoned about (and tested) on its own.
 */

/** Where a value sits inside an input report, in bits. */
export interface BitField {
  readonly bitOffset: number;
  readonly bitLength: number;
  readonly signed: boolean;
  readonly logicalMin: number;
  readonly logicalMax: number;
}

export interface AxisDescriptor extends BitField {
  readonly kind: "axis";
  readonly id: string;
  /** Human label, e.g. "X", "Rz", "Slider 1". */
  readonly label: string;
  readonly usagePage: number;
  readonly usage: number;
}

export interface ButtonDescriptor {
  readonly kind: "button";
  readonly id: string;
  /** 1-based index as users and VKB's own tooling count them. */
  readonly number: number;
  readonly bitOffset: number;
}

export interface HatDescriptor extends BitField {
  readonly kind: "hat";
  readonly id: string;
  readonly label: string;
}

/** Everything we learned about one input report from the HID descriptor. */
export interface ReportLayout {
  readonly reportId: number;
  readonly axes: readonly AxisDescriptor[];
  readonly buttons: readonly ButtonDescriptor[];
  readonly hats: readonly HatDescriptor[];
  /** Vendor-defined usage pages present, e.g. 0xff00 on VKB gear. */
  readonly vendorPages: readonly number[];
}

export interface DeviceInfo {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly layouts: readonly ReportLayout[];
}

/** One decoded input report. */
export interface InputSnapshot {
  readonly at: number;
  /** Axis id -> normalised 0..1 */
  readonly axes: ReadonlyMap<string, number>;
  /** Axis id -> raw logical value */
  readonly axesRaw: ReadonlyMap<string, number>;
  /** Button id -> pressed */
  readonly buttons: ReadonlyMap<string, boolean>;
  /** Hat id -> direction in degrees, or null when centred */
  readonly hats: ReadonlyMap<string, number | null>;
}

export const isVkb = (vendorId: number): boolean => vendorId === 0x231d;

/** Normalise a raw logical value to 0..1 using its declared range. */
export function normalise(raw: number, min: number, max: number): number {
  if (max === min) return 0;
  const t = (raw - min) / (max - min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

const GENERIC_DESKTOP_AXES: Readonly<Record<number, string>> = {
  0x30: "X",
  0x31: "Y",
  0x32: "Z",
  0x33: "Rx",
  0x34: "Ry",
  0x35: "Rz",
  0x36: "Slider",
  0x37: "Dial",
  0x38: "Wheel",
};

export function axisLabel(usagePage: number, usage: number, fallbackIndex: number): string {
  if (usagePage === 0x01 && GENERIC_DESKTOP_AXES[usage]) return GENERIC_DESKTOP_AXES[usage]!;
  if (usagePage === 0x02) return `Sim ${usage.toString(16)}`;
  return `Axis ${fallbackIndex + 1}`;
}
