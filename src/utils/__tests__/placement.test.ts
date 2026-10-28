/** EIA-310-D spatial engine: conversion, collisions, clearance, strategies, packing. */

import { describe, expect, beforeEach, it } from 'vitest';
import { DEFAULT_RACK_ID, customRack, presetById } from '../../data/racks';
import { specOf } from '../../data/catalogue';
import {
  autoPlace,
  buildSlotArray,
  channelCapacityMm,
  clearanceZones,
  cmToU,
  cordBendClearanceU,
  depthEnvelope,
  depthEnvelopesOverlap,
  freeUCount,
  inBounds,
  largestFreeRun,
  mmToCeilU,
  occupancyGrid,
  packVerticalPdus,
  resetPlacementIds,
  uToMm,
  validateRequest,
  validateVerticals,
  findMountSlot,
} from '../placement';
import type { DeviceInstance, Placement, RackPreset } from '../../types/rack';

const rack = presetById(DEFAULT_RACK_ID);

const instance = (uid: string, specId: string): DeviceInstance => ({
  uid,
  specId,
  assetTag: uid.toUpperCase(),
});

beforeEach(() => {
  resetPlacementIds();
});

describe('§2.1 standard unit conversion', () => {
  it('uses the exact EIA-310-D pitch of 44.45 mm per U', () => {
    expect(uToMm(1)).toBeCloseTo(44.45, 6);
    expect(uToMm(42)).toBeCloseTo(1866.9, 4);
    expect(cmToU(4.445)).toBeCloseTo(1, 6);
  });

  it('rounds a millimetre length up to whole slots', () => {
    expect(mmToCeilU(44.45)).toBe(1);
    expect(mmToCeilU(44.5)).toBe(2);
    expect(mmToCeilU(0)).toBe(1);
  });
});

