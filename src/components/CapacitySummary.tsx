/** Capacity & headroom summary panel (PRD §2.4). */

import { useMemo } from 'react';
import { usePlanner } from '../state/PlannerContext';
import { specOf } from '../data/catalogue';
import {
  clearanceReservationMap,
  largestFreeRun,
  occupiedUCount,
} from '../utils/placement';

export function CapacitySummary() {
  const { state, derived } = usePlanner();
  const { rack, placements, verticals } = state;

  const stats = useMemo(() => {
    const used = occupiedUCount(rack, placements);
    const reservations = clearanceReservationMap(rack, placements, specOf);
    const reserved = [...reservations.keys()].filter((u) => !placements.some((p) => u >= p.startU && u <= p.startU + p.spanU - 1));
    const taken = new Set<number>(reserved);
    for (const placement of placements) {
      for (let u = placement.startU; u <= placement.startU + placement.spanU - 1; u += 1) taken.add(u);
    }
    const mass = placements.reduce((sum, placement) => sum + (specOf(placement.specId)?.weightKg ?? 0), 0);
    return {
      used,
      free: rack.totalU - used,
      bufferU: reserved.length,
      largestRun: largestFreeRun(rack, taken),
      mass: Math.round(mass * 10) / 10,
    };
  }, [rack, placements, verticals]);

  const feedRows = (['A', 'B'] as const).map((feed) => ({
    feed,
    load: derived.power.loadW[feed],
    capacity: derived.power.capacityW[feed],
  }));

  return (
    <section className="panel capacity">
      <header className="panel-head">
        <h2>Capacity</h2>
        <span className="mono muted">{rack.name}</span>
      </header>

      <Meter label="U utilisation" value={stats.used} max={rack.totalU} unit="U" />
      <Meter label="mounted mass" value={stats.mass} max={rack.maxStaticLoadKg} unit="kg" />
      {feedRows.map((row) => (
        <Meter
          key={row.feed}
          label={`feed ${row.feed} load`}
          value={Math.round(row.load)}
          max={row.capacity}
          unit="W"
          tone={`feed-${row.feed.toLowerCase()}`}
        />
      ))}

      <dl className="kv kv-compact">
        <dt>free U</dt>
        <dd className="mono">{stats.free}</dd>
        <dt>largest gap</dt>
        <dd className="mono">{stats.largestRun} U</dd>
        <dt>cord-bend reserve</dt>
        <dd className="mono">{stats.bufferU} U</dd>
        <dt>PDUs mounted</dt>
        <dd className="mono">{derived.power.pdus.length}</dd>
        <dt>PSU runs</dt>
        <dd className="mono">{derived.power.connections.length}</dd>
      </dl>

      {derived.power.pdus.length > 0 && (
        <table className="mini-table">
          <thead>
            <tr>
              <th>pdu</th>
              <th>feed</th>
              <th>C13</th>
              <th>C19</th>
            </tr>
          </thead>
          <tbody>
            {derived.power.pdus.map((pdu) => (
              <tr key={pdu.id} className={pdu.used.c13 + pdu.used.c19 > pdu.outlets.c13 + pdu.outlets.c19 ? 'row-bad' : ''}>
                <td>{pdu.kind === 'horizontal' ? `H ${pdu.id}` : `V ${pdu.id}`}</td>
                <td className={`feed-${pdu.feed?.toLowerCase() ?? 'none'}`}>{pdu.feed ?? '—'}</td>
                <td className="mono">
                  {pdu.used.c13}/{pdu.outlets.c13}
                </td>
                <td className="mono">
                  {pdu.used.c19}/{pdu.outlets.c19}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Meter({
  label,
  value,
  max,
  unit,
  tone = '',
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  tone?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className={`meter ${tone} ${pct > 100 ? 'is-over' : pct > 80 ? 'is-high' : ''}`}>
      <div className="meter-head">
        <span className="field-label">{label}</span>
        <span className="mono">
          {value} / {max} {unit}
        </span>
      </div>
      <div className="meter-bar">
        <i style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
