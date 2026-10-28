/**
 * EIA-310-D Spatial Engine (PRD §2.1–§2.3).
 *
 * Pure, side-effect-free geometry: unit conversion, U-slot grid mapping, front/rear
 * rail depth envelopes, cord-bend clearance modelling, collision detection,
 * automated strategy placement and zero-U vertical channel packing.
 *
 * Every vertical measurement is derived from the EIA-310-D pitch of
 * 1 U = 44.45 mm = 4.445 cm; nothing here rounds to "close enough" units.
 */

import {
  MM_PER_U,
  type Channel,
  type DeviceInstance,
  type DeviceSpec,
  type FeedId,
  type InletType,
  type Placement,
  type PlacementRequest,
  type PlacementStrategy,
  type RackPreset,
  type RailPosition,
  type VerticalPlacement,
  type Violation,
} from '../types/rack';

/* ------------------------------------------------------------------ */
/* §2.1 Standard unit conversion                                       */
/* ------------------------------------------------------------------ */

/** mm of vertical pitch per rack unit (EIA-310-D). */
export const MM_PER_RACK_UNIT = MM_PER_U;

/** Top/bottom frame + cable-entry obstruction inside a rear vertical channel (mm). */
export const CHANNEL_ENTRY_OBSTRUCTION_MM = 40;

/**
 * Cord-bend clearance (mm of vertical buffer) needed for the inlet connector of a
 * horizontal PDU. Derived from the connector body length plus the minimum bend
 * radius of the matching cordage:
 *   C14/C13          IEC 60320 C14 inlet + 10 A cord (Ø 7.6 mm, r ≈ 22 mm)
 *   C20/C19          IEC 60320 C20 inlet + 16/20 A cord (Ø 9.5 mm, r ≈ 33 mm)
 *   IEC 60309 32 A   industrial connector + 6 mm² HO7RN-F (r ≈ 55 mm)
 *   IEC 60309 63 A   industrial connector + 16 mm² HO7RN-F (r ≈ 75 mm)
 *   HARDWIRED        gland plate / junction box strain relief
 */
export const CORD_BEND_CLEARANCE_MM: Record<InletType, number> = {
  C14: 44,
  C20: 66,
  'IEC-309-32A': 110,
  'IEC-309-63A': 150,
  HARDWIRED: 30,
};

/** Vertical cord-bend buffer, in whole U, that an inlet type demands (PRD §2.2). */
export function cordBendClearanceU(inlet: InletType): number {
  return mmToCeilU(cordBendClearanceMm(inlet));
}

export function cordBendClearanceMm(inlet: InletType): number {
  return CORD_BEND_CLEARANCE_MM[inlet];
}

/** Rearward (depth) allowance a cord needs behind the chassis face, in mm. */
export function cordBendDepthMm(inlet: InletType): number {
  return Math.round(CORD_BEND_CLEARANCE_MM[inlet] * 0.75);
}

/** Inlet used for clearance sizing on a device (worst-case of its PSUs). */
export function primaryInlet(spec: DeviceSpec): InletType {
  if (spec.inlets.length === 0) return 'C14';
  return spec.inlets.reduce((worst, inlet) =>
    CORD_BEND_CLEARANCE_MM[inlet] > CORD_BEND_CLEARANCE_MM[worst] ? inlet : worst,
  );
}

/** Rack units spanned by a millimetre length, rounded up to a whole slot. */
export function mmToCeilU(mm: number): number {
  return Math.max(1, Math.ceil(round6(mm) / MM_PER_U));
}

/** Rack units spanned by a millimetre length, truncated to a whole slot. */
export function mmToFloorU(mm: number): number {
  return Math.max(0, Math.floor(round6(mm) / MM_PER_U));
}

export function uToMm(u: number): number {
  return round6(u * MM_PER_U);
}

/** Front-face height (mm) of the bottom edge of U slot `u` (1-based). */
export function uBottomMm(u: number): number {
  return uToMm(u - 1);
}

