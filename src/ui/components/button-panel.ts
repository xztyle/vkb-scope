import type { ButtonHealth } from "../../domain/diagnostics.js";
import { el } from "./dom.js";

/**
 * Grid of every button the device declares.
 *
 * Three states matter for diagnostics: currently pressed, pressed at least once
 * this session (so you can see what you've covered), and never seen.
 */
export class ButtonPanel {
  private readonly keys = new Map<string, HTMLElement>();

  constructor(private readonly host: HTMLElement) {}

  update(buttons: readonly ButtonHealth[]): void {
    if (buttons.length === 0) {
      this.host.replaceChildren(el("p", { className: "empty" }, "No buttons reported."));
      return;
    }
    for (const button of buttons) {
      const key = this.keys.get(button.buttonId) ?? this.createKey(button);
      key.dataset["pressed"] = String(button.pressed);
      key.dataset["seen"] = String(button.presses > 0);
      key.dataset["severity"] = button.severity;
      key.title = this.describe(button);
    }
  }

  private createKey(button: ButtonHealth): HTMLElement {
    const key = el("div", { className: "key" }, String(button.number));
    this.host.appendChild(key);
    this.keys.set(button.buttonId, key);
    return key;
  }

  private describe(button: ButtonHealth): string {
    const parts = [`Button ${button.number}`, `${button.presses} press(es)`];
    if (button.chatter > 0) parts.push(`${button.chatter} bounce event(s) — possible chatter`);
    return parts.join(" · ");
  }
}
