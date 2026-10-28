/**
 * Real-time spatial diagnostics (PRD §2.4).
 *
 * Combines collision detection, rail/depth conflicts, cord-bend obstruction,
 * zero-U channel overflow and capacity headroom into one severity-ranked list that
 * every view can render.
 */

import type {
  DeviceSpec,
  Diagnostic,
  Placement,
  RackPreset,
  Severity,
  VerticalPlacement,
} from '../types/rack';
import {
  occupancyGrid,
  placementTopU,
  uSpanLabel,
  validateRequest,
  validateVerticals,
} from './placement';
import { powerDiagnostics, type PowerModel } from './power';

export interface DiagnosticsContext {
  rack: RackPreset;
  placements: Placement[];
  verticals: VerticalPlacement[];
  specOf: (specId: string) => DeviceSpec | undefined;
  power?: PowerModel;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function collectDiagnostics(context: DiagnosticsContext): Diagnostic[] {
  const { rack, placements, verticals, specOf, power } = context;
  const diagnostics: Diagnostic[] = [];
  let seq = 0;
  const add = (diagnostic: Omit<Diagnostic, 'id'>) => {
    seq += 1;
    diagnostics.push({ id: `d-${seq}`, ...diagnostic });
  };

  for (const placement of placements) {
    const spec = specOf(placement.specId);
    if (!spec) continue;
    const violations = validateRequest(rack, specOf, placements, {
      instanceId: placement.instanceId,
      specId: placement.specId,
      startU: placement.startU,
      spanU: placement.spanU,
      rail: placement.rail,
      movingPlacementId: placement.id,
    });
    for (const violation of violations) {
      add({
        code: violation.code,
        severity: violation.severity,
        message: violation.message,
        subject: `${spec.vendor} ${spec.model} (${uSpanLabel(placement.startU, placement.spanU)} ${placement.rail} rail)`,
        uRange: violation.uRange,
        placementIds: [placement.id],
      });
    }
  }

  for (const violation of validateVerticals(rack, verticals, specOf)) {
    add({
      code: violation.code,
      severity: violation.severity,
      message: violation.message,
      subject: 'Zero-U channel',
      placementIds: [],
    });
  }

  diagnostics.push(...capacityDiagnostics(context));
  if (power) diagnostics.push(...powerDiagnostics(rack, power));

  const unique = new Map<string, Diagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}|${diagnostic.severity}|${diagnostic.message}`;
    if (!unique.has(key)) unique.set(key, diagnostic);
  }

  const sorted = [...unique.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.uRange?.[0] ?? 0) - (b.uRange?.[0] ?? 0) ||
      a.subject.localeCompare(b.subject),
  );

  if (sorted.length === 0) {
    return [
      {
        id: 'd-ok',
        code: 'OK',
        severity: 'info',
        message: `No collisions, depth conflicts or clearance obstructions across the ${rack.totalU}U grid.`,
        subject: 'Spatial engine',
        placementIds: [],
      },
    ];
  }
  return sorted;
}

function capacityDiagnostics({ rack, placements, specOf }: DiagnosticsContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const grid = occupancyGrid(rack, placements);
  const used = grid.filter((entry) => entry !== null).length;
  const free = rack.totalU - used;

  const weightKg = placements.reduce((sum, placement) => {
    const spec = specOf(placement.specId);
    return spec ? sum + spec.weightKg : sum;
  }, 0);

  if (weightKg > rack.maxStaticLoadKg) {
    diagnostics.push({
      id: 'c-load',
      code: 'LOAD_EXCEEDED',
      severity: 'error',
      message: `Mounted mass ${round1(weightKg)} kg exceeds the ${rack.maxStaticLoadKg} kg static rating of the enclosure.`,
      subject: rack.name,
      placementIds: [],
    });
  } else if (weightKg > rack.maxStaticLoadKg * 0.8) {
    diagnostics.push({
      id: 'c-load',
      code: 'LOAD_EXCEEDED',
      severity: 'warning',
      message: `Mounted mass ${round1(weightKg)} kg is above 80% of the ${rack.maxStaticLoadKg} kg static rating.`,
      subject: rack.name,
      placementIds: [],
    });
  }

  if (free === 0) {
    diagnostics.push({
      id: 'c-cap',
      code: 'U_CAPACITY',
      severity: 'info',
      message: `All ${rack.totalU}U are consumed; no further horizontal device can be mounted.`,
      subject: 'U capacity',
      placementIds: [],
    });
  } else if (free <= 2) {
    diagnostics.push({
      id: 'c-cap',
      code: 'U_CAPACITY',
      severity: 'warning',
      message: `Only ${free} free U slot${free === 1 ? '' : 's'} remain; cord-bend buffers may be unbuildable.`,
      subject: 'U capacity',
      placementIds: [],
    });
  }

  return diagnostics;
}

export function diagnosticCounts(diagnostics: Diagnostic[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) counts[diagnostic.severity] += 1;
  return counts;
}

export function hasBlockingErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function placementIsFaulty(diagnostics: Diagnostic[], placementId: string): Severity | null {
  let worst: Severity | null = null;
  for (const diagnostic of diagnostics) {
    if (!diagnostic.placementIds.includes(placementId)) continue;
    if (worst === null || SEVERITY_ORDER[diagnostic.severity] < SEVERITY_ORDER[worst]) {
      worst = diagnostic.severity;
    }
  }
  return worst;
}

export function topU(placement: Placement): number {
  return placementTopU(placement);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
