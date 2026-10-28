/**
 * Zero-U (vertical) PDU channel packing (PRD §2.3).
 *
 * Left and right rear cable channels rendered to scale in millimetres, with the
 * non-overlapping / aggregate-height validation the engine enforces.
 */

import { usePlanner } from '../state/PlannerContext';
import { specOf } from '../data/catalogue';
import { channelCapacityMm } from '../utils/placement';
import type { Channel, VerticalPlacement } from '../types/rack';

const BAR_H = 230;

export function ChannelPanel() {
  const { state, dispatch } = usePlanner();
  const capacity = channelCapacityMm(state.rack);
  const channels: Channel[] = ['left', 'right'];

  return (
    <section className="panel channels">
      <header className="panel-head">
        <h2>Zero-U channels</h2>
        <span className="mono muted">{capacity} mm usable / channel</span>
      </header>

      <div className="channel-grid">
        {channels.map((channel) => {
          const strips = state.verticals.filter((vertical) => vertical.channel === channel);
          const usedMm = strips.reduce((sum, vertical) => sum + vertical.lengthMm, 0);
          const over = usedMm > capacity;
          return (
            <div key={channel} className={`channel ${over ? 'is-over' : ''}`}>
              <div className="channel-title">
                <strong>{channel}</strong>
                <span className="mono">{usedMm} / {capacity} mm</span>
              </div>
              <div className="channel-bar" style={{ height: BAR_H }}>
                {strips.map((strip) => renderStrip(strip, capacity, BAR_H, dispatch))}
                {strips.length === 0 && <span className="channel-empty">empty</span>}
              </div>
              <ul className="channel-list">
                {strips.map((strip) => {
                  const spec = specOf(strip.specId);
                  return (
                    <li key={strip.id}>
                      <button
                        type="button"
                        className={`channel-item ${state.selectedPlacementId === strip.id ? 'is-active' : ''}`}
                        onClick={() => dispatch({ type: 'select', id: strip.id })}
                      >
                        <span>{spec?.model ?? strip.specId}</span>
                        <span className="mono">
                          {strip.lengthMm} mm · {strip.startMm}–{strip.startMm + strip.lengthMm} · feed {strip.feed ?? '—'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="panel-note">
        Strips are parked bottom-up and balanced across channels; any aggregate beyond the internal
        height or overlapping segment is flagged by the spatial engine.
      </p>
    </section>
  );
}

function renderStrip(
  strip: VerticalPlacement,
  capacity: number,
  barHeight: number,
  dispatch: ReturnType<typeof usePlanner>['dispatch'],
) {
  const spec = specOf(strip.specId);
  const heightPx = (strip.lengthMm / capacity) * barHeight;
  // Channel bottom is U1, so offset from the bottom maps to the bottom of the bar.
  const bottomPx = (strip.startMm / capacity) * barHeight;
  return (
    <button
      type="button"
      key={strip.id}
      className={`channel-strip feed-${strip.feed?.toLowerCase() ?? 'none'} ${
        strip.startMm + strip.lengthMm > capacity ? 'is-over' : ''
      }`}
      style={{ height: heightPx, bottom: bottomPx }}
      onClick={() => dispatch({ type: 'select', id: strip.id })}
      title={`${spec?.model ?? strip.specId} · ${strip.lengthMm} mm at ${strip.startMm} mm`}
    >
      {heightPx > 18 && <span>{spec?.model ?? strip.specId}</span>}
    </button>
  );
}
