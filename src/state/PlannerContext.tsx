/** Planner context: reducer state plus memoised derived spatial/power/wiring views. */

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { DeviceInstance, Diagnostic } from '../types/rack';
import { buildInventory, specOf } from '../data/catalogue';
import {
  createInitialState,
  plannerReducer,
  type PlannerAction,
  type PlannerState,
} from './plannerReducer';
import { buildPowerModel, type PowerModel } from '../utils/power';
import { buildWiringGraph, type WiringGraph } from '../utils/wiring';
import { collectDiagnostics } from '../utils/diagnostics';

export interface PlannerDerived {
  diagnostics: Diagnostic[];
  power: PowerModel;
  wiring: WiringGraph;
}

interface PlannerContextValue {
  state: PlannerState;
  dispatch: Dispatch<PlannerAction>;
  derived: PlannerDerived;
}

const PlannerContext = createContext<PlannerContextValue | null>(null);

export function PlannerProvider({
  children,
  instances,
}: {
  children: ReactNode;
  instances?: DeviceInstance[];
}) {
  const [state, dispatch] = useReducer(plannerReducer, instances, (seed) =>
    createInitialState(seed ?? buildInventory()),
  );

  const derived = useMemo<PlannerDerived>(() => {
    const power = buildPowerModel(state.rack, state.placements, state.verticals, specOf);
    return {
      power,
      wiring: buildWiringGraph(state.rack, state.placements, power, specOf),
      diagnostics: collectDiagnostics({
        rack: state.rack,
        placements: state.placements,
        verticals: state.verticals,
        specOf,
        power,
      }),
    };
  }, [state.rack, state.placements, state.verticals]);

  const value = useMemo(() => ({ state, dispatch, derived }), [state, derived]);
  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const value = useContext(PlannerContext);
  if (!value) throw new Error('usePlanner must be used inside <PlannerProvider>');
  return value;
}
