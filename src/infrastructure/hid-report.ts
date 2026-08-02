/**
 * Turns a HID report descriptor (as WebHID exposes it) into a layout we can
 * decode, and decodes reports against that layout.
 *
 * This is deliberately generic rather than VKB-specific: it walks the declared
 * items in order, accumulating bit offsets, so any joystick-shaped device works.
 */

import {
  axisLabel,
  normalise,
  type AxisDescriptor,
  type ButtonDescriptor,
  type HatDescriptor,
  type InputSnapshot,
  type ReportLayout,
} from "../domain/device.js";

const USAGE_PAGE_GENERIC_DESKTOP = 0x01;
const USAGE_PAGE_SIMULATION = 0x02;
const USAGE_PAGE_BUTTON = 0x09;
const USAGE_HAT_SWITCH = 0x39;

const isAxisUsage = (page: number, usage: number): boolean =>
  (page === USAGE_PAGE_GENERIC_DESKTOP && usage >= 0x30 && usage <= 0x38) ||
  page === USAGE_PAGE_SIMULATION;

/** Read `bitLength` bits starting at `bitOffset`, LSB-first within each byte. */
export function readBits(
  view: DataView,
  bitOffset: number,
  bitLength: number,
  signed: boolean,
): number {
  let value = 0;
  for (let i = 0; i < bitLength; i += 1) {
    const bit = bitOffset + i;
    const byteIndex = bit >> 3;
    if (byteIndex >= view.byteLength) break;
    const on = (view.getUint8(byteIndex) >> (bit & 7)) & 1;
    // Multiplication rather than shifting: `1 << 31` would go negative.
    value += on * 2 ** i;
  }
  if (signed && bitLength > 0 && bitLength < 32) {
    const signBit = 2 ** (bitLength - 1);
    if (value >= signBit) value -= 2 ** bitLength;
  }
  return value;
}

function expandUsages(item: HIDReportItem, count: number): number[] {
  if (item.isRange && item.usageMinimum !== undefined && item.usageMaximum !== undefined) {
    const out: number[] = [];
    for (let u = item.usageMinimum; u <= item.usageMaximum && out.length < count; u += 1) {
      out.push(u);
    }
    return out;
  }
  return [...(item.usages ?? [])];
}

export function parseReportLayout(report: HIDReportInfo): ReportLayout {
  const axes: AxisDescriptor[] = [];
  const buttons: ButtonDescriptor[] = [];
  const hats: HatDescriptor[] = [];
  const vendorPages = new Set<number>();

  let bitOffset = 0;

  for (const item of report.items ?? []) {
    const size = item.reportSize ?? 0;
    const count = item.reportCount ?? 0;
    const span = size * count;

    if (item.isConstant || size === 0 || count === 0) {
      bitOffset += span;
      continue;
    }

    const usages = expandUsages(item, count);
    const logicalMin = item.logicalMinimum ?? 0;
    const logicalMax = item.logicalMaximum ?? 0;
    const signed = logicalMin < 0;

    for (let i = 0; i < count; i += 1) {
      // Devices often declare fewer usages than the report count; the trailing
      // fields repeat the last declared usage.
      const raw = usages[i] ?? usages[usages.length - 1];
      if (raw === undefined) continue;
      const page = raw > 0xffff ? raw >>> 16 : (item.usageMinimum !== undefined ? USAGE_PAGE_BUTTON : 0);
      const usage = raw & 0xffff;
      const fieldOffset = bitOffset + i * size;

      if (page >= 0xff00) {
        vendorPages.add(page);
        continue;
      }

      if (page === USAGE_PAGE_BUTTON) {
        buttons.push({
          kind: "button",
          id: `btn-${usage}`,
          number: usage,
          bitOffset: fieldOffset,
        });
        continue;
      }

      if (page === USAGE_PAGE_GENERIC_DESKTOP && usage === USAGE_HAT_SWITCH) {
        hats.push({
          kind: "hat",
          id: `hat-${hats.length}`,
          label: `Hat ${hats.length + 1}`,
          bitOffset: fieldOffset,
          bitLength: size,
          signed,
          logicalMin,
          logicalMax,
        });
        continue;
      }

      if (isAxisUsage(page, usage)) {
        axes.push({
          kind: "axis",
          id: `axis-${page.toString(16)}-${usage.toString(16)}-${axes.length}`,
          label: axisLabel(page, usage, axes.length),
          usagePage: page,
          usage,
          bitOffset: fieldOffset,
          bitLength: size,
          signed,
          logicalMin,
          logicalMax,
        });
      }
    }

    bitOffset += span;
  }

  return {
    reportId: report.reportId ?? 0,
    axes,
    buttons,
    hats,
    vendorPages: [...vendorPages],
  };
}

/** Collect every input report layout across a device's collection tree. */
export function collectLayouts(collections: readonly HIDCollectionInfo[]): ReportLayout[] {
  const out: ReportLayout[] = [];
  const walk = (nodes: readonly HIDCollectionInfo[]): void => {
    for (const node of nodes) {
      for (const report of node.inputReports ?? []) {
        const layout = parseReportLayout(report);
        if (layout.axes.length || layout.buttons.length || layout.hats.length) out.push(layout);
      }
      if (node.children) walk(node.children);
    }
  };
  walk(collections);
  return out;
}

const HAT_DIRECTIONS_8 = [0, 45, 90, 135, 180, 225, 270, 315];

export function decodeReport(
  layout: ReportLayout,
  data: DataView,
  at: number,
): InputSnapshot {
  const axes = new Map<string, number>();
  const axesRaw = new Map<string, number>();
  const buttons = new Map<string, boolean>();
  const hats = new Map<string, number | null>();

  for (const axis of layout.axes) {
    const raw = readBits(data, axis.bitOffset, axis.bitLength, axis.signed);
    axesRaw.set(axis.id, raw);
    axes.set(axis.id, normalise(raw, axis.logicalMin, axis.logicalMax));
  }

  for (const button of layout.buttons) {
    buttons.set(button.id, readBits(data, button.bitOffset, 1, false) === 1);
  }

  for (const hat of layout.hats) {
    const raw = readBits(data, hat.bitOffset, hat.bitLength, hat.signed);
    const positions = hat.logicalMax - hat.logicalMin + 1;
    const index = raw - hat.logicalMin;
    if (index < 0 || index >= positions || positions <= 1) {
      hats.set(hat.id, null);
    } else if (positions === 9 && index === 8) {
      hats.set(hat.id, null); // null state
    } else {
      const step = 360 / Math.min(positions === 9 ? 8 : positions, 8);
      hats.set(hat.id, HAT_DIRECTIONS_8[index] ?? index * step);
    }
  }

  return { at, axes, axesRaw, buttons, hats };
}
