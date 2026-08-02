import { el } from "./dom.js";

interface HatDial {
  readonly dial: HTMLElement;
  readonly needle: HTMLElement;
}

/** Circular readouts for hat switches / POV controls. */
export class HatPanel {
  private readonly dials = new Map<string, HatDial>();

  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  update(hats: ReadonlyMap<string, number | null>): void {
    if (hats.size === 0) {
      this.host.replaceChildren(el("p", { className: "empty" }, "No hat switches reported."));
      return;
    }
    let index = 0;
    for (const [id, degrees] of hats) {
      index += 1;
      const dial = this.dials.get(id) ?? this.createDial(id, index);
      const active = degrees !== null;
      dial.dial.dataset["active"] = String(active);
      if (active) {
        dial.needle.style.transform = `translateY(-100%) rotate(${degrees}deg)`;
      }
    }
  }

  private createDial(id: string, index: number): HatDial {
    const needle = el("div", { className: "hat__needle" });
    const dial = el("div", { className: "hat__dial" }, [needle, el("div", { className: "hat__centre" })]);
    this.host.appendChild(
      el("div", { className: "hat" }, [dial, el("div", { className: "hat__label" }, `Hat ${index}`)]),
    );
    const entry: HatDial = { dial, needle };
    this.dials.set(id, entry);
    return entry;
  }
}
