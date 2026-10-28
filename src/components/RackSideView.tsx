/**
 * Side cross-section (PRD §3.2).
 *
 * True-to-scale depth profile: front and rear rail planes, chassis depth footprints,
 * cord-bend allowances behind each rear-facing inlet, and the frame obstructions that
 * bound them. Zero-U vertical PDUs are deliberately omitted — they live in the rear
 * cable channels and would clutter the depth story.
 */

import { useMemo, useState } from 'react';
import { usePlanner } from '../state/PlannerContext';
import { specOf } from '../data/catalogue';
import {
  depthEnvelope,
  internalDepthBounds,
  placementTopU,
  uSpanLabel,
} from '../utils/placement';
import { placementIsFaulty } from '../utils/diagnostics';
import type { DeviceSpec, RackPreset } from '../types/rack';

const DEPTH_AXIS_H = 34;
const RULER_W = 46;
const TARGET_W = 720;
const PX_PER_U_STEPS = [6, 9, 12, 16];

export function RackSideView() {
  const { state, dispatch, derived } = usePlanner();
  const { rack, placements } = state;
  const [zoomIndex, setZoomIndex] = useState(1);

  const pxPerU = PX_PER_U_STEPS[zoomIndex];
  const pxPerMm = (TARGET_W - RULER_W) / rack.externalDepthMm;
  const faceHeight = rack.totalU * pxPerU;
  const svgW = RULER_W + rack.externalDepthMm * pxPerMm + 18;
  const svgH = faceHeight + DEPTH_AXIS_H;
  const [minDepth, maxDepth] = internalDepthBounds(rack);

  const rows = useMemo(
    () =>
      placements
        .map((placement) => {
          const spec = specOf(placement.specId);
          if (!spec || spec.category === 'pdu-vertical') return null;
          return { placement, spec, envelope: depthEnvelope(rack, spec, placement.rail) };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((a, b) => a.placement.startU - b.placement.startU),
    [rack, placements],
  );

  const xOfMm = (mm: number) => RULER_W + mm * pxPerMm;

  return (
    <section className="view side-view">
      <header className="view-bar">
        <div className="view-bar-group">
          <span className="field-label">Rear rail plane</span>
          <input
            className="range"
            type="range"
            min={rack.rearRailAdjustRangeMm[0]}
            max={rack.rearRailAdjustRangeMm[1]}
            step={5}
            value={rack.rearRailOffsetMm}
            onChange={(event) => dispatch({ type: 'setRearRail', mm: Number(event.target.value) })}
            aria-label="Rear rail plane offset in millimetres"
          />
          <output className="mono readout">{rack.rearRailOffsetMm} mm</output>
        </div>
        <div className="view-bar-group">
          <span className="field-label">Zoom</span>
          <div className="segmented">
            {PX_PER_U_STEPS.map((step, index) => (
              <button
                key={step}
                type="button"
                className={index === zoomIndex ? 'is-active' : ''}
                onClick={() => setZoomIndex(index)}
              >
                {step}
              </button>
            ))}
          </div>
        </div>
        <p className="view-hint">
          Depth bounds: {minDepth}–{maxDepth} mm between frame obstructions. Front rail sits at{' '}
          {rack.frontRailOffsetMm} mm; a device&rsquo;s hatched tail is the cord-bend allowance its inlet needs.
        </p>
      </header>

      <div className="side-scroll">
        <svg width={svgW} height={svgH} className="side-svg" role="img" aria-label="Rack side cross-section">
          <defs>
            <pattern id="depth-cord" width="7" height="7" patternUnits="userSpaceOnUse">
              <path d="M0 7 L7 0" stroke="var(--cord)" strokeWidth="1" />
            </pattern>
            <pattern id="frame-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M0 6 L6 0" stroke="var(--frame-hatch)" strokeWidth="1.4" />
            </pattern>
          </defs>

          {/* U ruler */}
          {Array.from({ length: rack.totalU }, (_, i) => rack.totalU - i).map((u) => (
            <text
              key={`su-${u}`}
              x={RULER_W - 7}
              y={(rack.totalU - u) * pxPerU + pxPerU / 2 + 3}
              className="u-label"
              textAnchor="end"
            >
              {u}
            </text>
          ))}

          {/* Frame + doors */}
          <rect x={xOfMm(0)} y={0} width={xOfMm(minDepth) - xOfMm(0)} height={faceHeight} fill="url(#frame-hatch)" className="frame-zone" />
          <rect
            x={xOfMm(maxDepth)}
            y={0}
            width={xOfMm(rack.externalDepthMm) - xOfMm(maxDepth)}
            height={faceHeight}
            fill="url(#frame-hatch)"
            className="frame-zone"
          />
          <text x={xOfMm(minDepth / 2)} y={12} className="axis-caption" textAnchor="middle">
            front
          </text>
          <text x={xOfMm((maxDepth + rack.externalDepthMm) / 2)} y={12} className="axis-caption" textAnchor="middle">
            rear
          </text>

          {/* Depth grid every 100 mm */}
          {depthTicks(rack.externalDepthMm).map((mm) => (
            <g key={`tick-${mm}`}>
              <line x1={xOfMm(mm)} y1={0} x2={xOfMm(mm)} y2={faceHeight} className="depth-line" />
              <text x={xOfMm(mm)} y={faceHeight + 14} className="axis-label" textAnchor="middle">
                {mm}
              </text>
            </g>
          ))}
          <text x={svgW / 2} y={svgH - 4} className="axis-caption" textAnchor="middle">
            depth from front reference plane (mm)
          </text>

          {/* Rail planes */}
          <RailPlane x={xOfMm(rack.frontRailOffsetMm)} height={faceHeight} label="front rail" mm={rack.frontRailOffsetMm} />
          <RailPlane x={xOfMm(rack.rearRailOffsetMm)} height={faceHeight} label="rear rail" mm={rack.rearRailOffsetMm} />

          {/* Depth footprints */}
          {rows.map(({ placement, spec, envelope }) => {
            const y = (rack.totalU - placementTopU(placement)) * pxPerU;
            const h = placement.spanU * pxPerU;
            const severity = placementIsFaulty(derived.diagnostics, placement.id);
            return (
              <g
                key={`depth-${placement.id}`}
                className={[
                  'depth-row',
                  severity === 'error' ? 'has-error' : severity === 'warning' ? 'has-warning' : '',
                  state.selectedPlacementId === placement.id ? 'is-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => dispatch({ type: 'select', id: placement.id })}
              >
                <title>
                  {`${spec.vendor} ${spec.model} · ${uSpanLabel(placement.startU, placement.spanU)} · ${placement.rail} rail · ` +
                    `chassis ${envelope.frontMm}–${envelope.rearMm} mm · with cords ${envelope.requiredRearMm} mm` +
                    (envelope.rearOverrunMm > 0 ? ` · overruns by ${envelope.rearOverrunMm} mm` : '')}
                </title>
                <rect
                  x={xOfMm(envelope.frontMm)}
                  y={y}
                  width={Math.max(1, (envelope.rearMm - envelope.frontMm) * pxPerMm)}
                  height={Math.max(1, h - 1)}
                  className={`depth-body ${depthClass(spec)}`}
                />
                {envelope.cordBendMm > 0 && (
                  <rect
                    x={xOfMm(envelope.rearMm)}
                    y={y}
                    width={Math.max(1, envelope.cordBendMm * pxPerMm)}
                    height={Math.max(1, h - 1)}
                    fill="url(#depth-cord)"
                    className="depth-cord"
                  />
                )}
                {h >= 14 && (
                  <text
                    x={xOfMm(envelope.frontMm) + 4}
                    y={y + h / 2 + 3}
                    className="depth-label"
                  >
                    {`${spec.model.slice(0, 22)} · ${spec.depthMm} mm`}
                  </text>
                )}
              </g>
            );
          })}

          {/* Service clearance marker */}
          <line x1={xOfMm(rack.externalDepthMm)} y1={0} x2={xOfMm(rack.externalDepthMm)} y2={faceHeight} className="frame-edge" />
        </svg>
      </div>

      <DepthTable rows={rows} rack={rack} />
    </section>
  );
}

function RailPlane({ x, height, label, mm }: { x: number; height: number; label: string; mm: number }) {
  return (
    <g>
      <line x1={x} y1={0} x2={x} y2={height} className="rail-plane" />
      <text x={x + 3} y={height - 6} className="rail-caption">
        {`${label} ${mm} mm`}
      </text>
    </g>
  );
}

function depthClass(spec: DeviceSpec): string {
  if (spec.category === 'pdu-horizontal') return 'depth-pdu';
  if (spec.category === 'network' || spec.category === 'security') return 'depth-network';
  if (spec.category === 'storage' || spec.category === 'ups') return 'depth-storage';
  if (spec.category === 'patch-panel' || spec.category === 'blank') return 'depth-passive';
  return 'depth-server';
}

function depthTicks(depthMm: number): number[] {
  const step = depthMm > 1100 ? 200 : 100;
  const ticks: number[] = [];
  for (let mm = 0; mm <= depthMm; mm += step) ticks.push(mm);
  return ticks;
}

function DepthTable({
  rows,
  rack,
}: {
  rows: {
    placement: { id: string; startU: number; spanU: number; rail: string };
    spec: DeviceSpec;
    envelope: ReturnType<typeof depthEnvelope>;
  }[];
  rack: RackPreset;
}) {
  if (rows.length === 0) return null;
  return (
    <table className="depth-table">
      <thead>
        <tr>
          <th>unit</th>
          <th>span</th>
          <th>rail</th>
          <th>chassis</th>
          <th>cord bend</th>
          <th>required</th>
          <th>limit</th>
          <th>fit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ placement, spec, envelope }) => (
          <tr key={placement.id} className={envelope.fits ? '' : 'row-bad'}>
            <td>{spec.model}</td>
            <td className="mono">{uSpanLabel(placement.startU, placement.spanU)}</td>
            <td>{placement.rail}</td>
            <td className="mono">{Math.round(envelope.frontMm)}–{Math.round(envelope.rearMm)} mm</td>
            <td className="mono">{envelope.cordBendMm} mm</td>
            <td className="mono">{Math.round(envelope.requiredRearMm)} mm</td>
            <td className="mono">{internalDepthBounds(rack)[1]} mm</td>
            <td>{envelope.fits ? 'ok' : `over by ${Math.round(envelope.rearOverrunMm)} mm`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
