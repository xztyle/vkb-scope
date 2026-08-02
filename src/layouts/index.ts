/**
 * Built-in device layouts.
 *
 * A layout has to be drawn once by someone holding the hardware — the HID
 * protocol carries no physical information. Once drawn it can ship with the
 * app, so everyone else with that device gets an accurate diagram without
 * doing anything.
 *
 * Resolution order for a connected device:
 *   1. the user's own layout in localStorage (their edits always win)
 *   2. a built-in layout for that VID:PID, from this registry
 *   3. the default grid
 *
 * To contribute one: connect your device, open the Blueprint view, use
 * "Map buttons" to place them, "Export layout", then add the JSON here keyed by
 * VID:PID and open a pull request.
 */

import { parseLayout, type DeviceLayout } from "../domain/layout.js";

/**
 * Raw layout JSON keyed by "vvvv:pppp".
 *
 * Empty for now — the first entries will be real exports from real devices
 * rather than positions invented from a product photo, which would be worse
 * than the honest generic grid.
 */
const BUILT_IN: Readonly<Record<string, unknown>> = {};

export function builtInLayout(deviceKey: string): DeviceLayout | null {
  const raw = BUILT_IN[deviceKey];
  return raw ? parseLayout(raw) : null;
}

export const builtInDeviceKeys = (): string[] => Object.keys(BUILT_IN);
