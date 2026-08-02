/**
 * Wiring: connect a device, feed its reports into a monitoring session, and
 * repaint the panels once per animation frame.
 *
 * Repainting on rAF rather than per report matters — VKB gear can report at
 * 250Hz+, and the diagnostics still see every sample because ingestion happens
 * on the report callback; only the DOM update is throttled.
 */

import { MonitoringSession } from "./application/session.js";
import { isVkb } from "./domain/device.js";
import {
  isSupported,
  reconnectFirstGranted,
  requestDevice,
  type ConnectedDevice,
} from "./infrastructure/webhid-adapter.js";
import { AxisPanel } from "./ui/components/axis-panel.js";
import { ButtonPanel } from "./ui/components/button-panel.js";
import { HatPanel } from "./ui/components/hat-panel.js";
import { StatStrip } from "./ui/components/stat-strip.js";
import "./ui/styles/app.css";

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const ui = {
  unsupported: byId("unsupported"),
  intro: byId("intro"),
  dashboard: byId("dashboard"),
  connect: byId<HTMLButtonElement>("connect"),
  connectAny: byId<HTMLButtonElement>("connect-any"),
  disconnect: byId<HTMLButtonElement>("disconnect"),
  reset: byId<HTMLButtonElement>("reset"),
  deviceName: byId("device-name"),
  deviceMeta: byId("device-meta"),
  error: byId("error"),
};

const panels = {
  stats: new StatStrip(byId("stats")),
  axes: new AxisPanel(byId("axes")),
  buttons: new ButtonPanel(byId("buttons")),
  hats: new HatPanel(byId("hats")),
};

let connection: ConnectedDevice | null = null;
let session: MonitoringSession | null = null;
let frame = 0;

function showError(message: string): void {
  ui.error.textContent = message;
  ui.error.classList.remove("hidden");
}

function clearError(): void {
  ui.error.classList.add("hidden");
}

function paint(): void {
  if (session) {
    const report = session.report();
    panels.stats.update(report);
    panels.axes.update(report.axes);
    panels.buttons.update(report.buttons);
    panels.hats.update(report.hats);
  }
  frame = requestAnimationFrame(paint);
}

function start(device: ConnectedDevice): void {
  connection = device;
  session = new MonitoringSession(device.info);
  device.onSnapshot((snapshot) => session?.ingest(snapshot));

  const { info } = device;
  const vid = info.vendorId.toString(16).padStart(4, "0");
  const pid = info.productId.toString(16).padStart(4, "0");
  const vendorPages = info.layouts.flatMap((l) => l.vendorPages);

  ui.deviceName.textContent = info.productName;
  ui.deviceMeta.textContent = [
    `${vid}:${pid}`,
    isVkb(info.vendorId) ? "VKB" : "generic HID",
    `${info.layouts.length} input report${info.layouts.length === 1 ? "" : "s"}`,
    vendorPages.length > 0
      ? `vendor pages ${vendorPages.map((p) => `0x${p.toString(16)}`).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  ui.intro.classList.add("hidden");
  ui.dashboard.classList.remove("hidden");
  clearError();
  if (frame === 0) frame = requestAnimationFrame(paint);
}

async function connect(vkbOnly: boolean): Promise<void> {
  try {
    clearError();
    const device = await requestDevice(vkbOnly);
    if (!device) return; // user dismissed the chooser
    start(device);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

async function disconnect(): Promise<void> {
  cancelAnimationFrame(frame);
  frame = 0;
  await connection?.disconnect();
  connection = null;
  session = null;
  ui.dashboard.classList.add("hidden");
  ui.intro.classList.remove("hidden");
}

declare const __BUILD__: string;

function init(): void {
  // Surfacing the build makes a stale cache obvious instead of looking like a bug.
  const buildSlot = document.getElementById("build");
  if (buildSlot) buildSlot.textContent = `build ${__BUILD__}`;

  if (!isSupported()) {
    ui.unsupported.classList.remove("hidden");
    ui.intro.classList.add("hidden");
    return;
  }
  ui.connect.addEventListener("click", () => void connect(true));
  ui.connectAny.addEventListener("click", () => void connect(false));
  ui.disconnect.addEventListener("click", () => void disconnect());
  ui.reset.addEventListener("click", () => session?.reset());

  // If the user already granted a device in a previous visit, pick it up.
  void reconnectFirstGranted().then((device) => {
    if (device && !connection) start(device);
  });
}

init();
