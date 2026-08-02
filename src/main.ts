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
  deviceKey,
  emptyLayout,
  withPoint,
  type DeviceLayout,
} from "./domain/layout.js";
import {
  clearLayout,
  downloadLayout,
  loadLayout,
  pickLayoutFile,
  saveLayout,
} from "./infrastructure/layout-store.js";
import { builtInLayout } from "./layouts/index.js";
import {
  clearImage,
  loadImage,
  measure,
  pickImage,
  saveImage,
} from "./infrastructure/image-store.js";
import {
  isSupported,
  reconnectFirstGranted,
  requestDevice,
  type ConnectedDevice,
} from "./infrastructure/webhid-adapter.js";
import { AxisPanel } from "./ui/components/axis-panel.js";
import { ButtonPanel } from "./ui/components/button-panel.js";
import { HatPanel } from "./ui/components/hat-panel.js";
import { Blueprint } from "./ui/components/blueprint.js";
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
  blueprintView: byId("blueprint-view"),
  viewPanels: byId<HTMLButtonElement>("view-panels"),
  viewBlueprint: byId<HTMLButtonElement>("view-blueprint"),
  mapEdit: byId<HTMLButtonElement>("map-edit"),
  mapExport: byId<HTMLButtonElement>("map-export"),
  mapImport: byId<HTMLButtonElement>("map-import"),
  mapClear: byId<HTMLButtonElement>("map-clear"),
  mapHint: byId("map-hint"),
  mapImage: byId<HTMLButtonElement>("map-image"),
  mapImageClear: byId<HTMLButtonElement>("map-image-clear"),
};

const panels = {
  stats: new StatStrip(byId("stats")),
  axes: new AxisPanel(byId("axes")),
  buttons: new ButtonPanel(byId("buttons")),
  hats: new HatPanel(byId("hats")),
  blueprint: new Blueprint(byId("blueprint")),
};

type View = "panels" | "blueprint";
let view: View = "panels";
let layout: DeviceLayout | null = null;
let mapping = false;
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
    // Only the visible view is painted; the other would be wasted work at 60Hz.
    if (view === "panels") {
      panels.axes.update(report.axes);
      panels.buttons.update(report.buttons);
      panels.hats.update(report.hats);
    } else {
      panels.blueprint.update(report);
      updateMapHint();
    }
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

  panels.blueprint.reset();
  const key = deviceKey(info.vendorId, info.productId);
  // Your own edits win; otherwise a layout shipped with the app for this
  // device; otherwise the generic grid.
  layout = loadLayout(key) ?? builtInLayout(key) ?? emptyLayout(key, info.productName);
  panels.blueprint.setLayout(layout);
  const storedImage = loadImage(key);
  if (storedImage) {
    void measure(storedImage)
      .then((image) => panels.blueprint.setBackdrop(image))
      .catch(() => undefined);
  }
  setMapping(false);
  ui.intro.classList.add("hidden");
  applyView();
  clearError();
  if (frame === 0) frame = requestAnimationFrame(paint);
}

function updateMapHint(): void {
  if (!mapping) {
    ui.mapHint.textContent = "";
    return;
  }
  const armed = panels.blueprint.armedButton();
  const where = panels.blueprint.hasBackdrop() ? "on the photo" : "on the diagram";
  ui.mapHint.textContent = armed
    ? `Now click where ${armed.replace("btn-", "button ")} sits ${where}`
    : "Press a button on the device to place it";
}

function setMapping(next: boolean): void {
  mapping = next;
  panels.blueprint.setEditing(next);
  ui.mapEdit.setAttribute("aria-pressed", String(next));
  ui.mapEdit.textContent = next ? "Done mapping" : "Map buttons";
  updateMapHint();
}

function applyView(): void {
  const live = session !== null;
  ui.dashboard.classList.toggle("hidden", !live || view !== "panels");
  ui.blueprintView.classList.toggle("hidden", !live || view !== "blueprint");
  ui.viewPanels.setAttribute("aria-pressed", String(view === "panels"));
  ui.viewBlueprint.setAttribute("aria-pressed", String(view === "blueprint"));
}

function setView(next: View): void {
  view = next;
  applyView();
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
  ui.blueprintView.classList.add("hidden");
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
  ui.mapImage.addEventListener("click", () => {
    void pickImage().then((picked) => {
      if (!picked || !layout) return;
      if (!saveImage(layout.deviceKey, picked.dataUrl)) {
        showError("Photo too large to store — try a smaller image.");
        return;
      }
      panels.blueprint.setBackdrop(picked);
    });
  });
  ui.mapImageClear.addEventListener("click", () => {
    if (!layout) return;
    clearImage(layout.deviceKey);
    panels.blueprint.setBackdrop(null);
  });
  ui.mapEdit.addEventListener("click", () => setMapping(!mapping));
  ui.mapExport.addEventListener("click", () => {
    if (layout) downloadLayout(layout);
  });
  ui.mapImport.addEventListener("click", () => {
    void pickLayoutFile().then((imported) => {
      if (!imported) return;
      layout = imported;
      saveLayout(imported);
      panels.blueprint.setLayout(imported);
    });
  });
  ui.mapClear.addEventListener("click", () => {
    if (!layout) return;
    clearLayout(layout.deviceKey);
    layout = emptyLayout(layout.deviceKey, layout.deviceName);
    panels.blueprint.setLayout(layout);
  });
  panels.blueprint.onPlace = (buttonId, point) => {
    if (!layout) return;
    layout = withPoint(layout, buttonId, point);
    saveLayout(layout);
    panels.blueprint.setLayout(layout);
  };
  ui.viewPanels.addEventListener("click", () => setView("panels"));
  ui.viewBlueprint.addEventListener("click", () => setView("blueprint"));
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
