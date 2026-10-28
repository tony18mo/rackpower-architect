/**
 * Front rack elevation (PRD §3.1).
 *
 * U-by-U grid with true EIA-310-D rail holes, mounted equipment blocks, Feed A/B
 * cabling indicators, PDU cord-bend buffers rendered as hatched zones, and
 * drag-and-drop re-seating that is validated by the spatial engine before commit.
 */

import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { usePlanner } from '../state/PlannerContext';
import { specOf } from '../data/catalogue';
import {
  clearanceZones,
  placementTopU,
  uSpanLabel,
  validateRequest,
} from '../utils/placement';
import { placementIsFaulty } from '../utils/diagnostics';
import { feedColor } from '../utils/power';
import type { PowerConnection } from '../utils/power';
import { EIA310_HOLE_PITCH_MM, MM_PER_U, type Placement, type RailPosition } from '../types/rack';
import {
  anchorForDrop,
  beginDrag,
  endDrag,
  makeGeometry,
  peekDrag,
  readDragPayload,
  setDragPayload,
  slotAtOffset,
  type DragPayload,
} from '../utils/view';

const RULER_W = 46;
const RAIL_W = 14;
const FACE_W = 386;
const PX_STEPS = [12, 15, 19, 24, 30];

const CATEGORY_CLASS: Record<string, string> = {
  server: 'cat-server',
  storage: 'cat-storage',
  network: 'cat-network',
  security: 'cat-security',
  kvm: 'cat-kvm',
  'patch-panel': 'cat-passive',
  blank: 'cat-passive',
  'pdu-horizontal': 'cat-pdu',
  'pdu-vertical': 'cat-pdu',
  ups: 'cat-ups',
};

interface Ghost {
  startU: number;
  spanU: number;
  valid: boolean;
  reason?: string;
}

