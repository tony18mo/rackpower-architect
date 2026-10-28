/** Rack frame + strategy controls and the action bar. */

import { useState } from 'react';
import { usePlanner } from '../state/PlannerContext';
import { customRack, RACK_PRESETS } from '../data/racks';
import { occupiedUCount } from '../utils/placement';
import type { PlacementStrategy } from '../types/rack';

const STRATEGIES: PlacementStrategy[] = ['BOTTOM', 'TOP', 'CENTER'];

export function Toolbar() {
  const { state, dispatch, derived } = usePlanner();
  const [customU, setCustomU] = useState(42);
  const [customDepth, setCustomDepth] = useState(1200);
  const used = occupiedUCount(state.rack, state.placements);
  const errors = derived.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">▚</span>
        <div>
          <h1>RackPower Architect</h1>
          <p className="mono muted">v1.0 · EIA-310-D core placement &amp; space planning</p>
        </div>
      </div>

      <div className="tool-group">
        <label className="field">
          <span className="field-label">rack preset</span>
          <select
            value={RACK_PRESETS.some((preset) => preset.id === state.rack.id) ? state.rack.id : 'custom'}
            onChange={(event) => dispatch({ type: 'setRack', rackPresetId: event.target.value })}
          >
            {RACK_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
            <option value="custom">custom…</option>
          </select>
        </label>
        <div className="custom-row">
          <input
            type="number"
            min={1}
            max={60}
            value={customU}
            onChange={(event) => setCustomU(Number(event.target.value))}
            aria-label="Custom rack height in U"
          />
          <span className="muted">U</span>
          <input
            type="number"
            min={300}
            max={1600}
            step={10}
            value={customDepth}
            onChange={(event) => setCustomDepth(Number(event.target.value))}
            aria-label="Custom rack depth in millimetres"
          />
          <span className="muted">mm</span>
          <button
            type="button"
            className="btn"
            onClick={() => dispatch({ type: 'setCustomRack', rack: customRack(customU, customDepth) })}
          >
            apply custom
          </button>
        </div>
      </div>

      <div className="tool-group">
        <span className="field-label">strategy</span>
        <div className="segmented">
          {STRATEGIES.map((strategy) => (
            <button
              key={strategy}
              type="button"
              className={state.strategy === strategy ? 'is-active' : ''}
              onClick={() => dispatch({ type: 'setStrategy', strategy })}
            >
              {strategy.toLowerCase()}
            </button>
          ))}
        </div>
        <button type="button" className="btn primary" onClick={() => dispatch({ type: 'autoPlace' })}>
          auto-place plan
        </button>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'clearRack' })}>
          clear rack
        </button>
        <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'reset' })}>
          reset
        </button>
      </div>

      <div className="status-strip mono">
        <span>
          {used}/{state.rack.totalU} U
        </span>
        <span>{state.placements.length} mounted</span>
        <span>{state.verticals.length} zero-U</span>
        <span className={errors ? 'is-error' : 'is-ok'}>{errors} error{errors === 1 ? '' : 's'}</span>
      </div>

      {state.notice && (
        <p className={`notice notice-${state.notice.tone}`} role="status">
          {state.notice.message}
        </p>
      )}
    </header>
  );
}
