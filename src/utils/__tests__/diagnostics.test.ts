/** Real-time diagnostics aggregation and severity ranking. */

import { describe, expect, it } from 'vitest';
import { DEFAULT_RACK_ID, presetById } from '../../data/racks';
import { specOf } from '../../data/catalogue';
import { collectDiagnostics, diagnosticCounts, placementIsFaulty } from '../diagnostics';
import { buildPowerModel } from '../power';
import type { Placement, RackPreset, VerticalPlacement } from '../../types/rack';

const rack = presetById(DEFAULT_RACK_ID);

function run(placements: Placement[], verticals: VerticalPlacement[] = [], frame: RackPreset = rack) {
  const power = buildPowerModel(frame, placements, verticals, specOf);
  return collectDiagnostics({ rack: frame, placements, verticals, specOf, power });
}

describe('§2.4 collision + clearance diagnostics', () => {
  it('reports an overlap on both offending placements', () => {
    const placements: Placement[] = [
      { id: 'a', instanceId: 'a', specId: 'srv-2u-dual', startU: 10, spanU: 2, rail: 'front' },
      { id: 'b', instanceId: 'b', specId: 'srv-2u-mid', startU: 11, spanU: 2, rail: 'front' },
    ];
    const diagnostics = run(placements);
    const overlaps = diagnostics.filter((diagnostic) => diagnostic.code === 'U_OVERLAP');
    expect(overlaps.length).toBeGreaterThan(0);
    expect(overlaps[0].severity).toBe('error');
    expect(placementIsFaulty(diagnostics, 'a')).toBe('error');
    expect(placementIsFaulty(diagnostics, 'b')).toBe('error');
  });

  it('keeps a clean rack clean', () => {
    const placements: Placement[] = [
      { id: 'pduA', instanceId: 'pa', specId: 'pdu-h-32a', startU: 1, spanU: 1, rail: 'rear', feed: 'A' },
      { id: 'pduB', instanceId: 'pb', specId: 'pdu-h-32a', startU: 5, spanU: 1, rail: 'rear', feed: 'B' },
      { id: 'a', instanceId: 'a', specId: 'srv-2u-dual', startU: 10, spanU: 2, rail: 'front' },
      { id: 'b', instanceId: 'b', specId: 'srv-1u-edge', startU: 12, spanU: 1, rail: 'front' },
    ];
    const diagnostics = run(placements);
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });

  it('surfaces out-of-bounds spans when the frame shrinks under the layout', () => {
    const placements: Placement[] = [
      { id: 'a', instanceId: 'a', specId: 'srv-2u-dual', startU: 20, spanU: 2, rail: 'front' }, // U20-U21 in a 20U frame
    ];
    const diagnostics = run(placements, [], { ...rack, totalU: 20 });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('OUT_OF_BOUNDS');
  });

  it('warns about cord-bend obstruction without blocking the mount', () => {
    const placements: Placement[] = [
      { id: 'pdu', instanceId: 'p', specId: 'pdu-h-c20', startU: 10, spanU: 1, rail: 'rear', feed: 'A' },
      { id: 'srv', instanceId: 's', specId: 'srv-1u-edge', startU: 12, spanU: 1, rail: 'front' },
    ];
    const diagnostics = run(placements);
    const clearance = diagnostics.find((diagnostic) => diagnostic.code === 'CLEARANCE_BLOCKED');
    expect(clearance?.severity).toBe('warning');
    expect(placementIsFaulty(diagnostics, 'srv')).toBe('warning');
  });

  it('errors when a depth profile cannot be closed inside the frame', () => {
    const placements: Placement[] = [
      { id: 'a', instanceId: 'a', specId: 'sto-4u-array', startU: 10, spanU: 4, rail: 'front' },
    ];
    const diagnostics = run(placements, [], { ...rack, externalDepthMm: 800, rearRailOffsetMm: 660 });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('DEPTH_EXCEEDED');
  });

  it('reports zero-U channel overflow', () => {
    const verticals: VerticalPlacement[] = [
      { id: 'v1', instanceId: 'v1', specId: 'pdu-v-42u', channel: 'left', startMm: 0, lengthMm: 1780, feed: 'A' },
      { id: 'v2', instanceId: 'v2', specId: 'pdu-v-30u', channel: 'left', startMm: 1000, lengthMm: 1300, feed: 'B' },
    ];
    const diagnostics = run([], verticals);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain('CHANNEL_OVERLAP');
    expect(codes).toContain('CHANNEL_OVERFLOW');
  });

  it('flags mounted mass beyond the enclosure rating', () => {
    const wallFrame = presetById('rc-22-600x600'); // 150 kg static rating
    const placements = Array.from({ length: 3 }, (_, index): Placement => ({
      id: `a${index}`,
      instanceId: `a${index}`,
      specId: 'sto-4u-array', // 58 kg each
      startU: index * 4 + 1,
      spanU: 4,
      rail: 'front',
    }));
    const diagnostics = run(placements, [], wallFrame);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('LOAD_EXCEEDED');
  });

  it('ranks errors above warnings and infos', () => {
    const placements: Placement[] = [
      { id: 'a', instanceId: 'a', specId: 'srv-2u-dual', startU: 10, spanU: 2, rail: 'front' },
      { id: 'b', instanceId: 'b', specId: 'srv-2u-mid', startU: 11, spanU: 2, rail: 'front' },
      { id: 'pdu', instanceId: 'p', specId: 'pdu-h-c20', startU: 30, spanU: 1, rail: 'rear', feed: 'A' },
      { id: 'srv', instanceId: 's', specId: 'srv-1u-edge', startU: 32, spanU: 1, rail: 'front' },
    ];
    const diagnostics = run(placements);
    const severities = diagnostics.map((diagnostic) => diagnostic.severity);
    const firstWarning = severities.indexOf('warning');
    const lastError = severities.lastIndexOf('error');
    expect(lastError).toBeLessThan(firstWarning === -1 ? severities.length : firstWarning);
    const counts = diagnosticCounts(diagnostics);
    expect(counts.error).toBeGreaterThan(0);
    expect(counts.warning).toBeGreaterThan(0);
  });
});
