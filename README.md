# VKB Scope

Read-only, browser-based diagnostics for VKB flight controllers — and any other
joystick-shaped HID device.

Plug in a stick or throttle, open the page, and see every button light up as you
press it and every axis move as you sweep it. It watches for the failures that
actually happen to flight gear: **axis drift**, **contact chatter**, **spikes**,
and inputs that never report at all.

It replaces the *Test* tab of VKB's Windows configurator, and runs on Linux,
macOS and Windows without installing anything.

## Read-only, by construction

VKB Scope **never writes to your device**. It cannot change your configuration,
your calibration or your firmware. This isn't a promise in the docs — the WebHID
adapter exposes no way to send output or feature reports at all
([`webhid-adapter.ts`](src/infrastructure/webhid-adapter.ts)), so there is no
code path that could write even by mistake.

If you need to *configure* a VKB device, use VKB's own tool. This is a
diagnostic instrument, not a configurator.

## What it detects

| Check | What it means |
|---|---|
| **Drift** | The axis moves while you aren't touching it. Measured as peak-to-peak noise only while the axis is genuinely at rest, so your own movement isn't counted as drift. |
| **Spikes** | A single report jumps more than 15% of full travel — usually a failing sensor or a bad connection. |
| **Chatter** | Two button edges closer together than 25 ms, i.e. contact bounce from a worn switch. |
| **Coverage** | How much of each axis's declared range you've actually reached. An axis that won't hit its stops is a calibration or hardware problem. |
| **Centre offset** | Where a self-centring axis actually rests, relative to true centre. |
| **Report rate** | Live reports per second — a device that stalls or disconnects shows up immediately. |

## Views

**Panels** — the detailed readout: per-axis tracks with explored range, the full
button grid, hat dials, and health notes.

**Blueprint** — a schematic of the inputs: an XY gate for the first two axes,
gauges for the rest, and buttons as numbered nodes, all live.

The blueprint starts as a schematic of *what the device reports*, because a HID
report descriptor says "128 buttons" and never says which one is the pinky
trigger — a physically accurate picture cannot be derived from the protocol.

### Mapping your device (once)

No manufacturer publishes usable schematics of these controllers, so the
picture has to come from you — which also means this works for any device ever
made, not just ones somebody drew.

1. **Load device photo** — a photo of your controller, or the vendor's product
   render. It's downscaled and stored in your browser, and becomes the backdrop
   the buttons sit on.
2. Click **Map buttons**
3. **Press a button on the device** — it arms, and the hint tells you which
4. **Click where it sits** on the photo
5. Repeat for the buttons you care about, then click **Done mapping**

Your layout saves to the browser immediately, so it's there next time.

### Sharing it, so nobody else has to

Layouts resolve in this order:

1. **your own**, from browser storage — your edits always win
2. **a built-in layout** shipped with the app for that VID:PID
3. the default grid

So a layout only has to be drawn once, by one person, for everyone with that
device to benefit. Exported layouts contain positions only — no image — so they
stay small and carry no licensing baggage from a vendor photo. To contribute yours: **Export layout**, then add the JSON to
[`src/layouts/index.ts`](src/layouts/index.ts) keyed by `vvvv:pppp` and open a
pull request.

`src/layouts` ships empty on purpose — the entries should be real exports from
real hardware, not positions guessed from product photos, which would be worse
than the honest generic grid.

## Browser support

VKB Scope uses **[WebHID](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API)**,
which means:

- ✅ Chrome, Chromium, Edge, Brave, Vivaldi, Opera
- ❌ **Firefox and Safari** — they don't implement WebHID, and there is no
  workaround. Zen, LibreWolf and other Firefox forks are also unsupported.

## Linux: device permissions

On Linux the raw HID node is root-only by default, so the browser can't open it
and no device appears in the chooser. Fix it once:

```bash
sudo tee /etc/udev/rules.d/99-vkb.rules >/dev/null <<'EOF'
KERNEL=="hidraw*", ATTRS{idVendor}=="231d", MODE="0660", TAG+="uaccess"
SUBSYSTEM=="usb", ATTRS{idVendor}=="231d", MODE="0660", TAG+="uaccess"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=hidraw --action=add
```

If `uaccess` doesn't grant access on your distro (it depends on logind seeing an
active session), add `GROUP="users"` to both rules — or use a group you're
actually in.

> This same permission problem is why VKB's own configurator is widely reported
> as "not detecting the device" under Wine. It usually isn't Wine's fault.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

The build is a static bundle with no runtime dependencies and no network access —
it can be hosted anywhere, or opened from disk.

## How it's put together

```
src/
  domain/           pure models and diagnostics logic — no browser APIs
    device.ts       device/report models, axis normalisation
    diagnostics.ts  drift, chatter and spike detection; thresholds live here
  application/
    session.ts      owns the monitors for one connected device
  infrastructure/
    webhid-adapter.ts  the ONLY module that touches navigator.hid
    hid-report.ts      generic HID report-descriptor parser and decoder
  ui/
    components/     small panels that own their DOM and update in place
    styles/         design tokens, then everything else
```

The report parser is deliberately generic — it walks the descriptor items and
accumulates bit offsets, so it isn't limited to VKB hardware. Any device that
declares buttons, axes or hats should render.

Diagnostics ingest **every** report, while the DOM repaints on
`requestAnimationFrame`. VKB gear can report at 250 Hz+; throttling the paint
keeps the UI smooth without dropping samples.

## Contributing

Issues and PRs welcome — especially reports from devices other than the ones
tested. If a device renders wrong, the useful details are its VID:PID, what the
device is, and what appeared versus what you expected.

Tuning thresholds is the other easy contribution: they're all in one place at
the top of [`diagnostics.ts`](src/domain/diagnostics.ts).

## Licence

MIT — see [LICENSE](LICENSE).

Not affiliated with, endorsed by, or supported by VKB-Sim.