export function RackVisualizer() {
  const { state, dispatch, derived } = usePlanner();
  const { rack, placements } = state;
  const [zoomIndex, setZoomIndex] = useState(2);
  const [dropRail, setDropRail] = useState<RailPosition>('front');
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const faceRef = useRef<HTMLDivElement>(null);

  const pxPerU = PX_STEPS[zoomIndex];
  const geometry = useMemo(() => makeGeometry(rack.totalU, pxPerU), [rack.totalU, pxPerU]);
  const faceHeight = rack.totalU * pxPerU;

  const connectionsByPlacement = useMemo(() => {
    const map = new Map<string, PowerConnection[]>();
    for (const connection of derived.power.connections) {
      const list = map.get(connection.placementId) ?? [];
      list.push(connection);
      map.set(connection.placementId, list);
    }
    return map;
  }, [derived.power]);

  const buffers = useMemo(
    () =>
      placements.flatMap((placement) => {
        const spec = specOf(placement.specId);
        if (!spec) return [];
        return clearanceZones(rack, spec, placement).map((zone) => ({
          zone,
          placementId: placement.id,
        }));
      }),
    [rack, placements],
  );

  function pointerSlot(event: DragEvent): number | null {
    const node = faceRef.current;
    if (!node) return null;
    return slotAtOffset(event.clientY - node.getBoundingClientRect().top, geometry);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    const payload = peekDrag();
    if (!payload) return;
    event.preventDefault();
    const hovered = pointerSlot(event);
    if (hovered === null) return;
    const startU = anchorForDrop(hovered, payload.spanU, geometry);
    const violations = validateRequest(rack, specOf, placements, {
      instanceId: payload.uid ?? payload.placementId ?? '',
      specId: payload.specId,
      startU,
      spanU: payload.spanU,
      rail: dropRail,
      movingPlacementId: payload.placementId,
    });
    const error = violations.find((violation) => violation.severity === 'error');
    setGhost({ startU, spanU: payload.spanU, valid: !error, reason: error?.message });
    event.dataTransfer.dropEffect = error ? 'none' : 'move';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const payload = readDragPayload(event);
    const hovered = pointerSlot(event);
    setGhost(null);
    if (!payload || hovered === null) {
      endDrag();
      return;
    }
    const startU = anchorForDrop(hovered, payload.spanU, geometry);
    if (payload.kind === 'placement' && payload.placementId) {
      dispatch({ type: 'movePlacement', id: payload.placementId, startU, rail: dropRail });
    } else if (payload.uid) {
      dispatch({ type: 'mount', uid: payload.uid, startU, rail: dropRail });
    }
    endDrag();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const id = state.selectedPlacementId;
    if (!id) return;
    const placement = placements.find((candidate) => candidate.id === id);
    if (!placement) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const delta = event.key === 'ArrowUp' ? 1 : -1;
      dispatch({
        type: 'movePlacement',
        id,
        startU: placement.startU + delta,
        rail: placement.rail,
      });
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      dispatch({ type: 'removePlacement', id });
    }
  }

  return (
    <section className="view rack-view">
      <header className="view-bar">
        <div className="view-bar-group">
          <span className="field-label">Drop rail</span>
          <div className="segmented" role="group" aria-label="Drop rail">
            {(['front', 'rear'] as RailPosition[]).map((rail) => (
              <button
                key={rail}
                type="button"
                className={dropRail === rail ? 'is-active' : ''}
                onClick={() => setDropRail(rail)}
              >
                {rail}
              </button>
            ))}
          </div>
        </div>
        <div className="view-bar-group">
          <span className="field-label">Zoom</span>
          <div className="segmented">
            {PX_STEPS.map((step, index) => (
              <button
                key={step}
                type="button"
                className={index === zoomIndex ? 'is-active' : ''}
                onClick={() => setZoomIndex(index)}
                title={`${step} px per U`}
              >
                {step}
              </button>
            ))}
          </div>
        </div>
        <p className="view-hint">
          Drag a unit from the tray onto the elevation, or grab a mounted block to re-seat it.
          Drops are rejected when they collide. ↑ / ↓ nudges the selection, Delete unmounts it.
        </p>
      </header>

      <div className="rack-scroll">
        <div
          className="rack-face"
          ref={faceRef}
          style={{ width: RULER_W + FACE_W, height: faceHeight }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setGhost(null);
          }}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="application"
          aria-label={`${rack.totalU}U front elevation`}
        >
          <svg
            className="rack-grid"
            width={RULER_W + FACE_W}
            height={faceHeight}
            aria-hidden="true"
            style={{ pointerEvents: 'none' }}
          >
            <defs>
              <pattern id="cord-bend" width="8" height="8" patternUnits="userSpaceOnUse">
                <path d="M0 8 L8 0" stroke="var(--cord)" strokeWidth="1.2" />
              </pattern>
            </defs>

            {/* U ruler + slot lines */}
            {Array.from({ length: rack.totalU }, (_, i) => rack.totalU - i).map((u) => {
              const y = geometry.yTop(u);
              return (
                <g key={`slot-${u}`}>
                  <line x1={RULER_W} y1={y} x2={RULER_W + FACE_W} y2={y} className="slot-line" />
                  <text x={RULER_W - 8} y={y + pxPerU / 2 + 3.5} className="u-label" textAnchor="end">
                    {u}
                  </text>
                  {pxPerU >= 15 && (
                    <>
                      <rect x={RULER_W} y={y} width={RAIL_W} height={pxPerU} className="rail-strip" />
                      <rect
                        x={RULER_W + FACE_W - RAIL_W}
                        y={y}
                        width={RAIL_W}
                        height={pxPerU}
                        className="rail-strip"
                      />
                      {[0, 1, 2].map((hole) => (
                        <g key={hole}>
                          <rect
                            x={RULER_W + RAIL_W / 2 - 1.8}
                            y={y + (hole * EIA310_HOLE_PITCH_MM) / MM_PER_U * pxPerU + 1.5}
                            width={3.6}
                            height={3.6}
                            className="rail-hole"
                          />
                          <rect
                            x={RULER_W + FACE_W - RAIL_W / 2 - 1.8}
                            y={y + (hole * EIA310_HOLE_PITCH_MM) / MM_PER_U * pxPerU + 1.5}
                            width={3.6}
                            height={3.6}
                            className="rail-hole"
                          />
                        </g>
                      ))}
                    </>
                  )}
                </g>
              );
            })}
            <line
              x1={RULER_W}
              y1={faceHeight}
              x2={RULER_W + FACE_W}
              y2={faceHeight}
              className="slot-line"
            />

            {/* Cord-bend buffers reserved by horizontal PDUs */}
            {buffers.map(({ zone, placementId }) => (
              <rect
                key={`${placementId}-${zone.side}`}
                x={RULER_W + RAIL_W}
                y={geometry.yTop(zone.endU)}
                width={FACE_W - RAIL_W * 2}
                height={geometry.height(zone.endU - zone.startU + 1)}
                fill="url(#cord-bend)"
                className="cord-zone"
              />
            ))}

            {/* Ghost preview of the pending drop */}
            {ghost && (
              <rect
                x={RULER_W + RAIL_W}
                y={geometry.yTop(ghost.startU + ghost.spanU - 1)}
                width={FACE_W - RAIL_W * 2}
                height={geometry.height(ghost.spanU)}
                className={ghost.valid ? 'drop-ghost drop-ghost-ok' : 'drop-ghost drop-ghost-bad'}
              />
            )}
          </svg>

          {placements.map((placement) => (
            <UnitBlock
              key={placement.id}
              placement={placement}
              top={geometry.yTop(placementTopU(placement))}
              height={geometry.height(placement.spanU)}
              pxPerU={pxPerU}
              connections={connectionsByPlacement.get(placement.id) ?? []}
            />
          ))}
        </div>

        {ghost?.reason && <p className="ghost-reason">{ghost.reason}</p>}
      </div>

      <footer className="rack-legend">
        {Object.entries(CATEGORY_CLASS)
          .filter(([category]) => category !== 'pdu-vertical')
          .map(([category]) => (
            <span key={category} className="legend-chip">
              <i className={`swatch cat-${category}`} />
              {category}
            </span>
          ))}
        <span className="legend-chip">
          <i className="swatch feed-a" />feed A
        </span>
        <span className="legend-chip">
          <i className="swatch feed-b" />feed B
        </span>
        <span className="legend-chip">
          <i className="swatch cord" />cord-bend buffer
        </span>
      </footer>
    </section>
  );
}