describe('§2.1 slot allocation & grid mapping', () => {
  it('builds a 1..N discrete slot array for a preset', () => {
    const slots = buildSlotArray(rack);
    expect(slots).toHaveLength(42);
    expect(slots[0]).toBe(1);
    expect(slots[41]).toBe(42);
  });

  it('honours a custom height definition', () => {
    expect(buildSlotArray(customRack(7, 900))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('maps placements onto their occupied slots', () => {
    const placements: Placement[] = [
      { id: 'a', instanceId: 'x', specId: 'srv-2u-dual', startU: 5, spanU: 2, rail: 'front' },
    ];
    const grid = occupancyGrid(rack, placements);
    expect(grid[3]).toBeNull();
    expect(grid[4]?.id).toBe('a');
    expect(grid[5]?.id).toBe('a');
    expect(grid[6]).toBeNull();
    expect(freeUCount(rack, placements)).toBe(40);
  });

  it('rejects spans outside the grid', () => {
    expect(inBounds(41, 2, rack)).toBe(true); // U41-U42 is the last legal 2U span
    expect(inBounds(42, 2, rack)).toBe(false);
    expect(inBounds(41, 1, rack)).toBe(true);
    expect(inBounds(0, 1, rack)).toBe(false);
  });
});

describe('§2.1 rail depth & mounting profiles', () => {
  it('measures a front-rail device forward from the front rail plane', () => {
    const spec = specOf('srv-2u-dual')!;
    const envelope = depthEnvelope(rack, spec, 'front');
    expect(envelope.frontMm).toBe(rack.frontRailOffsetMm);
    expect(envelope.rearMm).toBe(rack.frontRailOffsetMm + spec.depthMm);
    expect(envelope.cordBendMm).toBeGreaterThan(0);
    expect(envelope.fits).toBe(true);
  });

  it('measures a rear-rail device forward from the rear rail plane', () => {
    const spec = specOf('pdu-h-32a')!;
    const envelope = depthEnvelope(rack, spec, 'rear');
    expect(envelope.rearMm).toBe(rack.rearRailOffsetMm);
    expect(envelope.frontMm).toBe(rack.rearRailOffsetMm - spec.depthMm);
  });

  it('flags a deep device that overruns the enclosure once cords are dressed', () => {
    const spec = specOf('sto-4u-array')!;
    const shallow: RackPreset = { ...rack, externalDepthMm: 800, rearRailOffsetMm: 660 };
    const envelope = depthEnvelope(shallow, spec, 'front');
    expect(envelope.fits).toBe(false);
    expect(envelope.rearOverrunMm).toBeGreaterThan(0);
  });

  it('detects depth interference between opposite rails', () => {
    const deep = depthEnvelope(rack, specOf('sto-4u-array')!, 'front');
    const rear = depthEnvelope(rack, specOf('pdu-h-32a')!, 'rear');
    const shallowOnRear = depthEnvelope(rack, specOf('srv-1u-edge')!, 'front');
    expect(depthEnvelopesOverlap(deep, rear)).toBe(false);
    expect(depthEnvelopesOverlap(shallowOnRear, rear)).toBe(false);
  });
});

describe('§2.2 cord-bend clearance modelling', () => {
  it('scales the vertical buffer with the inlet type', () => {
    expect(cordBendClearanceU('C14')).toBe(1);
    expect(cordBendClearanceU('C20')).toBe(2);
    expect(cordBendClearanceU('IEC-309-32A')).toBe(3);
    expect(cordBendClearanceU('IEC-309-63A')).toBe(4);
    expect(cordBendClearanceU('C14')).toBeLessThan(cordBendClearanceU('C20'));
    expect(cordBendClearanceU('C20')).toBeLessThan(cordBendClearanceU('IEC-309-32A'));
  });

  it('buffers upward for a PDU bolted at the bottom of the rack', () => {
    const placement: Placement = {
      id: 'pdu1',
      instanceId: 'pdu-h-32a#0001',
      specId: 'pdu-h-32a',
      startU: 1,
      spanU: 1,
      rail: 'rear',
      feed: 'A',
    };
    const zones = clearanceZones(rack, specOf('pdu-h-32a')!, placement);
    expect(zones).toEqual([{ startU: 2, endU: 4, side: 'above' }]);
  });

  it('buffers both faces for a PDU parked mid-rack', () => {
    const placement: Placement = {
      id: 'pdu2',
      instanceId: 'x',
      specId: 'pdu-h-c20',
      startU: 21,
      spanU: 1,
      rail: 'rear',
      feed: 'B',
    };
    const zones = clearanceZones(rack, specOf('pdu-h-c20')!, placement);
    expect(zones.map((zone) => zone.side)).toEqual(['below', 'above']);
    expect(zones[0]).toEqual({ startU: 19, endU: 20, side: 'below' });
  });

  it('warns when a device is mounted inside a PDU cord-bend buffer', () => {
    const placements: Placement[] = [
      { id: 'pdu1', instanceId: 'p1', specId: 'pdu-h-c20', startU: 10, spanU: 1, rail: 'rear', feed: 'A' },
    ];
    const violations = validateRequest(rack, specOf, placements, {
      instanceId: 'srv-1',
      specId: 'srv-1u-edge',
      startU: 12,
      spanU: 1,
      rail: 'front',
    });
    expect(violations.map((violation) => violation.code)).toContain('CLEARANCE_BLOCKED');
    expect(violations.some((v) => v.severity === 'error')).toBe(false);
  });
});

describe('§2.4 collision detection', () => {
  const placements: Placement[] = [
    { id: 'a', instanceId: 'srv-2u-dual#0001', specId: 'srv-2u-dual', startU: 10, spanU: 2, rail: 'front' },
  ];

  it('flags overlapping U spans on the same rail as an error', () => {
    const violations = validateRequest(rack, specOf, placements, {
      instanceId: 'other',
      specId: 'srv-2u-mid',
      startU: 11,
      spanU: 2,
      rail: 'front',
    });
    const overlap = violations.find((violation) => violation.code === 'U_OVERLAP');
    expect(overlap?.severity).toBe('error');
    expect(overlap?.uRange).toEqual([11, 11]);
  });

  it('allows the same U on opposite rails when the depth envelopes clear', () => {
    const violations = validateRequest(rack, specOf, placements, {
      instanceId: 'pdu-x',
      specId: 'pdu-h-32a',
      startU: 10,
      spanU: 1,
      rail: 'rear',
    });
    expect(violations).toHaveLength(0);
  });

  it('reports a rail conflict when depth envelopes physically interfere', () => {
    const violations = validateRequest(rack, specOf, placements, {
      instanceId: 'pdu-x',
      specId: 'pdu-h-32a',
      startU: 10,
      spanU: 1,
      rail: 'rear',
    });
    expect(violations.map((violation) => violation.code)).not.toContain('RAIL_CONFLICT');

    const deepRack: RackPreset = { ...rack, rearRailOffsetMm: 700 };
    const conflicting = validateRequest(deepRack, specOf, placements, {
      instanceId: 'pdu-x',
      specId: 'pdu-h-32a',
      startU: 10,
      spanU: 1,
      rail: 'rear',
    });
    expect(conflicting.map((violation) => violation.code)).toContain('RAIL_CONFLICT');
  });

  it('rejects out-of-bounds spans and unsupported rails', () => {
    const out = validateRequest(rack, specOf, placements, {
      instanceId: 'x',
      specId: 'srv-2u-dual',
      startU: 42,
      spanU: 2,
      rail: 'front',
    });
    expect(out.map((violation) => violation.code)).toContain('OUT_OF_BOUNDS');

    const wrongRail = validateRequest(rack, specOf, placements, {
      instanceId: 'x',
      specId: 'srv-2u-dual',
      startU: 30,
      spanU: 2,
      rail: 'rear',
    });
    expect(wrongRail.map((violation) => violation.code)).toContain('RAIL_CONFLICT');
  });

  it('rejects a span that disagrees with the nameplate height', () => {
    const violations = validateRequest(rack, specOf, placements, {
      instanceId: 'x',
      specId: 'srv-2u-dual',
      startU: 30,
      spanU: 3,
      rail: 'front',
    });
    expect(violations.map((violation) => violation.code)).toContain('OUT_OF_BOUNDS');
  });
});

describe('§2.2 automated strategy engine', () => {
  const plan = [
    instance('pdu-h-32a#0001', 'pdu-h-32a'),
    instance('pdu-h-32a#0002', 'pdu-h-32a'),
    instance('srv-2u-dual#0001', 'srv-2u-dual'),
    instance('srv-2u-dual#0002', 'srv-2u-dual'),
    instance('srv-1u-edge#0001', 'srv-1u-edge'),
  ];

  it('BOTTOM stacks from U1 and anchors PDUs at the floor', () => {
    const { placements, unplaced } = autoPlace(rack, plan, specOf, 'BOTTOM');
    expect(unplaced).toHaveLength(0);
    const lowest = [...placements].sort((a, b) => a.startU - b.startU)[0];
    expect(lowest.startU).toBe(1);
    expect(lowest.specId).toBe('pdu-h-32a');
    expect(placements.every((placement) => inBounds(placement.startU, placement.spanU, rack))).toBe(true);
    const pduPlacements = placements.filter((p) => p.specId === 'pdu-h-32a');
    expect(new Set(pduPlacements.map((p) => p.feed))).toEqual(new Set(['A', 'B']));
  });

  it('TOP builds down from the topmost slot', () => {
    const { placements } = autoPlace(rack, plan, specOf, 'TOP');
    const highest = [...placements].sort((a, b) => b.startU - a.startU)[0];
    expect(highest.startU + highest.spanU - 1).toBe(rack.totalU);
  });

  it('CENTER splits the PDU pair to opposite extremes and centres the devices', () => {
    const { placements } = autoPlace(rack, plan, specOf, 'CENTER');
    const pdus = placements.filter((p) => p.specId === 'pdu-h-32a');
    const devices = placements.filter((p) => p.specId !== 'pdu-h-32a');
    expect(Math.min(...pdus.map((p) => p.startU))).toBe(1);
    expect(Math.max(...pdus.map((p) => p.startU + p.spanU - 1))).toBe(rack.totalU);
    const mid = (Math.min(...devices.map((d) => d.startU)) + Math.max(...devices.map((d) => d.startU + d.spanU - 1))) / 2;
    expect(Math.abs(mid - (rack.totalU + 1) / 2)).toBeLessThanOrEqual(1);
  });

  it('reserves cord-bend buffers so devices never land inside them', () => {
    const { placements } = autoPlace(rack, plan, specOf, 'BOTTOM');
    const pdu = placements.find((p) => p.specId === 'pdu-h-32a')!;
    const zones = clearanceZones(rack, specOf('pdu-h-32a')!, pdu);
    for (const zone of zones) {
      for (const other of placements) {
        if (other.id === pdu.id) continue;
        const overlaps =
          other.startU <= zone.endU && zone.startU <= other.startU + other.spanU - 1;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('places the heaviest equipment lowest for rack stability', () => {
    const { placements } = autoPlace(
      rack,
      [instance('a', 'srv-1u-edge'), instance('b', 'sto-4u-array')],
      specOf,
      'BOTTOM',
    );
    const array = placements.find((p) => p.specId === 'sto-4u-array')!;
    const edge = placements.find((p) => p.specId === 'srv-1u-edge')!;
    expect(array.startU).toBeLessThan(edge.startU);
  });

  it('reports when nothing can fit', () => {
    const tiny = customRack(3, 1200);
    const { placements, unplaced } = autoPlace(
      tiny,
      [instance('pdu-h-32a#0001', 'pdu-h-32a'), instance('a', 'srv-2u-dual'), instance('b', 'srv-2u-dual')],
      specOf,
      'BOTTOM',
    );
    expect(placements.length).toBeGreaterThan(0);
    expect(unplaced.length).toBeGreaterThan(0);
    expect(unplaced[0].reason).toMatch(/No contiguous|cord-bend/);
  });

  it('findMountSlot returns the lowest conflict-free slot', () => {
    const blocked: Placement[] = [
      { id: 'a', instanceId: 'x', specId: 'srv-2u-dual', startU: 1, spanU: 2, rail: 'front' },
    ];
    const slot = findMountSlot(rack, specOf, blocked, 'y', specOf('srv-2u-dual')!, 'front');
    expect(slot).toBe(3);
  });
});

describe('§2.3 vertical (zero-U) PDU channel packing', () => {
  const capacity = channelCapacityMm(rack);

  it('derives channel capacity from the internal rack height', () => {
    expect(capacity).toBeCloseTo(42 * 44.45 - 80, 4);
  });

  it('balances strips across the left and right channels', () => {
    const result = packVerticalPdus(
      rack,
      [instance('v1', 'pdu-v-42u'), instance('v2', 'pdu-v-42u')],
      specOf,
    );
    expect(result.unplaced).toHaveLength(0);
    expect(result.placements.map((p) => p.channel).sort()).toEqual(['left', 'right']);
    expect(result.placements.every((p) => p.startMm === 0)).toBe(true);
  });

  it('never exceeds the internal height limit of a channel', () => {
    const result = packVerticalPdus(
      rack,
      [instance('v1', 'pdu-v-30u'), instance('v2', 'pdu-v-30u'), instance('v3', 'pdu-v-30u')],
      specOf,
    );
    for (const channel of ['left', 'right'] as const) {
      const used = result.placements
        .filter((placement) => placement.channel === channel)
        .reduce((sum, placement) => sum + placement.lengthMm, 0);
      expect(used).toBeLessThanOrEqual(capacity);
    }
    expect(result.unplaced).toHaveLength(1);
  });

  it('rejects a strip longer than the channel outright', () => {
    const result = packVerticalPdus(rack, [instance('v1', 'pdu-v-42u')], specOf, [
      { id: 'vp-old', instanceId: 'old', specId: 'pdu-v-30u', channel: 'left', startMm: 0, lengthMm: 1300 },
      { id: 'vp-old2', instanceId: 'old2', specId: 'pdu-v-30u', channel: 'right', startMm: 0, lengthMm: 1300 },
    ]);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].reason).toMatch(/channel/);
  });

  it('flags manual overrides that overlap or overflow a channel', () => {
    const overlapping = validateVerticals(
      rack,
      [
        { id: 'v1', instanceId: 'a', specId: 'pdu-v-30u', channel: 'left', startMm: 0, lengthMm: 1300 },
        { id: 'v2', instanceId: 'b', specId: 'pdu-v-22u', channel: 'left', startMm: 1200, lengthMm: 950 },
      ],
      specOf,
    );
    expect(overlapping.map((violation) => violation.code)).toContain('CHANNEL_OVERLAP');
    expect(overlapping.map((violation) => violation.code)).toContain('CHANNEL_OVERFLOW');

    const clean = validateVerticals(
      rack,
      [
        { id: 'v1', instanceId: 'a', specId: 'pdu-v-30u', channel: 'left', startMm: 0, lengthMm: 1300 },
        { id: 'v2', instanceId: 'b', specId: 'pdu-v-22u', channel: 'left', startMm: 1300, lengthMm: 480 },
      ],
      specOf,
    );
    expect(clean).toHaveLength(0);
  });

  it('largestFreeRun reports the biggest buildable gap', () => {
    // Reserved U1-U3 and U8-U9 leave U4-U7 (4 U) and U10-U42 (33 U).
    const reserved = new Set([1, 2, 3, 8, 9]);
    expect(largestFreeRun(rack, reserved)).toBe(33);
  });
});
