# RackPower Architect v1.0

Core rack **placement & space planning** only: EIA-310-D geometry enforcement, automated
horizontal device / PDU placement, zero-U vertical channel packing, dual-feed power
distribution and the three spatial views. Nothing in this build touches cabling
schedules, cooling load, network topology or CMDB sync — those are outside v1.0 scope.

```
npm install
npm run dev          # vite dev server (see "Environment note" below)
npm run build        # tsc -b && vite build  -> dist/
npm run preview      # serve the production build (verified path)
npm run test         # 88 vitest tests (engine, power, wiring, state, rendered views)
npm run typecheck    # strict TS, no emit
node scripts/capture-views.mjs http://127.0.0.1:5202/ docs/screenshots
```

## PRD coverage

| PRD | Where it lives |
| --- | --- |
| §2.1 EIA-310-D spatial engine, unit conversion, slot grid, rail depth profiles | [`src/utils/placement.ts`](src/utils/placement.ts), [`src/types/rack.ts`](src/types/rack.ts) |
| §2.2 Automated strategy engine (`BOTTOM`/`TOP`/`CENTER`), cord-bend clearance, manual drag-and-drop overrides | [`autoPlace()`](src/utils/placement.ts), [`validateRequest()`](src/utils/placement.ts), [`RackVisualizer.tsx`](src/components/RackVisualizer.tsx), [`PlacementInspector.tsx`](src/components/PlacementInspector.tsx) |
| §2.3 Vertical (zero-U) PDU channel packing | [`packVerticalPdus()`](src/utils/placement.ts), [`ChannelPanel.tsx`](src/components/ChannelPanel.tsx) |
| §2.4 Real-time spatial diagnostics | [`src/utils/diagnostics.ts`](src/utils/diagnostics.ts), [`DiagnosticsPanel.tsx`](src/components/DiagnosticsPanel.tsx), [`CapacitySummary.tsx`](src/components/CapacitySummary.tsx) |
| §3.1 Front elevation + virtualized inventory tray | [`RackVisualizer.tsx`](src/components/RackVisualizer.tsx), [`InventoryTray.tsx`](src/components/InventoryTray.tsx) (`react-window`) |
| §3.2 Side cross-section | [`RackSideView.tsx`](src/components/RackSideView.tsx) |
| §3.3 Logical wiring diagram | [`src/utils/wiring.ts`](src/utils/wiring.ts), [`WiringDiagram.tsx`](src/components/WiringDiagram.tsx) |

## Geometry that is enforced, not decorative

* **1 U = 44.45 mm = 4.445 cm** exactly (`MM_PER_U`); a 42U frame is 1 866.90 mm of pitch.
* 19 in mounting opening **482.6 mm**, hole columns **465.0 mm** apart, **9.5 mm** square
  holes on a **15.875 mm** pitch — the elevation draws those holes per U above 15 px/U.
* Rail depth envelopes: front-rail gear grows rearward from `frontRailOffsetMm`,
  rear-rail gear grows forward from `rearRailOffsetMm`. The rear rail is adjustable
  (slider in the side view) and every envelope is re-checked against
  `frontObstructionMm … externalDepthMm − rearObstructionMm`.
* Cord-bend buffers are derived per inlet class, not hard-coded in U
  (`CORD_BEND_CLEARANCE_MM` → `mmToCeilU`):

  | inlet | vertical buffer | rear cord depth |
  | --- | --- | --- |
  | C14 | 44 mm → **1U** | 33 mm |
  | C20 | 66 mm → **2U** | 50 mm |
  | IEC-309 32 A | 110 mm → **3U** | 83 mm |
  | IEC-309 63 A | 150 mm → **4U** | 113 mm |
  | hardwired | 30 mm → **1U** | 23 mm |

* Zero-U channels hold `totalU × 44.45 − 2 × 40 mm` (frame + cable entry); a 42U channel
  is 1 786.9 mm, so one 1 780 mm strip per channel is the ceiling and the packer enforces it.

## Placement and collision rules

* **Strategies.** `BOTTOM` builds up from U1, `TOP` down from U(top), `CENTER` centres the
  device block and splits the horizontal PDU pair to opposite extremes — how dual-feed
  horizontal strips are normally dressed. Horizontal PDUs are placed first so their
  cord-bend buffers are reserved before any device claims a slot; remaining devices are
  ordered heaviest-lowest for rack stability.
* **Same rail, overlapping span → error.** Different rails at the same U is legal **only**
  when the two depth envelopes clear each other; otherwise it is a `RAIL_CONFLICT` error.
* `OUT_OF_BOUNDS`, `DEPTH_EXCEEDED`, `CLEARANCE_BLOCKED`, `RECESS_RAIL_MISMATCH`,
  `CHANNEL_OVERLAP`, `CHANNEL_OVERFLOW`, `CHANNEL_WIDTH`, `LOAD_EXCEEDED`, `U_CAPACITY`,
  `FEED_OVERLOAD`, `FEED_IMBALANCE`, `OUTLET_EXHAUSTED`, `SINGLE_FEED`, `UNPOWERED` are
  all emitted live, ranked error → warning → info, and click-through selects the unit.
* **Drops never violate geometry.** `validateRequest()` runs during `dragover` (green/red
  ghost) and again in the reducer; an error-level violation rejects the drop and reports
  the reason in the banner. ↑/↓ nudges the selected unit by one U, Delete unmounts it.

## Dual-feed power model

PSU-1 → Feed A, PSU-2 → Feed B, PSU-3 → Feed A …; C14 inlets consume C13 outlets, C20
inlets consume C19, IEC-309/hardwired inlets terminate directly on the branch circuit.
Feed load is the summed per-PSU share of each device draw, checked against the frame's
branch rating (warning above 80 %, error above 100 %), plus a 30 % imbalance warning and
per-PDU outlet accounting.

## Verification

`npm run test` → **88 tests**: unit conversion, grid mapping, envelopes, inlet-scaled
clearance, overlap/rail/depth collisions, all three strategies (including buffer
reservation and heaviest-lowest ordering), channel packing balance and overflow, feed
assignment and starvation, wiring layout bounds, reducer transitions, and a rendered
workbench check (view switching, auto-place onto the grid, zero-U strip placement,
react-window virtualization of ~5 000 units into 14 DOM rows, live out-of-bounds
diagnostics after a frame change).

`node scripts/capture-views.mjs` drives the built app in headless Chromium: it asserts a
real HTML5 drag-and-drop lands a unit (`Mounted A32 Access Switch at U41 front rail`),
the drop ghost renders, keyboard re-seating moves the selection, and it records a
geometry audit — no overlapping blocks, no elements outside the rack face, no horizontal
page overflow, no console or page errors. Screenshots land in `docs/screenshots/`.

**Environment note.** In this sandbox `vite dev` starts but never binds a port (no log
output at `--logLevel debug` either); `vite build` and `vite preview` both work, so all
browser verification here ran against `npm run build && npm run preview`. On a normal
interactive terminal `npm run dev` is the expected entry point.

## Limits worth stating

The catalogue in [`src/data/catalogue.ts`](src/data/catalogue.ts) is illustrative sample
data with EIA-310-D-consistent dimensions, not vendor datasheets. Power is single-phase
230 V branch capacity per feed (no diversity factor, no inrush). Clearance figures are
documented engineering estimates of connector body + minimum cord bend radius, tunable in
one table. Cable routing is modelled as clearance envelopes, not physical path finding.
