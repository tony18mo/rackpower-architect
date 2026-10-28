/** State machine: staging, validated mounts, moves and unmounts. */

import { describe, expect, it } from 'vitest';
import { buildInventory } from '../../data/catalogue';
import { specOf } from '../../data/catalogue';
import { customRack } from '../../data/racks';
import { validateVerticals } from '../../utils/placement';
import { createInitialState, plannerReducer, type PlannerState } from '../plannerReducer';

const full = buildInventory();

function seeded(): PlannerState {
  let state = createInitialState(full);
  state = plannerReducer(state, { type: 'mount', uid: 'srv-2u-dual#0001', startU: 10, rail: 'front' });
  return state;
}

describe('inventory → plan → rack', () => {
  it('seeds the tray with the full catalogue and a staged plan', () => {
    const state = createInitialState(full);
    expect(state.inventory).toHaveLength(full.length);
    expect(state.stagedUids.length).toBeGreaterThan(10);
    expect(state.placements).toHaveLength(0);
  });

  it('mounts a unit into the tray-free grid and removes it from inventory', () => {
    const state = createInitialState(full);
    const next = plannerReducer(state, { type: 'mount', uid: 'srv-2u-dual#0001', startU: 10, rail: 'front' });
    expect(next.placements).toHaveLength(1);
    expect(next.placements[0].startU).toBe(10);
    expect(next.inventory).toHaveLength(state.inventory.length - 1);
    expect(next.selectedPlacementId).toBe(next.placements[0].id);
    expect(next.notice?.tone).toBe('ok');
  });

  it('refuses a mount that would collide', () => {
    const state = seeded();
    const rejected = plannerReducer(state, {
      type: 'mount',
      uid: 'srv-2u-mid#0001',
      startU: 10,
      rail: 'front',
    });
    expect(rejected.placements).toHaveLength(1);
    expect(rejected.inventory).toHaveLength(state.inventory.length);
    expect(rejected.notice?.tone).toBe('error');
    expect(rejected.notice?.message).toMatch(/Rejected/);
  });

  it('refuses an unsupported rail', () => {
    const state = createInitialState(full);
    const rejected = plannerReducer(state, {
      type: 'mount',
      uid: 'srv-2u-dual#0001',
      startU: 5,
      rail: 'rear',
    });
    expect(rejected.placements).toHaveLength(0);
    expect(rejected.notice?.tone).toBe('error');
  });

  it('re-seats a placement by U number', () => {
    const state = seeded();
    const moved = plannerReducer(state, {
      type: 'movePlacement',
      id: state.placements[0].id,
      startU: 20,
      rail: 'front',
    });
    expect(moved.placements[0].startU).toBe(20);
    expect(moved.notice?.tone).toBe('ok');
  });

  it('blocks a move that collides with another unit', () => {
    let state = seeded();
    state = plannerReducer(state, { type: 'mount', uid: 'srv-1u-edge#0001', startU: 14, rail: 'front' });
    const attempted = plannerReducer(state, {
      type: 'movePlacement',
      id: state.placements[0].id,
      startU: 13,
      rail: 'front',
    });
    expect(attempted.placements.find((p) => p.startU === 13)).toBeUndefined();
    expect(attempted.notice?.tone).toBe('error');
  });

  it('unmounting returns the unit to the tray', () => {
    const state = seeded();
    const removed = plannerReducer(state, { type: 'removePlacement', id: state.placements[0].id });
    expect(removed.placements).toHaveLength(0);
    expect(removed.inventory).toHaveLength(createInitialState(full).inventory.length);
  });

  it('auto-places the staged plan and packs the zero-U strips', () => {
    const state = createInitialState(full);
    const placed = plannerReducer(state, { type: 'autoPlace' });
    expect(placed.placements.length).toBeGreaterThan(5);
    expect(placed.verticals).toHaveLength(2);
    expect(placed.verticals[0].channel).not.toBe(placed.verticals[1].channel);
    expect(placed.notice?.tone).toBe('ok');
    expect(placed.inventory).toHaveLength(state.inventory.length - placed.placements.length - placed.verticals.length);
  });

  it('clearing the rack hands every unit back to inventory', () => {
    const state = createInitialState(full);
    const placed = plannerReducer(state, { type: 'autoPlace' });
    const cleared = plannerReducer(placed, { type: 'clearRack' });
    expect(cleared.placements).toHaveLength(0);
    expect(cleared.verticals).toHaveLength(0);
    expect(cleared.inventory).toHaveLength(full.length);
  });

  it('stages and unstages units', () => {
    const state = createInitialState(full);
    const staged = plannerReducer(state, { type: 'stage', uid: 'net-1u-tor#0007' });
    expect(staged.stagedUids).toContain('net-1u-tor#0007');
    const unstaged = plannerReducer(staged, { type: 'unstage', uid: 'net-1u-tor#0007' });
    expect(unstaged.stagedUids).not.toContain('net-1u-tor#0007');
  });

  it('does not re-place an already mounted unit from the plan', () => {
    const state = plannerReducer(createInitialState(full), { type: 'autoPlace' });
    const again = plannerReducer(state, { type: 'autoPlace' });
    expect(again.placements).toHaveLength(state.placements.length);
    expect(again.notice?.tone).toBe('warning');
  });

  it('clamps the rear rail to the frame adjustment range', () => {
    const state = createInitialState(full);
    const pushed = plannerReducer(state, { type: 'setRearRail', mm: 5000 });
    expect(pushed.rack.rearRailOffsetMm).toBe(state.rack.rearRailAdjustRangeMm[1]);
    const shrunk = plannerReducer(state, { type: 'setRearRail', mm: 10 });
    expect(shrunk.rack.rearRailOffsetMm).toBe(state.rack.rearRailAdjustRangeMm[0]);
  });

  it('re-energises a strip onto the other feed', () => {
    const state = plannerReducer(createInitialState(full), { type: 'autoPlace' });
    const pdu = state.placements.find((placement) => placement.feed === 'A')!;
    const swapped = plannerReducer(state, { type: 'setPduFeed', id: pdu.id, feed: 'B' });
    expect(swapped.placements.find((placement) => placement.id === pdu.id)?.feed).toBe('B');
  });

  it('refuses a channel move that would overflow the rack height', () => {
    const state = plannerReducer(createInitialState(full), { type: 'autoPlace' });
    const strip = state.verticals[0];
    const target = state.verticals[1].channel;
    const blocked = plannerReducer(state, { type: 'setVerticalChannel', id: strip.id, channel: target });
    // Two 1780 mm strips cannot share a 1786.9 mm channel.
    expect(blocked.notice?.tone).toBe('error');
    expect(blocked.verticals.find((vertical) => vertical.id === strip.id)?.channel).toBe(strip.channel);
  });

  it('stacks two shorter strips in one channel when the frame is tall enough', () => {
    let state = createInitialState(full);
    state = plannerReducer(state, { type: 'setCustomRack', rack: customRack(48, 1200) });
    state = plannerReducer(state, { type: 'clearPlan' });
    state = plannerReducer(state, { type: 'stage', uid: 'pdu-v-22u#0001' });
    state = plannerReducer(state, { type: 'stage', uid: 'pdu-v-22u#0002' });
    state = plannerReducer(state, { type: 'autoPlace' });
    expect(state.verticals).toHaveLength(2);
    const moved = plannerReducer(state, {
      type: 'setVerticalChannel',
      id: state.verticals[0].id,
      channel: state.verticals[1].channel,
    });
    expect(moved.notice?.tone).toBe('ok');
    const stacked = moved.verticals.filter((vertical) => vertical.channel === state.verticals[1].channel);
    expect(stacked).toHaveLength(2);
    const offsets = stacked.map((vertical) => vertical.startMm).sort((a, b) => a - b);
    expect(offsets[1]).toBeGreaterThanOrEqual(offsets[0] + 950);
    expect(validateVerticals(moved.rack, moved.verticals, specOf)).toHaveLength(0);
  });

  it('switches rack frames without discarding the layout', () => {
    const state = seeded();
    const switched = plannerReducer(state, { type: 'setRack', rackPresetId: 'rc-12-600x800' });
    expect(switched.rack.totalU).toBe(12);
    expect(switched.placements).toHaveLength(1);
  });

  it('applies a custom height definition', () => {
    const state = createInitialState(full);
    const custom = plannerReducer(state, {
      type: 'setCustomRack',
      rack: { ...state.rack, id: 'rc-custom-7-900', totalU: 7 },
    });
    expect(custom.rack.totalU).toBe(7);
    expect(custom.rack.id).toBe('rc-custom-7-900');
  });
});
