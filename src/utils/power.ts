/**
 * Dual-feed power distribution model (PRD §2.2 / §3.3).
 *
 * Redundant-PSU devices are wired PSU-1 → Feed A, PSU-2 → Feed B, PSU-3 → Feed A …
 * so a single loss of utility feed never drops the equipment. Outlet capacity per
 * PDU and branch capacity per feed are tracked for the diagnostics engine.
 */

import type {
  DeviceSpec,
  Diagnostic,
  FeedId,
  InletType,
  Placement,
  RackPreset,
  VerticalPlacement,
} from '../types/rack';
import { placementTopU, uSpanLabel } from './placement';

export type OutletKind = 'c13' | 'c19';
export type ConnectionTarget = OutletKind | 'branch';

export interface PowerConnection {
  placementId: string;
  psuIndex: number;
  feed: FeedId;
  inlet: InletType;
  target: ConnectionTarget;
  /** Placement id of the horizontal/vertical PDU serving this PSU, when any. */
  pduPlacementId: string | null;
  watts: number;
}

export interface PduNode {
  id: string;
  specId: string;
  feed?: FeedId;
  kind: 'horizontal' | 'vertical';
  label: string;
  outlets: { c13: number; c19: number };
  used: { c13: number; c19: number };
}

export interface PowerModel {
  connections: PowerConnection[];
  pdus: PduNode[];
  loadW: Record<FeedId, number>;
  capacityW: Record<FeedId, number>;
  /** PSUs that could not be served by a PDU on their intended feed. */
  starved: { placementId: string; psuIndex: number; feed: FeedId; reason: 'no-pdu' | 'no-outlet' }[];
}

const FEEDS: FeedId[] = ['A', 'B'];

/** Which PDU outlet an inlet can be dressed into (IEC-309 draws a dedicated branch). */
export function outletForInlet(inlet: InletType): ConnectionTarget {
  switch (inlet) {
    case 'C14':
      return 'c13';
    case 'C20':
      return 'c19';
    case 'IEC-309-32A':
    case 'IEC-309-63A':
    case 'HARDWIRED':
      return 'branch';
  }
}

function isLoadBearing(spec: DeviceSpec): boolean {
  if (spec.category === 'pdu-horizontal' || spec.category === 'pdu-vertical') return false;
  return spec.psuCount > 0 && spec.powerDrawW > 0;
}

/** Resolves every device PSU to a feed and a specific PDU outlet. */
export function buildPowerModel(
  rack: RackPreset,
  placements: Placement[],
  verticals: VerticalPlacement[],
  specOf: (specId: string) => DeviceSpec | undefined,
): PowerModel {
  const pdus: PduNode[] = [];

  for (const placement of placements) {
    const spec = specOf(placement.specId);
    if (!spec || spec.category !== 'pdu-horizontal') continue;
    pdus.push({
      id: placement.id,
      specId: spec.id,
      feed: placement.feed,
      kind: 'horizontal',
      label: `${spec.model} · ${uSpanLabel(placement.startU, placement.spanU)} · ${placement.rail} rail`,
      outlets: { c13: spec.outlets?.c13 ?? 0, c19: spec.outlets?.c19 ?? 0 },
      used: { c13: 0, c19: 0 },
    });
  }

  for (const vertical of verticals) {
    const spec = specOf(vertical.specId);
    if (!spec || spec.category !== 'pdu-vertical') continue;
    pdus.push({
      id: vertical.id,
      specId: spec.id,
      feed: vertical.feed,
      kind: 'vertical',
      label: `${spec.model} · zero-U ${vertical.channel} channel`,
      outlets: { c13: spec.outlets?.c13 ?? 0, c19: spec.outlets?.c19 ?? 0 },
      used: { c13: 0, c19: 0 },
    });
  }

  const connections: PowerConnection[] = [];
  const starved: PowerModel['starved'] = [];
  const loadW: Record<FeedId, number> = { A: 0, B: 0 };

  const devices = placements
    .filter((placement) => {
      const spec = specOf(placement.specId);
      return spec ? isLoadBearing(spec) : false;
    })
    .sort((a, b) => a.startU - b.startU);

  for (const placement of devices) {
    const spec = specOf(placement.specId)!;
    const perPsuWatts = spec.powerDrawW / Math.max(1, spec.psuCount);
    for (let psuIndex = 0; psuIndex < spec.psuCount; psuIndex += 1) {
      const inlet = spec.inlets[psuIndex] ?? 'C14';
      const feed = FEEDS[psuIndex % FEEDS.length];
      const target = outletForInlet(inlet);
      const pdu =
        target === 'branch' ? null : pickPdu(pdus, feed, target);

      if (target !== 'branch' && pdu) {
        pdu.used[target] += 1;
      } else if (target !== 'branch') {
        starved.push({
          placementId: placement.id,
          psuIndex,
          feed,
          reason: pdus.some((candidate) => candidate.feed === feed) ? 'no-outlet' : 'no-pdu',
        });
      }

      loadW[feed] += perPsuWatts;
      connections.push({
        placementId: placement.id,
        psuIndex,
        feed,
        inlet,
        target,
        pduPlacementId: pdu?.id ?? null,
        watts: perPsuWatts,
      });
    }
  }

  return {
    connections,
    pdus,
    loadW: { A: round1(loadW.A), B: round1(loadW.B) },
    capacityW: { ...rack.feedCapacityW },
    starved,
  };
}

