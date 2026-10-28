/**
 * Logical wiring diagram (PRD §3.3).
 *
 * Topology is laid out in `utils/wiring.ts`; this component only renders it:
 * utility feeds → dual-feed PDU pairs → per-PSU drops, colour-coded by feed.
 */

import { usePlanner } from '../state/PlannerContext';
import type { FeedId } from '../types/rack';
import type { WiringGraph, WiringNode } from '../utils/wiring';

export function WiringDiagram() {
  const { derived, dispatch } = usePlanner();
  const graph = derived.wiring;
  const deviceNodes = graph.nodes.filter((node) => node.kind === 'device');

  return (
    <section className="view wiring-view">
      <header className="view-bar">
        {(['A', 'B'] as FeedId[]).map((feed) => {
          const load = graph.feedTotalsW[feed];
          const capacity = derived.power.capacityW[feed];
          const pct = capacity > 0 ? Math.round((load / capacity) * 100) : 0;
          return (
            <div key={feed} className={`feed-total feed-${feed.toLowerCase()}`}>
              <strong>Feed {feed}</strong>
              <span className="mono">{Math.round(load)} W / {capacity} W</span>
              <span className={`bar ${pct > 100 ? 'is-over' : pct > 80 ? 'is-high' : ''}`}>
                <i style={{ width: `${Math.min(100, pct)}%` }} />
              </span>
              <span className="mono muted">{pct}%</span>
            </div>
          );
        })}
        <p className="view-hint">
          {deviceNodes.length} powered {deviceNodes.length === 1 ? 'unit' : 'units'} ·{' '}
          {derived.power.pdus.length} PDU{derived.power.pdus.length === 1 ? '' : 's'} ·{' '}
          {derived.power.connections.length} PSU runs. IEC-309 inlets terminate straight on the branch;
          dashed runs mark PSUs with no source on their feed.
        </p>
      </header>

      {graph.nodes.length === 0 || deviceNodes.length === 0 ? (
        <p className="empty">
          Nothing powered yet. Mount a PDU and powered devices — or stage units and run Auto-place — to
          generate the distribution topology.
        </p>
      ) : (
        <div className="wiring-scroll">
          <svg
            width={graph.width}
            height={graph.height}
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            className="wiring-svg"
            role="img"
            aria-label="Power distribution topology"
          >
            <ColumnHeader x={MARGIN_X(graph, 'source')} label="utility feeds" />
            <ColumnHeader x={MARGIN_X(graph, 'pdu')} label="PDU pair (dual feed)" />
            <ColumnHeader x={MARGIN_X(graph, 'device')} label="device PSUs" />

            {graph.edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.path}
                className={`wire ${edge.kind} ${edge.unresolved ? 'is-unresolved' : ''} feed-${edge.feed.toLowerCase()}`}
                fill="none"
              />
            ))}

            {graph.nodes.map((node) => (
              <WiringNodeView key={node.id} node={node} onSelect={() => node.id.startsWith('dev-') && dispatch({ type: 'select', id: node.id.slice(4) })} />
            ))}
          </svg>
        </div>
      )}
    </section>
  );
}

function MARGIN_X(graph: WiringGraph, kind: WiringNode['kind']): number {
  const nodes = graph.nodes.filter((node) => node.kind === kind);
  if (nodes.length === 0) return 0;
  return Math.min(...nodes.map((node) => node.x));
}

function ColumnHeader({ x, label }: { x: number; label: string }) {
  if (x === 0) return null;
  return (
    <text x={x} y={14} className="wiring-column">
      {label}
    </text>
  );
}

function WiringNodeView({ node, onSelect }: { node: WiringNode; onSelect: () => void }) {
  const feedClass = node.feed ? ` feed-${node.feed.toLowerCase()}` : '';
  return (
    <g
      className={`wnode wnode-${node.kind}${feedClass}`}
      onClick={onSelect}
      role={node.kind === 'device' ? 'button' : undefined}
    >
      <title>{`${node.label} — ${node.sublabel}${node.meta?.outlets ? ` · ${node.meta.outlets}` : ''}`}</title>
      <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={5} />
      <text x={node.x + 10} y={node.y + 17} className="wnode-label">
        {truncate(node.label, node.kind === 'device' ? 30 : 26)}
      </text>
      <text x={node.x + 10} y={node.y + 30} className="wnode-sub">
        {truncate(node.sublabel, 40)}
      </text>
      {node.meta?.outlets && (
        <text x={node.x + 10} y={node.y + node.height - 6} className="wnode-meta">
          {node.meta.outlets}
        </text>
      )}
      {node.meta?.loadW !== undefined && node.kind === 'source' && (
        <text x={node.x + 10} y={node.y + node.height - 8} className="wnode-meta mono">
          {`${Math.round(node.meta.loadW)} W drawn`}
        </text>
      )}
      {node.ports.map((port, index) => (
        <circle
          key={`${node.id}-p${index}`}
          cx={port.x}
          cy={port.y}
          r={2.6}
          className={`wport${feedClass}`}
        >
          <title>{port.label}</title>
        </circle>
      ))}
    </g>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
