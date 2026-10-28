/** Dual-feed distribution, outlet exhaustion and branch capacity. */

import { describe, expect, it } from 'vitest';
import { DEFAULT_RACK_ID, presetById } from '../../data/racks';
import { specOf } from '../../data/catalogue';
import { buildPowerModel, outletForInlet, powerDiagnostics } from '../power';
import type { Placement, VerticalPlacement } from '../../types/rack';

const rack = presetById(DEFAULT_RACK_ID);

function horizontal(
  id: string,
  specId: string,
  startU: number,
  feed: 'A' | 'B',
): Placement {
  const spec = specOf(specId)!;
  return { id, instanceId: `${specId}#${startU}`, specId, startU, spanU: spec.heightU, rail: 'rear', feed };
}

function device(id: string, specId: string, startU: number): Placement {
  const spec = specOf(specId)!;
  return { id, instanceId: `${specId}#${startU}`, specId, startU, spanU: spec.heightU, rail: 'front' };
}

describe('§2.2 inlet → outlet mapping', () => {
  it('maps C14 to C13 and C20 to C19, with IEC-309 landing on the branch', () => {
    expect(outletForInlet('C14')).toBe('c13');
    expect(outletForInlet('C20')).toBe('c19');
    expect(outletForInlet('IEC-309-32A')).toBe('branch');
    expect(outletForInlet('IEC-309-63A')).toBe('branch');
    expect(outletForInlet('HARDWIRED')).toBe('branch');
  });
});

describe('dual-feed PSU distribution', () => {
  const placements = [
    horizontal('pduA', 'pdu-h-32a', 1, 'A'),
    horizontal('pduB', 'pdu-h-32a', 2, 'B'),
    device('srv1', 'srv-2u-dual', 10),
    device('edge1', 'srv-1u-edge', 12),
    device('blade1', 'srv-5u-blade', 14),
  ];
  const model = buildPowerModel(rack, placements, [], specOf);

  it('wires PSU-1 to Feed A and PSU-2 to Feed B', () => {
    const psus = model.connections.filter((connection) => connection.placementId === 'srv1');
    expect(psus).toHaveLength(2);
    expect(psus[0].feed).toBe('A');
    expect(psus[0].pduPlacementId).toBe('pduA');
    expect(psus[1].feed).toBe('B');
    expect(psus[1].pduPlacementId).toBe('pduB');
  });

  it('splits a device draw evenly across its PSUs', () => {
    const psus = model.connections.filter((connection) => connection.placementId === 'srv1');
    expect(psus[0].watts).toBe(400);
    expect(psus[1].watts).toBe(400);
  });

  it('terminates IEC-309 inlets straight on the branch circuit', () => {
    const blade = model.connections.filter((connection) => connection.placementId === 'blade1');
    expect(blade.filter((connection) => connection.target === 'branch')).toHaveLength(2);
    expect(blade.every((connection) => connection.inlet.length > 0)).toBe(true);
  });

  it('balances feed load totals', () => {
    const serverWatts = 800 / 2 + 350 + (3200 / 4) * 2;
    expect(model.loadW.A).toBeCloseTo(serverWatts, 4);
    expect(Math.abs(model.loadW.A - model.loadW.B)).toBeLessThanOrEqual(350);
  });

  it('reports single-feed exposure when a feed has no PDU', () => {
    const oneFeed = [horizontal('pduA', 'pdu-h-32a', 1, 'A'), device('srv1', 'srv-2u-dual', 10)];
    const modelSingle = buildPowerModel(rack, oneFeed, [], specOf);
    expect(modelSingle.starved).toHaveLength(1);
    expect(modelSingle.starved[0].reason).toBe('no-pdu');
    const diagnostics = powerDiagnostics(rack, modelSingle);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('SINGLE_FEED');
  });

  it('flags exhausted outlets once the PDU bank runs dry', () => {
    const placements = [
      horizontal('pduA', 'pdu-h-c20', 1, 'A'),
      horizontal('pduB', 'pdu-h-c20', 2, 'B'),
      ...Array.from({ length: 20 }, (_, index) => device(`edge${index}`, 'srv-1u-edge', 10 + index)),
    ];
    const model = buildPowerModel(rack, placements, [], specOf);
    // srv-1u-edge is single-PSU (Feed A) and the HP16 strip carries 14 C13 outlets.
    expect(model.starved.filter((entry) => entry.reason === 'no-outlet').length).toBe(6);
    const diagnostics = powerDiagnostics(rack, model);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('OUTLET_EXHAUSTED');
  });

  it('errors when a branch is asked to carry more than its rating', () => {
    const placements = [
      horizontal('pduA', 'pdu-h-32a', 1, 'A'),
      horizontal('pduB', 'pdu-h-32a', 2, 'B'),
      ...Array.from({ length: 18 }, (_, index) => device(`srv${index}`, 'srv-2u-dual', 4 + index * 2)),
    ];
    const model = buildPowerModel(rack, placements, [], specOf);
    expect(model.loadW.A).toBeGreaterThan(rack.feedCapacityW.A);
    const overload = powerDiagnostics(rack, model).find((diagnostic) => diagnostic.code === 'FEED_OVERLOAD');
    expect(overload?.severity).toBe('error');
  });

  it('warns when the two feeds are badly unbalanced', () => {
    // Single-PSU gear always lands on Feed A, which is exactly how imbalance appears.
    const placements = [
      horizontal('pduA', 'pdu-h-32a', 1, 'A'),
      horizontal('pduB', 'pdu-h-32a', 2, 'B'),
      ...Array.from({ length: 4 }, (_, index) => device(`edge${index}`, 'srv-1u-edge', 4 + index)),
      device('dual1', 'srv-2u-dual', 10),
    ];
    const model = buildPowerModel(rack, placements, [], specOf);
    expect(model.loadW.A).toBeGreaterThan(model.loadW.B * 2);
    const diagnostics = powerDiagnostics(rack, model);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('FEED_IMBALANCE');
  });

  it('counts zero-U strips as PDU sources', () => {
    const verticals: VerticalPlacement[] = [
      { id: 'vp1', instanceId: 'v1', specId: 'pdu-v-42u', channel: 'left', startMm: 0, lengthMm: 1780, feed: 'A' },
      { id: 'vp2', instanceId: 'v2', specId: 'pdu-v-42u', channel: 'right', startMm: 0, lengthMm: 1780, feed: 'B' },
    ];
    const model = buildPowerModel(rack, [device('srv1', 'srv-2u-dual', 10)], verticals, specOf);
    expect(model.pdus.map((pdu) => pdu.kind).sort()).toEqual(['vertical', 'vertical']);
    const psus = model.connections.filter((connection) => connection.placementId === 'srv1');
    expect(psus[0].pduPlacementId).toBe('vp1');
    expect(psus[1].pduPlacementId).toBe('vp2');
  });

  it('ignores passive and blank panels', () => {
    const model = buildPowerModel(
      rack,
      [device('blank', 'blank-1u', 30), device('patch', 'pp-1u-48', 31)],
      [],
      specOf,
    );
    expect(model.connections).toHaveLength(0);
  });
});