/** Chooses the least-loaded PDU on the feed that still has a matching outlet. */
function pickPdu(pdus: PduNode[], feed: FeedId, outlet: OutletKind): PduNode | null {
  let best: PduNode | null = null;
  let bestFree = -1;
  for (const pdu of pdus) {
    if (pdu.feed !== feed) continue;
    const free = pdu.outlets[outlet] - pdu.used[outlet];
    if (free <= 0) continue;
    if (free > bestFree) {
      best = pdu;
      bestFree = free;
    }
  }
  return best;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Capacity diagnostics for feed load, outlet exhaustion and feed imbalance. */
export function powerDiagnostics(rack: RackPreset, model: PowerModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const push = (diagnostic: Omit<Diagnostic, 'id'>) => {
    const key = `${diagnostic.code}|${diagnostic.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push({ id: key, ...diagnostic });
  };

  for (const feed of FEEDS) {
    const load = model.loadW[feed];
    const capacity = model.capacityW[feed];
    if (capacity <= 0) continue;
    const ratio = load / capacity;
    if (ratio > 1) {
      push({
        code: 'FEED_OVERLOAD',
        severity: 'error',
        message: `Feed ${feed} load is ${round1(load)} W, ${round1(ratio * 100 - 100)}% over its ${capacity} W branch capacity (${rack.branchCircuitLabel[feed]}).`,
        subject: `Feed ${feed}`,
        placementIds: [],
      });
    } else if (ratio > 0.8) {
      push({
        code: 'FEED_OVERLOAD',
        severity: 'warning',
        message: `Feed ${feed} is at ${round1(ratio * 100)}% of ${capacity} W; reserve headroom for cord and derating losses.`,
        subject: `Feed ${feed}`,
        placementIds: [],
      });
    }
  }

  const total = model.loadW.A + model.loadW.B;
  if (total > 0) {
    const imbalance = Math.abs(model.loadW.A - model.loadW.B) / total;
    if (imbalance > 0.3) {
      push({
        code: 'FEED_IMBALANCE',
        severity: 'warning',
        message: `Dual feeds are unbalanced by ${round1(imbalance * 100)}% (A ${round1(model.loadW.A)} W / B ${round1(model.loadW.B)} W).`,
        subject: 'Feed balance',
        placementIds: [],
      });
    }
  }

  for (const pdu of model.pdus) {
    const demand = model.connections.filter((connection) => connection.pduPlacementId === pdu.id);
    if (demand.length === 0) {
      push({
        code: 'UNPOWERED',
        severity: 'info',
        message: `${pdu.label} has no PSU drops yet; nothing is drawing from it.`,
        subject: pdu.label,
        placementIds: [pdu.id],
      });
    }
  }

  if (model.pdus.length === 0) {
    const poweredDevices = new Set(model.connections.map((connection) => connection.placementId));
    if (poweredDevices.size > 0) {
      push({
        code: 'UNPOWERED',
        severity: 'info',
        message: `${poweredDevices.size} powered ${poweredDevices.size === 1 ? 'unit needs' : 'units need'} a PDU: no strip is mounted, so distribution is not modelled yet.`,
        subject: 'Power distribution',
        placementIds: [],
      });
    }
    return diagnostics;
  }

  const byReason: Record<'no-outlet' | 'no-pdu', Map<FeedId, number>> = {
    'no-outlet': new Map(),
    'no-pdu': new Map(),
  };
  for (const entry of model.starved) {
    const bucket = byReason[entry.reason];
    bucket.set(entry.feed, (bucket.get(entry.feed) ?? 0) + 1);
  }
  for (const [feed, count] of byReason['no-outlet']) {
    push({
      code: 'OUTLET_EXHAUSTED',
      severity: 'warning',
      message: `${count} PSU${count === 1 ? '' : 's'} found no free outlet on Feed ${feed}; add a PDU or move load to the other strip.`,
      subject: `Feed ${feed}`,
      placementIds: [],
    });
  }
  for (const [feed, count] of byReason['no-pdu']) {
    push({
      code: 'SINGLE_FEED',
      severity: 'error',
      message: `No PDU is energised from Feed ${feed}: ${count} PSU${count === 1 ? '' : 's'} would run single-feed.`,
      subject: `Feed ${feed}`,
      placementIds: [],
    });
  }

  return diagnostics;
}

/** Feed label used across the visualisations. */
export function feedColor(feed: FeedId): string {
  return feed === 'A' ? '#e0653f' : '#3f8fe0';
}

export function describePlacement(
  placement: Placement,
  specOf: (specId: string) => DeviceSpec | undefined,
): string {
  const spec = specOf(placement.specId);
  if (!spec) return placement.id;
  return `${spec.vendor} ${spec.model} (${uSpanLabel(placement.startU, placement.spanU)} ${placement.rail})`;
}

export function placementRange(placement: Placement): [number, number] {
  return [placement.startU, placementTopU(placement)];
}
