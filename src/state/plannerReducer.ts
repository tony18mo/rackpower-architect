/**
 * Planner state machine: inventory → staged plan → mounted rack, with manual
 * drag-and-drop overrides validated by the spatial engine before they commit
 * (PRD §2.2 "Manual Drag-and-Drop Overrides", §2.4 collision validation).
 */

import type {
  Channel,
  DeviceInstance,
  FeedId,
  Placement,
  PlacementStrategy,
  RackPreset,
  RailPosition,
  VerticalPlacement,
} from '../types/rack';
import { specOf } from '../data/catalogue';
import {
  autoPlace,
  channelCapacityMm,
  packVerticalPdus,
  uSpanLabel,
  validateRequest,
} from '../utils/placement';
import { presetById } from '../data/racks';

export interface Notice {
  tone: 'ok' | 'warning' | 'error';
  message: string;
}

export interface PlannerState {
  rack: RackPreset;
  rackPresetId: string;
  strategy: PlacementStrategy;
  /** Every physical unit the planner knows about (never mutated after init). */
  instances: Record<string, DeviceInstance>;
  /** Unmounted pool shown in the virtualized tray. */
  inventory: DeviceInstance[];
  /** Staged for automated strategy placement. */
  stagedUids: string[];
  placements: Placement[];
  verticals: VerticalPlacement[];
  selectedPlacementId: string | null;
  notice: Notice | null;
}

export type PlannerAction =
  | { type: 'setRack'; rackPresetId: string }
  | { type: 'setCustomRack'; rack: RackPreset }
  | { type: 'setRearRail'; mm: number }
  | { type: 'setStrategy'; strategy: PlacementStrategy }
  | { type: 'stage'; uid: string }
  | { type: 'unstage'; uid: string }
  | { type: 'stageAll'; uids: string[] }
  | { type: 'clearPlan' }
  | { type: 'autoPlace' }
  | { type: 'mount'; uid: string; startU: number; rail: RailPosition }
  | { type: 'movePlacement'; id: string; startU: number; rail: RailPosition }
  | { type: 'setPduFeed'; id: string; feed: FeedId }
  | { type: 'setVerticalChannel'; id: string; channel: Channel }
  | { type: 'removePlacement'; id: string }
  | { type: 'removeVertical'; id: string }
  | { type: 'select'; id: string | null }
  | { type: 'clearRack' }
  | { type: 'reset' };

export function createInitialState(instances: DeviceInstance[]): PlannerState {
  const rack = presetById('rc-42-800x1200');
  return {
    rack,
    rackPresetId: rack.id,
    strategy: 'BOTTOM',
    instances: Object.fromEntries(instances.map((instance) => [instance.uid, instance])),
    inventory: [...instances],
    stagedUids: defaultStagedUids(),
    placements: [],
    verticals: [],
    selectedPlacementId: null,
    notice: { tone: 'ok', message: `Loaded ${instances.length.toLocaleString()} units into the inventory tray.` },
  };
}

