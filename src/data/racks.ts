/** Rack enclosure presets (PRD §2.1 "rack preset or custom height definition"). */

import type { RackPreset } from '../types/rack';
import { MM_PER_U } from '../types/rack';
import { uToMm } from '../utils/placement';

export const RACK_PRESETS: RackPreset[] = [
  {
    id: 'rc-42-800x1200',
    name: '42U Enterprise 800 × 1200 mm',
    totalU: 42,
    externalWidthMm: 800,
    externalDepthMm: 1200,
    frontRailOffsetMm: 60,
    rearRailOffsetMm: 1000,
    rearRailAdjustRangeMm: [600, 1050],
    frontObstructionMm: 40,
    rearObstructionMm: 40,
    zeroUChannelWidthMm: 90,
    maxStaticLoadKg: 1400,
    feedCapacityW: { A: 5888, B: 5888 },
    branchCircuitLabel: { A: 'Branch A · 32 A / 230 V 1Φ IEC-309', B: 'Branch B · 32 A / 230 V 1Φ IEC-309' },
  },
  {
    id: 'rc-42-600x1070',
    name: '42U Compact 600 × 1070 mm',
    totalU: 42,
    externalWidthMm: 600,
    externalDepthMm: 1070,
    frontRailOffsetMm: 45,
    rearRailOffsetMm: 900,
    rearRailAdjustRangeMm: [500, 950],
    frontObstructionMm: 25,
    rearObstructionMm: 25,
    zeroUChannelWidthMm: 70,
    maxStaticLoadKg: 1000,
    feedCapacityW: { A: 5888, B: 5888 },
    branchCircuitLabel: { A: 'Branch A · 32 A / 230 V 1Φ IEC-309', B: 'Branch B · 32 A / 230 V 1Φ IEC-309' },
  },
  {
    id: 'rc-45-800x1200',
    name: '45U High 800 × 1200 mm',
    totalU: 45,
    externalWidthMm: 800,
    externalDepthMm: 1200,
    frontRailOffsetMm: 60,
    rearRailOffsetMm: 1000,
    rearRailAdjustRangeMm: [600, 1050],
    frontObstructionMm: 40,
    rearObstructionMm: 40,
    zeroUChannelWidthMm: 90,
    maxStaticLoadKg: 1500,
    feedCapacityW: { A: 7360, B: 7360 },
    branchCircuitLabel: { A: 'Branch A · 40 A / 230 V 1Φ IEC-309', B: 'Branch B · 40 A / 230 V 1Φ IEC-309' },
  },
  {
    id: 'rc-48-800x1400',
    name: '48U Max-Depth 800 × 1400 mm',
    totalU: 48,
    externalWidthMm: 800,
    externalDepthMm: 1400,
    frontRailOffsetMm: 60,
    rearRailOffsetMm: 1200,
    rearRailAdjustRangeMm: [700, 1250],
    frontObstructionMm: 40,
    rearObstructionMm: 40,
    zeroUChannelWidthMm: 95,
    maxStaticLoadKg: 1600,
    feedCapacityW: { A: 7360, B: 7360 },
    branchCircuitLabel: { A: 'Branch A · 40 A / 230 V 1Φ IEC-309', B: 'Branch B · 40 A / 230 V 1Φ IEC-309' },
  },
  {
    id: 'rc-22-600x600',
    name: '22U Wall-Mount 600 × 600 mm',
    totalU: 22,
    externalWidthMm: 600,
    externalDepthMm: 600,
    frontRailOffsetMm: 20,
    rearRailOffsetMm: 500,
    rearRailAdjustRangeMm: [300, 540],
    frontObstructionMm: 6,
    rearObstructionMm: 6,
    zeroUChannelWidthMm: 45,
    maxStaticLoadKg: 150,
    feedCapacityW: { A: 2944, B: 2944 },
    branchCircuitLabel: { A: 'Branch A · 16 A / 230 V 1Φ', B: 'Branch B · 16 A / 230 V 1Φ' },
  },
  {
    id: 'rc-12-600x800',
    name: '12U Edge 600 × 800 mm',
    totalU: 12,
    externalWidthMm: 600,
    externalDepthMm: 800,
    frontRailOffsetMm: 30,
    rearRailOffsetMm: 700,
    rearRailAdjustRangeMm: [400, 750],
    frontObstructionMm: 15,
    rearObstructionMm: 15,
    zeroUChannelWidthMm: 60,
    maxStaticLoadKg: 250,
    feedCapacityW: { A: 2944, B: 2944 },
    branchCircuitLabel: { A: 'Branch A · 16 A / 230 V 1Φ', B: 'Branch B · 16 A / 230 V 1Φ' },
  },
];

export const DEFAULT_RACK_ID = RACK_PRESETS[0].id;

export function presetById(id: string): RackPreset {
  return RACK_PRESETS.find((preset) => preset.id === id) ?? RACK_PRESETS[0];
}

/** Builds the custom-height rack definition the UI exposes (PRD §2.1). */
export function customRack(totalU: number, depthMm: number): RackPreset {
  const safeU = Math.max(1, Math.min(60, Math.round(totalU)));
  const safeDepth = Math.max(300, Math.min(1600, Math.round(depthMm)));
  const rearRail = Math.round(safeDepth * 0.82);
  return {
    id: `rc-custom-${safeU}-${safeDepth}`,
    name: `Custom ${safeU}U × ${safeDepth} mm`,
    totalU: safeU,
    externalWidthMm: 600,
    externalDepthMm: safeDepth,
    frontRailOffsetMm: Math.round(safeDepth * 0.05) + 10,
    rearRailOffsetMm: rearRail,
    rearRailAdjustRangeMm: [Math.round(safeDepth * 0.4), Math.max(1, safeDepth - 50)],
    frontObstructionMm: 25,
    rearObstructionMm: 25,
    zeroUChannelWidthMm: 70,
    maxStaticLoadKg: Math.round(safeU * 28),
    feedCapacityW: { A: 5888, B: 5888 },
    branchCircuitLabel: {
      A: 'Branch A · 32 A / 230 V 1Φ IEC-309',
      B: 'Branch B · 32 A / 230 V 1Φ IEC-309',
    },
  };
}

/** Total internal mounting pitch of a rack, in mm. */
export function rackMountingHeightMm(rack: RackPreset): number {
  return uToMm(rack.totalU);
}

export function rackHeightMm(rack: RackPreset): number {
  return rack.totalU * MM_PER_U;
}
