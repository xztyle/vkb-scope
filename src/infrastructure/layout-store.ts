/**
 * Persistence for device layouts.
 *
 * Layouts live in localStorage keyed by VID:PID, and can be exported as JSON so
 * a layout drawn once can be shared with everyone who owns the same device.
 * Nothing here touches the device — a layout is purely a drawing.
 */

import { parseLayout, type DeviceLayout } from "../domain/layout.js";

const KEY_PREFIX = "vkb-scope:layout:";

export function loadLayout(deviceKey: string): DeviceLayout | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + deviceKey);
    return raw ? parseLayout(JSON.parse(raw)) : null;
  } catch {
    return null; // corrupt or unavailable storage is not worth failing over
  }
}

export function saveLayout(layout: DeviceLayout): void {
  try {
    localStorage.setItem(KEY_PREFIX + layout.deviceKey, JSON.stringify(layout));
  } catch {
    // Private browsing or a full quota — the layout simply won't persist.
  }
}

export function clearLayout(deviceKey: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + deviceKey);
  } catch {
    // ignore
  }
}

export function downloadLayout(layout: DeviceLayout): void {
  const safeName = (layout.deviceName || layout.deviceKey).replace(/[^a-z0-9]+/gi, "-");
  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vkb-scope-layout-${safeName.toLowerCase()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function pickLayoutFile(): Promise<DeviceLayout | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file
        .text()
        .then((text) => resolve(parseLayout(JSON.parse(text))))
        .catch(() => resolve(null));
    });
    input.click();
  });
}
