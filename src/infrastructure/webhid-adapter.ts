/**
 * The only module that touches navigator.hid.
 *
 * Read-only by construction: this adapter exposes no way to send output or
 * feature reports, so the tool physically cannot write to a device.
 */

import type { DeviceInfo, InputSnapshot } from "../domain/device.js";
import { collectLayouts, decodeReport } from "./hid-report.js";

export const VKB_VENDOR_ID = 0x231d;

export type SnapshotHandler = (snapshot: InputSnapshot) => void;

export interface ConnectedDevice {
  readonly info: DeviceInfo;
  readonly onSnapshot: (handler: SnapshotHandler) => void;
  readonly disconnect: () => Promise<void>;
}

export const isSupported = (): boolean =>
  typeof navigator !== "undefined" && navigator.hid !== undefined;

function describe(device: HIDDevice): DeviceInfo {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    productName: device.productName || "Unnamed HID device",
    layouts: collectLayouts(device.collections),
  };
}

async function attach(device: HIDDevice): Promise<ConnectedDevice> {
  if (!device.opened) await device.open();
  const info = describe(device);
  const handlers: SnapshotHandler[] = [];

  const listener = (event: HIDInputReportEvent): void => {
    // Match the layout by report id; devices with a single unnumbered report
    // arrive as id 0.
    const layout =
      info.layouts.find((l) => l.reportId === event.reportId) ?? info.layouts[0];
    if (!layout) return;
    const snapshot = decodeReport(layout, event.data, performance.now());
    for (const handler of handlers) handler(snapshot);
  };

  device.addEventListener("inputreport", listener);

  return {
    info,
    onSnapshot: (handler) => {
      handlers.push(handler);
    },
    disconnect: async () => {
      device.removeEventListener("inputreport", listener);
      handlers.length = 0;
      if (device.opened) await device.close();
    },
  };
}

/** Prompt the user to pick a device. `vkbOnly` narrows the chooser to VKB gear. */
export async function requestDevice(vkbOnly: boolean): Promise<ConnectedDevice | null> {
  const hid = navigator.hid;
  if (!hid) throw new Error("WebHID is not available in this browser.");
  const filters = vkbOnly ? [{ vendorId: VKB_VENDOR_ID }] : [];
  const devices = await hid.requestDevice({ filters });
  const device = devices[0];
  return device ? attach(device) : null;
}

/** Reconnect to a device the user has already granted access to. */
export async function reconnectFirstGranted(): Promise<ConnectedDevice | null> {
  const hid = navigator.hid;
  if (!hid) return null;
  const devices = await hid.getDevices();
  const device = devices[0];
  return device ? attach(device) : null;
}
