/**
 * Physical layouts.
 *
 * A HID descriptor declares how many buttons exist but never where they are, so
 * a device-accurate diagram can only come from someone holding the hardware.
 * A layout maps button ids to positions on the schematic, in normalised 0..1
 * coordinates so it survives any canvas size.
 */

export interface LayoutPoint {
  readonly x: number;
  readonly y: number;
}

export interface DeviceLayout {
  /** Schema version, so shared files can be migrated rather than rejected. */
  readonly version: 1;
  /** "vvvv:pppp" — the device this layout was drawn for. */
  readonly deviceKey: string;
  /** Free text, e.g. "S-TECS Modern Throttle Max". */
  readonly deviceName: string;
  /** Button id -> position. Buttons absent here fall back to the default grid. */
  readonly points: Readonly<Record<string, LayoutPoint>>;
}

export const deviceKey = (vendorId: number, productId: number): string =>
  `${vendorId.toString(16).padStart(4, "0")}:${productId.toString(16).padStart(4, "0")}`;

export function emptyLayout(key: string, name: string): DeviceLayout {
  return { version: 1, deviceKey: key, deviceName: name, points: {} };
}

export function withPoint(
  layout: DeviceLayout,
  buttonId: string,
  point: LayoutPoint,
): DeviceLayout {
  return { ...layout, points: { ...layout.points, [buttonId]: clamp(point) } };
}

export function withoutPoint(layout: DeviceLayout, buttonId: string): DeviceLayout {
  const points = { ...layout.points };
  delete points[buttonId];
  return { ...layout, points };
}

const clamp = (p: LayoutPoint): LayoutPoint => ({
  x: Math.min(1, Math.max(0, p.x)),
  y: Math.min(1, Math.max(0, p.y)),
});

/** Validate anything claiming to be a layout — these arrive from files. */
export function parseLayout(raw: unknown): DeviceLayout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<DeviceLayout>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.deviceKey !== "string") return null;
  if (typeof candidate.points !== "object" || candidate.points === null) return null;

  const points: Record<string, LayoutPoint> = {};
  for (const [id, value] of Object.entries(candidate.points)) {
    const point = value as Partial<LayoutPoint>;
    if (typeof point?.x !== "number" || typeof point?.y !== "number") continue;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    points[id] = clamp({ x: point.x, y: point.y });
  }
  return {
    version: 1,
    deviceKey: candidate.deviceKey,
    deviceName: typeof candidate.deviceName === "string" ? candidate.deviceName : "",
    points,
  };
}