/** Convert centimetres (EIA-310-D lists 1 U as 4.445 cm) to U. */
export function cmToU(cm: number): number {
  return cm / (MM_PER_U / 10);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/* ------------------------------------------------------------------ */
/* §2.1 Slot allocation & grid mapping                                 */
/* ------------------------------------------------------------------ */

/** Discrete U-slot array for a rack: 1..N bottom-to-top. */
export function buildSlotArray(rack: RackPreset): number[] {
  return Array.from({ length: rack.totalU }, (_, i) => i + 1);
}

/**
 * Occupancy grid indexed by U slot (index 0 === U1).
 * Each entry lists the placements that physically occupy that slot on some rail.
 */
export function occupancyGrid(
  rack: RackPreset,
  placements: Placement[],
): (Placement | null)[] {
  const grid: (Placement | null)[] = new Array(rack.totalU).fill(null);
  for (const placement of placements) {
    if (!inBounds(placement.startU, placement.spanU, rack)) continue;
    for (let u = placement.startU; u <= placementTopU(placement); u += 1) {
      grid[u - 1] = placement;
    }
  }
  return grid;
}

export function placementTopU(placement: Placement): number {
  return placement.startU + placement.spanU - 1;
}

export function inBounds(startU: number, spanU: number, rack: RackPreset): boolean {
  return (
    Number.isInteger(startU) &&
    Number.isInteger(spanU) &&
    spanU >= 1 &&
    startU >= 1 &&
    startU + spanU - 1 <= rack.totalU
  );
}

export function uSpansOverlap(
  aStart: number,
  aSpan: number,
  bStart: number,
  bSpan: number,
): boolean {
  return aStart <= bStart + bSpan - 1 && bStart <= aStart + aSpan - 1;
}

export function freeUCount(rack: RackPreset, placements: Placement[]): number {
  return rack.totalU - occupiedUCount(rack, placements);
}

export function occupiedUCount(rack: RackPreset, placements: Placement[]): number {
  const grid = occupancyGrid(rack, placements);
  return grid.filter((entry) => entry !== null).length;
}

/** Largest contiguous run of free U slots, ignoring PDU clearance buffers. */
export function largestFreeRun(rack: RackPreset, reserved: Set<number>): number {
  let best = 0;
  let run = 0;
  for (let u = 1; u <= rack.totalU; u += 1) {
    if (reserved.has(u)) {
      run = 0;
    } else {
      run += 1;
      if (run > best) best = run;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* §2.1 Rail depth & mounting profiles                                 */
/* ------------------------------------------------------------------ */

/** Depth of a rail plane measured from the front reference plane. */
export function railPlaneMm(rack: RackPreset, rail: RailPosition): number {
  return rail === 'front' ? rack.frontRailOffsetMm : rack.rearRailOffsetMm;
}

/** Usable depth between the front and rear frame obstructions. */
export function internalDepthBounds(rack: RackPreset): [number, number] {
  return [rack.frontObstructionMm, rack.externalDepthMm - rack.rearObstructionMm];
}

export interface DepthEnvelope {
  /** Depth of the chassis front face from the front reference plane. */
  frontMm: number;
  /** Depth of the chassis rear face from the front reference plane. */
  rearMm: number;
  /** Rear face once the cord-bend allowance is included. */
  requiredRearMm: number;
  cordBendMm: number;
  rail: RailPosition;
  /** True when the envelope fits inside the enclosure with cords dressed. */
  fits: boolean;
  /** Positive when the envelope overruns the rear frame, in mm. */
  rearOverrunMm: number;
  /** Positive when the chassis protrudes through the front frame, in mm. */
  frontProtrusionMm: number;
  /** Gap between the chassis front face and the front rail plane. */
  recessGapMm: number;
}

/**
 * Depth footprint of a device mounted on a given rail, including the cord-bend
 * allowance behind its rear inlets.
 */
export function depthEnvelope(
  rack: RackPreset,
  spec: DeviceSpec,
  rail: RailPosition,
): DepthEnvelope {
  const railPlane = railPlaneMm(rack, rail);
  // Anything with an inlet dresses a cord out of its rear face — including PDUs,
  // which carry their own feed cord despite drawing no load themselves.
  const cordBendMm = spec.inlets.length > 0 ? cordBendDepthMm(primaryInlet(spec)) : 0;
  const frontMm =
    rail === 'front' ? railPlane : railPlane - spec.depthMm;
  const rearMm = rail === 'front' ? railPlane + spec.depthMm : railPlane;
  const requiredRearMm = rearMm + cordBendMm;
  const [minDepth, maxDepth] = internalDepthBounds(rack);

  return {
    frontMm,
    rearMm,
    requiredRearMm,
    cordBendMm,
    rail,
    rearOverrunMm: round6(Math.max(0, requiredRearMm - maxDepth)),
    frontProtrusionMm: round6(Math.max(0, minDepth - frontMm)),
    recessGapMm: round6(Math.max(0, frontMm - railPlaneMm(rack, 'front'))),
    fits:
      requiredRearMm <= maxDepth + 1e-9 && frontMm >= minDepth - 1e-9,
  };
}

/** True when two depth footprints on different rails physically interfere. */
export function depthEnvelopesOverlap(a: DepthEnvelope, b: DepthEnvelope): boolean {
  return a.frontMm < b.requiredRearMm - 1e-9 && b.frontMm < a.requiredRearMm - 1e-9;
}

/**
 * Vertical cord-bend buffer zones demanded by a horizontal PDU (PRD §2.2).
 * A PDU bolted at the bottom of the rack only buffers upward; one at the top only
 * buffers downward; one parked mid-rack needs clearance on both faces.
 */
export function clearanceZones(
  rack: RackPreset,
  spec: DeviceSpec,
  placement: Placement,
): { startU: number; endU: number; side: 'above' | 'below' }[] {
  if (spec.category !== 'pdu-horizontal') return [];
  const buffer = cordBendClearanceU(primaryInlet(spec));
  const top = placementTopU(placement);
  const zones: { startU: number; endU: number; side: 'above' | 'below' }[] = [];
  if (placement.startU > 1) {
    const startU = Math.max(1, placement.startU - buffer);
    zones.push({ startU, endU: placement.startU - 1, side: 'below' });
  }
  if (top < rack.totalU) {
    const endU = Math.min(rack.totalU, top + buffer);
    zones.push({ startU: top + 1, endU, side: 'above' });
  }
  return zones;
}

/** Every U slot reserved by PDU cord-bend buffers, keyed to the owning placement. */
export function clearanceReservationMap(
  rack: RackPreset,
  placements: Placement[],
  specOf: (specId: string) => DeviceSpec | undefined,
): Map<number, string> {
  const reserved = new Map<number, string>();
  for (const placement of placements) {
    if (placement.id.startsWith('v-')) continue;
    const spec = specOf(placement.specId);
    if (!spec) continue;
    for (const zone of clearanceZones(rack, spec, placement)) {
      for (let u = zone.startU; u <= zone.endU; u += 1) reserved.set(u, placement.id);
    }
  }
  return reserved;
}

/* ------------------------------------------------------------------ */
/* §2.4 Collision detection primitives                                 */
/* ------------------------------------------------------------------ */

/**
 * Validates one mounting request against the rack geometry and every other
 * placement. Empty array === safe to mount.
 */
export function validateRequest(
  rack: RackPreset,
  specOf: (specId: string) => DeviceSpec | undefined,
  placements: Placement[],
  request: PlacementRequest,
): Violation[] {
  const spec = specOf(request.specId);
  if (!spec) {
    return [{ code: 'OUT_OF_BOUNDS', severity: 'error', message: 'Unknown device specification.' }];
  }
  const violations: Violation[] = [];
  const { startU, spanU, rail, movingPlacementId } = request;

  if (!Number.isInteger(startU) || startU < 1 || startU + spanU - 1 > rack.totalU) {
    violations.push({
      code: 'OUT_OF_BOUNDS',
      severity: 'error',
      message: `Span U${startU}-U${startU + spanU - 1} falls outside the ${rack.totalU}U grid.`,
      uRange: [Math.max(1, startU), Math.min(rack.totalU, startU + spanU - 1)],
    });
  }
  if (spanU !== spec.heightU) {
    violations.push({
      code: 'OUT_OF_BOUNDS',
      severity: 'error',
      message: `Span of ${spanU}U does not match the ${spec.heightU}U nameplate height of ${spec.model}.`,
    });
  }
  if (!spec.rails.includes(rail)) {
    violations.push({
      code: 'RAIL_CONFLICT',
      severity: 'error',
      message: `${spec.model} may only be mounted on the ${spec.rails.join('/')} rail.`,
    });
  }

  const envelope = depthEnvelope(rack, spec, rail);
  if (envelope.rearOverrunMm > 0) {
    violations.push({
      code: 'DEPTH_EXCEEDED',
      severity: 'error',
      message:
        `${spec.model} needs ${round6(envelope.requiredRearMm)} mm of depth including a ` +
        `${envelope.cordBendMm} mm cord bend, exceeding the enclosure by ${round6(envelope.rearOverrunMm)} mm.`,
      uRange: [startU, startU + spanU - 1],
    });
  }
  if (envelope.frontProtrusionMm > 0) {
    violations.push({
      code: 'DEPTH_EXCEEDED',
      severity: 'error',
      message: `${spec.model} protrudes ${round6(envelope.frontProtrusionMm)} mm through the front frame.`,
      uRange: [startU, startU + spanU - 1],
    });
  }
  // Rear-only gear (PDUs, rear cable managers) is designed to sit back there; the
  // recess warning only applies to equipment that could have been front-mounted.
  if (rail === 'rear' && spec.rails.includes('front') && envelope.recessGapMm > 150) {
    violations.push({
      code: 'RECESS_RAIL_MISMATCH',
      severity: 'warning',
      message:
        `Rear-rail mounting leaves ${spec.model} ${round6(envelope.recessGapMm)} mm behind the front rail; ` +
        'front-panel access and blanking need verification.',
      uRange: [startU, startU + spanU - 1],
    });
  }

  const clearance = clearanceReservationMap(rack, placements.filter((p) => p.id !== movingPlacementId), specOf);
  for (let u = startU; u <= startU + spanU - 1; u += 1) {
    const owner = clearance.get(u);
    if (owner && owner !== movingPlacementId) {
      violations.push({
        code: 'CLEARANCE_BLOCKED',
        severity: 'warning',
        message: `U${u} sits inside a PDU cord-bend buffer; cable dressing will be obstructed.`,
        uRange: [u, u],
      });
      break;
    }
  }

  for (const other of placements) {
    if (other.id === movingPlacementId || other.instanceId === request.instanceId) continue;
    if (!uSpansOverlap(startU, spanU, other.startU, other.spanU)) continue;
    const overlap: [number, number] = [
      Math.max(startU, other.startU),
      Math.min(startU + spanU - 1, placementTopU(other)),
    ];
    const otherSpec = specOf(other.specId);
    if (!otherSpec) continue;

    if (other.rail === rail) {
      violations.push({
        code: 'U_OVERLAP',
        severity: 'error',
        message: `Overlaps ${otherSpec.model} on the ${rail} rail (U${overlap[0]}${overlap[0] === overlap[1] ? '' : `-U${overlap[1]}`}).`,
        uRange: overlap,
      });
      continue;
    }
    const mine = depthEnvelope(rack, spec, rail);
    const theirs = depthEnvelope(rack, otherSpec, other.rail);
    if (depthEnvelopesOverlap(mine, theirs)) {
      violations.push({
        code: 'RAIL_CONFLICT',
        severity: 'error',
        message:
          `Depth interference with ${otherSpec.model} mounted on the ${other.rail} rail at ` +
          `U${overlap[0]}${overlap[0] === overlap[1] ? '' : `-U${overlap[1]}`}.`,
        uRange: overlap,
      });
    }
  }

  return dedupeViolations(violations);
}

function dedupeViolations(violations: Violation[]): Violation[] {
  const seen = new Map<string, Violation>();
  for (const violation of violations) {
    const key = `${violation.code}|${violation.severity}|${violation.message}`;
    if (!seen.has(key)) seen.set(key, violation);
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ */
/* §2.2 Automated strategy engine                                      */
/* ------------------------------------------------------------------ */

export interface AutoPlacementOutcome {
  placements: Placement[];
  unplaced: { instanceId: string; model: string; reason: string }[];
}

let placementSeq = 0;
/** Deterministic placement ids: `pl-<n>` for horizontal, `vp-<n>` for vertical. */
export function nextPlacementId(prefix = 'pl'): string {
  placementSeq += 1;
  return `${prefix}-${placementSeq}`;
}

export function resetPlacementIds(): void {
  placementSeq = 0;
}

const FEEDS: FeedId[] = ['A', 'B'];

/**
 * Mounts every supplied instance according to the global strategy.
 *
 * Ordering rules (enterprise practice):
 *   - horizontal PDUs are placed first so their cord-bend buffers are reserved;
 *   - with CENTER, the PDU pair splits to opposite extremes, which is how dual-feed
 *     horizontal PDUs are normally dressed;
 *   - devices are then placed heaviest-lowest for rack stability.
 */
export function autoPlace(
  rack: RackPreset,
  instances: DeviceInstance[],
  specOf: (specId: string) => DeviceSpec | undefined,
  strategy: PlacementStrategy,
): AutoPlacementOutcome {
  const placements: Placement[] = [];
  const unplaced: AutoPlacementOutcome['unplaced'] = [];

  const horizontals = instances.filter((i) => specOf(i.specId)?.category === 'pdu-horizontal');
  const devices = instances
    .filter((i) => {
      const spec = specOf(i.specId);
      return spec && spec.category !== 'pdu-horizontal' && spec.category !== 'pdu-vertical';
    })
    .sort((a, b) => {
      const sa = specOf(a.specId)!;
      const sb = specOf(b.specId)!;
      if (sa.weightKg !== sb.weightKg) return sb.weightKg - sa.weightKg;
      if (sa.depthMm !== sb.depthMm) return sb.depthMm - sa.depthMm;
      return sa.model.localeCompare(sb.model);
    });

  const reserved = new Set<number>();

  const pduOrder = strategy === 'TOP' ? [...horizontals].reverse() : horizontals;
  pduOrder.forEach((instance, index) => {
    const spec = specOf(instance.specId)!;
    const feed = FEEDS[index % FEEDS.length];
    const rail = spec.rails[0];
    const anchor = pduAnchor(strategy, index, spec.heightU, rack, reserved);
    if (anchor === null) {
      unplaced.push({ instanceId: instance.uid, model: spec.model, reason: 'No free U slot for a horizontal PDU.' });
      return;
    }
    const placement: Placement = {
      id: nextPlacementId(),
      instanceId: instance.uid,
      specId: spec.id,
      startU: anchor,
      spanU: spec.heightU,
      rail,
      feed,
      circuitLabel: rack.branchCircuitLabel[feed],
    };
    if (!placePlacement(rack, spec, placement, reserved)) {
      unplaced.push({ instanceId: instance.uid, model: spec.model, reason: 'PDU cord-bend buffer has nowhere to go.' });
      return;
    }
    placements.push(placement);
  });

  const ordered = strategy === 'TOP' ? [...devices].reverse() : devices;
  let cursor = strategy === 'BOTTOM' ? 1 : rack.totalU;

  for (const instance of ordered) {
    const spec = specOf(instance.specId)!;
    const rail = spec.rails[0];
    const startU = findAnchor(rack, spec.heightU, strategy, cursor, reserved, placements);
    if (startU === null) {
      unplaced.push({
        instanceId: instance.uid,
        model: spec.model,
        reason: `No contiguous ${spec.heightU}U gap remains on the ${rail} rail.`,
      });
      continue;
    }
    const placement: Placement = {
      id: nextPlacementId(),
      instanceId: instance.uid,
      specId: spec.id,
      startU,
      spanU: spec.heightU,
      rail,
    };
    if (!placePlacement(rack, spec, placement, reserved)) {
      unplaced.push({
        instanceId: instance.uid,
        model: spec.model,
        reason: `${spec.model} does not fit the enclosure depth at ${rail} rail.`,
      });
      continue;
    }
    placements.push(placement);
    cursor = strategy === 'BOTTOM' ? placement.startU + placement.spanU : placement.startU - 1;
  }

  placements.sort((a, b) => a.startU - b.startU);
  return { placements, unplaced };
}

function pduAnchor(
  strategy: PlacementStrategy,
  index: number,
  spanU: number,
  rack: RackPreset,
  reserved: Set<number>,
): number | null {
  if (strategy === 'BOTTOM') return firstFreeFrom(1, rack.totalU, spanU, reserved);
  if (strategy === 'TOP') return lastFreeFrom(1, rack.totalU, spanU, reserved);
  // CENTER: split the PDU pair to opposite extremes so both cords can dress straight.
  return index % 2 === 0
    ? firstFreeFrom(1, rack.totalU, spanU, reserved)
    : lastFreeFrom(1, rack.totalU, spanU, reserved);
}

function findAnchor(
  rack: RackPreset,
  spanU: number,
  strategy: PlacementStrategy,
  cursor: number,
  reserved: Set<number>,
  placements: Placement[],
): number | null {
  if (strategy === 'BOTTOM') return firstFreeFrom(Math.max(1, cursor), rack.totalU, spanU, reserved);
  if (strategy === 'TOP') return lastFreeFrom(1, Math.min(rack.totalU, cursor), spanU, reserved);

  const used = new Set(reserved);
  for (const placement of placements) {
    for (let u = placement.startU; u <= placementTopU(placement); u += 1) used.add(u);
  }
  const centre = Math.floor((rack.totalU - spanU) / 2) + 1;
  // Expand outward from the mid-rack anchor, keeping the block centred.
  for (let offset = 0; offset <= rack.totalU; offset += 1) {
    for (const candidate of offset === 0 ? [centre] : [centre + offset, centre - offset]) {
      if (candidate < 1 || candidate + spanU - 1 > rack.totalU) continue;
      if (isFree(candidate, spanU, used)) return candidate;
    }
  }
  return null;
}

function firstFreeFrom(
  from: number,
  to: number,
  spanU: number,
  reserved: Set<number>,
): number | null {
  for (let startU = from; startU + spanU - 1 <= to; startU += 1) {
    if (isFree(startU, spanU, reserved)) return startU;
  }
  return null;
}

function lastFreeFrom(
  from: number,
  to: number,
  spanU: number,
  reserved: Set<number>,
): number | null {
  for (let startU = to - spanU + 1; startU >= from; startU -= 1) {
    if (isFree(startU, spanU, reserved)) return startU;
  }
  return null;
}

function isFree(startU: number, spanU: number, reserved: Set<number>): boolean {
  for (let u = startU; u <= startU + spanU - 1; u += 1) {
    if (reserved.has(u)) return false;
  }
  return true;
}

/** Commits a placement into the reserved slot set; false when it cannot be mounted. */
function placePlacement(
  rack: RackPreset,
  spec: DeviceSpec,
  placement: Placement,
  reserved: Set<number>,
): boolean {
  const violations = validateRequest(rack, (id) => (id === spec.id ? spec : undefined), [], {
    instanceId: placement.instanceId,
    specId: spec.id,
    startU: placement.startU,
    spanU: placement.spanU,
    rail: placement.rail,
  });
  if (violations.some((v) => v.severity === 'error')) return false;
  if (!isFree(placement.startU, placement.spanU, reserved)) return false;

  for (let u = placement.startU; u <= placementTopU(placement); u += 1) reserved.add(u);
  for (const zone of clearanceZones(rack, spec, placement)) {
    for (let u = zone.startU; u <= zone.endU; u += 1) reserved.add(u);
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* §2.3 Vertical (zero-U) PDU channel packing                          */
/* ------------------------------------------------------------------ */

/** Usable length of one rear vertical channel, in mm. */
export function channelCapacityMm(rack: RackPreset): number {
  return round6(rack.totalU * MM_PER_U - CHANNEL_ENTRY_OBSTRUCTION_MM * 2);
}

export interface ChannelPackingResult {
  placements: VerticalPlacement[];
  unplaced: { instanceId: string; model: string; reason: string }[];
  /** Aggregate used length per channel, mm. */
  usedMm: Record<Channel, number>;
}

/**
 * Packs zero-U vertical PDUs into the left and right rear cable channels.
 * Longest strips are placed first, balanced onto the emptier channel, then parked
 * bottom-up. A strip is rejected when no channel can host it (PRD §2.3).
 */
export function packVerticalPdus(
  rack: RackPreset,
  instances: DeviceInstance[],
  specOf: (specId: string) => DeviceSpec | undefined,
  existing: VerticalPlacement[] = [],
): ChannelPackingResult {
  const capacity = channelCapacityMm(rack);
  const used: Record<Channel, number> = { left: 0, right: 0 };
  const segments: Record<Channel, { startMm: number; endMm: number }[]> = { left: [], right: [] };

  for (const placement of existing) {
    const endMm = placement.startMm + placement.lengthMm;
    used[placement.channel] += placement.lengthMm;
    segments[placement.channel].push({ startMm: placement.startMm, endMm });
  }

  const placements: VerticalPlacement[] = [...existing];
  const unplaced: ChannelPackingResult['unplaced'] = [];

  const strips = instances
    .map((instance) => ({ instance, spec: specOf(instance.specId) }))
    .filter((entry): entry is { instance: DeviceInstance; spec: DeviceSpec } => entry.spec?.category === 'pdu-vertical')
    .sort((a, b) => (b.spec.lengthMm ?? 0) - (a.spec.lengthMm ?? 0));

  strips.forEach(({ instance, spec }, index) => {
    const lengthMm = spec.lengthMm ?? 0;
    if (lengthMm <= 0 || lengthMm > capacity) {
      unplaced.push({
        instanceId: instance.uid,
        model: spec.model,
        reason: `${lengthMm} mm strip exceeds the ${capacity} mm channel capacity.`,
      });
      return;
    }
    const channels: Channel[] = used.left <= used.right ? ['left', 'right'] : ['right', 'left'];
    let parked = false;
    for (const channel of channels) {
      if (used[channel] + lengthMm > capacity + 1e-9) continue;
      const startMm = nextChannelSlot(segments[channel], capacity, lengthMm);
      if (startMm === null) continue;
      const feed = FEEDS[index % FEEDS.length];
      placements.push({
        id: nextPlacementId('vp'),
        instanceId: instance.uid,
        specId: spec.id,
        channel,
        startMm,
        lengthMm,
        feed,
        circuitLabel: rack.branchCircuitLabel[feed],
      });
      used[channel] += lengthMm;
      segments[channel].push({ startMm, endMm: startMm + lengthMm });
      parked = true;
      break;
    }
    if (!parked) {
      unplaced.push({
        instanceId: instance.uid,
        model: spec.model,
        reason: 'Both rear channels are full; aggregate strip length exceeds rack height.',
      });
    }
  });

  return { placements, unplaced, usedMm: used };
}

function nextChannelSlot(
  segments: { startMm: number; endMm: number }[],
  capacity: number,
  lengthMm: number,
): number | null {
  const sorted = [...segments].sort((a, b) => a.startMm - b.startMm);
  let cursor = 0;
  for (const segment of sorted) {
    if (segment.startMm - cursor >= lengthMm) return cursor;
    cursor = Math.max(cursor, segment.endMm);
  }
  return capacity - cursor >= lengthMm ? cursor : null;
}

/** Validates manually overridden vertical PDUs: overlap + aggregate height limits. */
export function validateVerticals(
  rack: RackPreset,
  verticals: VerticalPlacement[],
  specOf: (specId: string) => DeviceSpec | undefined,
): Violation[] {
  const violations: Violation[] = [];
  const capacity = channelCapacityMm(rack);
  const byChannel: Record<Channel, VerticalPlacement[]> = { left: [], right: [] };

  for (const vertical of verticals) {
    if (vertical.startMm < 0 || vertical.startMm + vertical.lengthMm > capacity + 1e-9) {
      violations.push({
        code: 'CHANNEL_OVERFLOW',
        severity: 'error',
        message: `${specOf(vertical.specId)?.model ?? 'Vertical PDU'} runs ${round6(
          Math.max(0, vertical.startMm + vertical.lengthMm - capacity),
        )} mm past the ${vertical.channel} channel limit of ${capacity} mm.`,
      });
    }
    byChannel[vertical.channel].push(vertical);
  }

  for (const channel of ['left', 'right'] as Channel[]) {
    const list = byChannel[channel].sort((a, b) => a.startMm - b.startMm);
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const cur = list[i];
      if (cur.startMm < prev.startMm + prev.lengthMm - 1e-9) {
        violations.push({
          code: 'CHANNEL_OVERLAP',
          severity: 'error',
          message:
            `${specOf(cur.specId)?.model ?? 'Vertical PDU'} overlaps ${specOf(prev.specId)?.model ?? 'another strip'} ` +
            `in the ${channel} channel.`,
        });
      }
    }
    const total = list.reduce((sum, v) => sum + v.lengthMm, 0);
    if (total > capacity + 1e-9) {
      violations.push({
        code: 'CHANNEL_OVERFLOW',
        severity: 'error',
        message: `${channel} channel aggregate is ${round6(total)} mm, over the ${capacity} mm internal height limit.`,
      });
    }
    const widest = list.reduce((max, v) => Math.max(max, specOf(v.specId)?.depthMm ?? 0), 0);
    if (widest > rack.zeroUChannelWidthMm) {
      violations.push({
        code: 'CHANNEL_WIDTH',
        severity: 'warning',
        message:
          `A ${widest} mm wide strip in the ${channel} channel leaves no bend radius beside it ` +
          `(channel width ${rack.zeroUChannelWidthMm} mm).`,
      });
    }
  }

  return violations;
}

/** Lowest U slot a device can be mounted into without an error-level conflict. */
export function findMountSlot(
  rack: RackPreset,
  specOf: (specId: string) => DeviceSpec | undefined,
  placements: Placement[],
  instanceId: string,
  spec: DeviceSpec,
  rail: RailPosition,
): number | null {
  for (let startU = 1; startU + spec.heightU - 1 <= rack.totalU; startU += 1) {
    const violations = validateRequest(rack, specOf, placements, {
      instanceId,
      specId: spec.id,
      startU,
      spanU: spec.heightU,
      rail,
    });
    if (!violations.some((violation) => violation.severity === 'error')) return startU;
  }
  return null;
}

/** Human label for a U span, e.g. "U12-U13" or "U12". */
export function uSpanLabel(startU: number, spanU: number): string {
  const top = startU + spanU - 1;
  return startU === top ? `U${startU}` : `U${startU}-U${top}`;
}