function UnitBlock({
  placement,
  top,
  height,
  pxPerU,
  connections,
}: {
  placement: Placement;
  top: number;
  height: number;
  pxPerU: number;
  connections: PowerConnection[];
}) {
  const { state, dispatch, derived } = usePlanner();
  const spec = specOf(placement.specId);
  if (!spec) return null;
  const selected = state.selectedPlacementId === placement.id;
  const severity = placementIsFaulty(derived.diagnostics, placement.id);

  const payload: DragPayload = {
    kind: 'placement',
    placementId: placement.id,
    uid: placement.instanceId,
    specId: spec.id,
    spanU: placement.spanU,
    model: spec.model,
    rail: placement.rail,
  };

  return (
    <div
      className={[
        'unit',
        CATEGORY_CLASS[spec.category] ?? 'cat-passive',
        selected ? 'is-selected' : '',
        severity === 'error' ? 'has-error' : severity === 'warning' ? 'has-warning' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ top, height, left: RULER_W + RAIL_W - 2, width: FACE_W - (RAIL_W - 2) * 2 }}
      draggable
      onDragStart={(event) => {
        setDragPayload(event, payload);
        beginDrag(payload);
      }}
      onDragEnd={endDrag}
      onClick={() => dispatch({ type: 'select', id: placement.id })}
      title={`${spec.vendor} ${spec.model} · ${uSpanLabel(placement.startU, placement.spanU)} · ${spec.depthMm} mm deep · ${spec.powerDrawW} W`}
      role="button"
      aria-label={`${spec.model} at ${uSpanLabel(placement.startU, placement.spanU)} on the ${placement.rail} rail`}
    >
      <span className="unit-model">{spec.model}</span>
      <span className="unit-u">{uSpanLabel(placement.startU, placement.spanU)}</span>
      <span className={`unit-rail rail-${placement.rail}`}>{placement.rail === 'front' ? 'F' : 'R'}</span>
      {height >= pxPerU * 2 && (
        <span className="unit-meta">
          {spec.depthMm} mm · {spec.powerDrawW} W · {spec.weightKg} kg
          {placement.feed ? ` · feed ${placement.feed}` : ''}
        </span>
      )}
      {height >= pxPerU * 3 && (
        <span className="unit-sub">
          {spec.vendor} · {spec.psuCount} PSU · inlets {spec.inlets.join('/') || '—'}
        </span>
      )}
      <span className="unit-feeds">
        {connections.map((connection) => (
          <i
            key={`${connection.placementId}-${connection.psuIndex}`}
            className="feed-dot"
            style={{ background: feedColor(connection.feed) }}
            title={`PSU-${connection.psuIndex + 1} · ${connection.inlet} · feed ${connection.feed}${
              connection.pduPlacementId ? ` · ${connection.pduPlacementId}` : ' · direct branch'
            }`}
          />
        ))}
      </span>
    </div>
  );
}
