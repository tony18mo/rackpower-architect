/**
 * Placement inspector: manual override controls (PRD §2.2) for the selected unit —
 * numeric U assignment, rail switching, PDU feed re-energisation and unmount — all
 * validated by the spatial engine before the reducer accepts them.
 */

import { usePlanner } from '../state/PlannerContext';
import { specOf } from '../data/catalogue';
import { channelCapacityMm, uSpanLabel } from '../utils/placement';
import { placementIsFaulty } from '../utils/diagnostics';
import type { FeedId, RailPosition } from '../types/rack';

export function PlacementInspector() {
  const { state, dispatch, derived } = usePlanner();
  const id = state.selectedPlacementId;
  if (!id) return <EmptyInspector />;

  const placement = state.placements.find((candidate) => candidate.id === id);
  const vertical = state.verticals.find((candidate) => candidate.id === id);
  const source = placement ?? vertical;
  if (!source) return <EmptyInspector />;

  const spec = specOf(source.specId);
  if (!spec) return <EmptyInspector />;
  const instance = state.instances[source.instanceId];
  const severity = placementIsFaulty(derived.diagnostics, id);
  const connections = derived.power.connections.filter((connection) => connection.placementId === id);

  return (
    <section className="panel inspector">
      <header className="panel-head">
        <h2>Inspector</h2>
        {severity && <i className={`badge ${severity}`}>{severity}</i>}
      </header>

      <div className="inspector-title">
        <strong>{spec.vendor} {spec.model}</strong>
        <span className="mono muted">{instance?.assetTag ?? source.instanceId}</span>
      </div>

      {placement ? (
        <>
          <dl className="kv">
            <dt>span</dt>
            <dd className="mono">{uSpanLabel(placement.startU, placement.spanU)} · {placement.spanU}U</dd>
            <dt>rails</dt>
            <dd>{spec.rails.join(' / ')}</dd>
            <dt>depth</dt>
            <dd className="mono">{spec.depthMm} mm + cord</dd>
            <dt>power</dt>
            <dd className="mono">{spec.powerDrawW} W · {spec.psuCount} PSU ({spec.inlets.join('/') || '—'})</dd>
            <dt>mass</dt>
            <dd className="mono">{spec.weightKg} kg</dd>
          </dl>

          <div className="inspector-controls">
            <label className="field">
              <span className="field-label">U position</span>
              <input
                type="number"
                min={1}
                max={state.rack.totalU}
                value={placement.startU}
                onChange={(event) =>
                  dispatch({
                    type: 'movePlacement',
                    id,
                    startU: Number(event.target.value),
                    rail: placement.rail,
                  })
                }
              />
            </label>
            <div className="field">
              <span className="field-label">rail</span>
              <div className="segmented">
                {(['front', 'rear'] as RailPosition[]).map((rail) => (
                  <button
                    key={rail}
                    type="button"
                    className={placement.rail === rail ? 'is-active' : ''}
                    onClick={() =>
                      dispatch({ type: 'movePlacement', id, startU: placement.startU, rail })
                    }
                  >
                    {rail}
                  </button>
                ))}
              </div>
            </div>
            {spec.category === 'pdu-horizontal' && (
              <div className="field">
                <span className="field-label">feed</span>
                <div className="segmented">
                  {(['A', 'B'] as FeedId[]).map((feed) => (
                    <button
                      key={feed}
                      type="button"
                      className={`feed-${feed.toLowerCase()} ${placement.feed === feed ? 'is-active' : ''}`}
                      onClick={() => dispatch({ type: 'setPduFeed', id, feed })}
                    >
                      feed {feed}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button type="button" className="btn danger" onClick={() => dispatch({ type: 'removePlacement', id })}>
              unmount
            </button>
          </div>

          {connections.length > 0 && (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>psu</th>
                  <th>inlet</th>
                  <th>feed</th>
                  <th>source</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection) => (
                  <tr key={`${connection.placementId}-${connection.psuIndex}`}>
                    <td className="mono">PSU-{connection.psuIndex + 1}</td>
                    <td>{connection.inlet}</td>
                    <td className={`feed-${connection.feed.toLowerCase()}`}>{connection.feed}</td>
                    <td className="mono">{connection.pduPlacementId ?? (connection.target === 'branch' ? 'branch' : '— unpowered —')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : vertical ? (
        <>
          <dl className="kv">
            <dt>channel</dt>
            <dd>{vertical.channel} rear channel</dd>
            <dt>length</dt>
            <dd className="mono">{vertical.lengthMm} mm of {channelCapacityMm(state.rack)} mm</dd>
            <dt>offset</dt>
            <dd className="mono">{vertical.startMm} mm from channel bottom</dd>
            <dt>outlets</dt>
            <dd className="mono">{spec.outlets?.c13 ?? 0}× C13 · {spec.outlets?.c19 ?? 0}× C19</dd>
          </dl>
          <div className="inspector-controls">
            <div className="field">
              <span className="field-label">channel</span>
              <div className="segmented">
                {(['left', 'right'] as const).map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    className={vertical.channel === channel ? 'is-active' : ''}
                    onClick={() =>
                      dispatch({ type: 'setVerticalChannel', id, channel })
                    }
                  >
                    {channel}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">feed</span>
              <div className="segmented">
                {(['A', 'B'] as FeedId[]).map((feed) => (
                  <button
                    key={feed}
                    type="button"
                    className={`feed-${feed.toLowerCase()} ${vertical.feed === feed ? 'is-active' : ''}`}
                    onClick={() => dispatch({ type: 'setPduFeed', id, feed })}
                  >
                    feed {feed}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="btn danger" onClick={() => dispatch({ type: 'removeVertical', id })}>
              unmount strip
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function EmptyInspector() {
  return (
    <section className="panel inspector">
      <header className="panel-head">
        <h2>Inspector</h2>
      </header>
      <p className="empty">Select a mounted unit to override its U position, rail or feed.</p>
    </section>
  );
}