function defaultStagedUids(): string[] {
  return [
    'pdu-h-32a#0001',
    'pdu-h-32a#0002',
    'pdu-v-42u#0001',
    'pdu-v-42u#0002',
    'srv-2u-dual#0001',
    'srv-2u-dual#0002',
    'srv-2u-dual#0003',
    'srv-2u-dual#0004',
    'srv-2u-dual#0005',
    'srv-2u-dual#0006',
    'srv-2u-mid#0001',
    'srv-2u-mid#0002',
    'srv-1u-edge#0001',
    'srv-1u-edge#0002',
    'srv-1u-edge#0003',
    'net-1u-tor#0001',
    'net-1u-tor#0002',
    'sec-1u-fw#0001',
    'sto-4u-array#0001',
    'pp-1u-48#0001',
  ];
}

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'setRack': {
      const rack = presetById(action.rackPresetId);
      return { ...state, rack, rackPresetId: rack.id, notice: { tone: 'ok', message: `Rack frame set to ${rack.name}.` } };
    }
    case 'setCustomRack':
      return {
        ...state,
        rack: action.rack,
        rackPresetId: action.rack.id,
        notice: { tone: 'ok', message: `Custom ${action.rack.totalU}U frame applied; re-checking every span.` },
      };
    case 'setRearRail': {
      const [min, max] = state.rack.rearRailAdjustRangeMm;
      const mm = Math.max(min, Math.min(max, Math.round(action.mm)));
      return {
        ...state,
        rack: { ...state.rack, rearRailOffsetMm: mm },
        notice: { tone: 'ok', message: `Rear rail plane moved to ${mm} mm from the front reference plane.` },
      };
    }
    case 'setStrategy':
      return { ...state, strategy: action.strategy };

    case 'stage': {
      if (state.stagedUids.includes(action.uid)) return state;
      return { ...state, stagedUids: [...state.stagedUids, action.uid] };
    }
    case 'unstage':
      return { ...state, stagedUids: state.stagedUids.filter((uid) => uid !== action.uid) };
    case 'stageAll':
      return {
        ...state,
        stagedUids: [...new Set([...state.stagedUids, ...action.uids])],
        notice: { tone: 'ok', message: `Staged ${action.uids.length} units for automated placement.` },
      };
    case 'clearPlan':
      return { ...state, stagedUids: [] };

    case 'autoPlace': {
      const staged = state.stagedUids
        .map((uid) => state.instances[uid])
        .filter((instance): instance is DeviceInstance => Boolean(instance) && !isMounted(state, instance.uid));
      if (staged.length === 0) {
        return { ...state, notice: { tone: 'warning', message: 'Nothing staged: add units from the inventory tray first.' } };
      }
      const { placements, unplaced } = autoPlace(state.rack, staged, specOf, state.strategy);
      const verticalStrips = packVerticalPdus(state.rack, staged, specOf).placements;
      const mountedUids = new Set([
        ...placements.map((placement) => placement.instanceId),
        ...verticalStrips.map((vertical) => vertical.instanceId),
      ]);
      return {
        ...state,
        placements: [...state.placements, ...placements].sort((a, b) => a.startU - b.startU),
        verticals: dedupeVerticals([...state.verticals, ...verticalStrips]),
        inventory: state.inventory.filter((instance) => !mountedUids.has(instance.uid)),
        selectedPlacementId: placements[0]?.id ?? state.selectedPlacementId,
        notice:
          unplaced.length === 0
            ? { tone: 'ok', message: `Placed ${placements.length + verticalStrips.length} units with the ${state.strategy} strategy.` }
            : {
                tone: 'warning',
                message: `${placements.length + verticalStrips.length} placed, ${unplaced.length} rejected: ${unplaced[0].model} — ${unplaced[0].reason}`,
              },
      };
    }

    case 'mount': {
      const instance = state.instances[action.uid];
      const spec = instance ? specOf(instance.specId) : undefined;
      if (!instance || !spec) {
        return { ...state, notice: { tone: 'error', message: 'Unknown device instance.' } };
      }
      if (spec.category === 'pdu-vertical') {
        const packed = packVerticalPdus(state.rack, [instance], specOf, state.verticals);
        const created = packed.placements.find((vertical) => vertical.instanceId === instance.uid);
        if (!created) {
          return {
            ...state,
            notice: { tone: 'error', message: packed.unplaced[0]?.reason ?? 'Zero-U strip does not fit a channel.' },
          };
        }
        return {
          ...state,
          verticals: [...state.verticals, created],
          inventory: state.inventory.filter((candidate) => candidate.uid !== instance.uid),
          selectedPlacementId: created.id,
          notice: {
            tone: 'ok',
            message: `${spec.model} parked zero-U ${created.channel} at ${created.startMm} mm from channel bottom.`,
          },
        };
      }

      const violations = validateRequest(state.rack, specOf, state.placements, {
        instanceId: instance.uid,
        specId: spec.id,
        startU: action.startU,
        spanU: spec.heightU,
        rail: action.rail,
      });
      const errors = violations.filter((violation) => violation.severity === 'error');
      if (errors.length > 0) {
        return { ...state, notice: { tone: 'error', message: `Rejected ${spec.model}: ${errors[0].message}` } };
      }
      const placement: Placement = {
        id: `pl-m${state.placements.length + 1}-${instance.uid}`,
        instanceId: instance.uid,
        specId: spec.id,
        startU: action.startU,
        spanU: spec.heightU,
        rail: action.rail,
        feed: spec.category === 'pdu-horizontal' ? nextFeed(state) : undefined,
        circuitLabel:
          spec.category === 'pdu-horizontal' ? state.rack.branchCircuitLabel[nextFeed(state)] : undefined,
      };
      const warnings = violations.filter((violation) => violation.severity === 'warning');
      return {
        ...state,
        placements: [...state.placements, placement].sort((a, b) => a.startU - b.startU),
        inventory: state.inventory.filter((candidate) => candidate.uid !== instance.uid),
        selectedPlacementId: placement.id,
        notice:
          warnings.length > 0
            ? { tone: 'warning', message: `Mounted ${spec.model} at ${uSpanLabel(placement.startU, placement.spanU)} with a warning: ${warnings[0].message}` }
            : { tone: 'ok', message: `Mounted ${spec.model} at ${uSpanLabel(placement.startU, placement.spanU)} ${placement.rail} rail.` },
      };
    }

    case 'movePlacement': {
      const placement = state.placements.find((candidate) => candidate.id === action.id);
      const spec = placement ? specOf(placement.specId) : undefined;
      if (!placement || !spec) return state;
      const violations = validateRequest(state.rack, specOf, state.placements, {
        instanceId: placement.instanceId,
        specId: spec.id,
        startU: action.startU,
        spanU: spec.heightU,
        rail: action.rail,
        movingPlacementId: placement.id,
      });
      const errors = violations.filter((violation) => violation.severity === 'error');
      if (errors.length > 0) {
        return { ...state, notice: { tone: 'error', message: `Cannot move ${spec.model}: ${errors[0].message}` } };
      }
      return {
        ...state,
        placements: state.placements
          .map((candidate) =>
            candidate.id === placement.id
              ? { ...candidate, startU: action.startU, rail: action.rail }
              : candidate,
          )
          .sort((a, b) => a.startU - b.startU),
        selectedPlacementId: placement.id,
        notice: { tone: 'ok', message: `${spec.model} re-seated at ${uSpanLabel(action.startU, spec.heightU)} ${action.rail} rail.` },
      };
    }

    case 'setVerticalChannel': {
      const vertical = state.verticals.find((candidate) => candidate.id === action.id);
      if (!vertical) return state;
      const capacity = channelCapacityMm(state.rack);
      const others = state.verticals.filter((candidate) => candidate.id !== vertical.id);
      const inTarget = others
        .filter((candidate) => candidate.channel === action.channel)
        .sort((a, b) => a.startMm - b.startMm);
      const usedMm = inTarget.reduce((sum, candidate) => sum + candidate.lengthMm, 0);
      if (usedMm + vertical.lengthMm > capacity + 1e-9) {
        return {
          ...state,
          notice: {
            tone: 'error',
            message: `${action.channel} channel holds ${usedMm} mm of ${capacity} mm; the ${vertical.lengthMm} mm strip will not fit.`,
          },
        };
      }
      let cursor = 0;
      for (const segment of inTarget) {
        if (segment.startMm - cursor >= vertical.lengthMm) break;
        cursor = Math.max(cursor, segment.startMm + segment.lengthMm);
      }
      return {
        ...state,
        verticals: [
          ...others,
          { ...vertical, channel: action.channel, startMm: cursor },
        ],
        notice: {
          tone: 'ok',
          message: `Strip re-parked zero-U ${action.channel} at ${cursor} mm from channel bottom.`,
        },
      };
    }

    case 'setPduFeed': {
      const apply = (list: Placement[], id: string, feed: FeedId): Placement[] =>
        list.map((placement) =>
          placement.id === id ? { ...placement, feed, circuitLabel: state.rack.branchCircuitLabel[feed] } : placement,
        );
      const inHorizontals = state.placements.some((placement) => placement.id === action.id);
      return {
        ...state,
        placements: inHorizontals ? apply(state.placements, action.id, action.feed) : state.placements,
        verticals: inHorizontals
          ? state.verticals
          : state.verticals.map((vertical) =>
              vertical.id === action.id
                ? { ...vertical, feed: action.feed, circuitLabel: state.rack.branchCircuitLabel[action.feed] }
                : vertical,
            ),
        notice: { tone: 'ok', message: `Strip re-energised from Feed ${action.feed}.` },
      };
    }

    case 'removePlacement': {
      const placement = state.placements.find((candidate) => candidate.id === action.id);
      if (!placement) return state;
      const instance = state.instances[placement.instanceId];
      return {
        ...state,
        placements: state.placements.filter((candidate) => candidate.id !== action.id),
        inventory: instance ? sortInventory([...state.inventory, instance]) : state.inventory,
        selectedPlacementId: null,
        notice: { tone: 'ok', message: `${instance ? specOf(instance.specId)?.model ?? 'Device' : 'Device'} returned to the inventory tray.` },
      };
    }

    case 'removeVertical': {
      const vertical = state.verticals.find((candidate) => candidate.id === action.id);
      if (!vertical) return state;
      const instance = state.instances[vertical.instanceId];
      return {
        ...state,
        verticals: state.verticals.filter((candidate) => candidate.id !== action.id),
        inventory: instance ? sortInventory([...state.inventory, instance]) : state.inventory,
        selectedPlacementId: null,
        notice: { tone: 'ok', message: 'Zero-U strip returned to the inventory tray.' },
      };
    }

    case 'select':
      return { ...state, selectedPlacementId: action.id };

    case 'clearRack': {
      const returned = [
        ...state.placements.map((placement) => state.instances[placement.instanceId]),
        ...state.verticals.map((vertical) => state.instances[vertical.instanceId]),
      ].filter((instance): instance is DeviceInstance => Boolean(instance));
      return {
        ...state,
        placements: [],
        verticals: [],
        inventory: sortInventory([...state.inventory, ...returned]),
        selectedPlacementId: null,
        notice: { tone: 'ok', message: 'Rack cleared; all units moved back to inventory.' },
      };
    }

    case 'reset':
      return createInitialState(Object.values(state.instances));

    default:
      return state;
  }
}

function isMounted(state: PlannerState, uid: string): boolean {
  return (
    state.placements.some((placement) => placement.instanceId === uid) ||
    state.verticals.some((vertical) => vertical.instanceId === uid)
  );
}

function dedupeVerticals(verticals: VerticalPlacement[]): VerticalPlacement[] {
  const seen = new Set<string>();
  return verticals.filter((vertical) => {
    if (seen.has(vertical.instanceId)) return false;
    seen.add(vertical.instanceId);
    return true;
  });
}

function nextFeed(state: PlannerState): FeedId {
  const used = [
    ...state.placements.filter((placement) => placement.feed),
    ...state.verticals.filter((vertical) => vertical.feed),
  ];
  return used.length % 2 === 0 ? 'A' : 'B';
}

function sortInventory(instances: DeviceInstance[]): DeviceInstance[] {
  return [...instances].sort((a, b) => a.uid.localeCompare(b.uid));
}
