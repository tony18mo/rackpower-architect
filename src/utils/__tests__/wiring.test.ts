/** Topology layout for the logical wiring diagram. */

import { describe, expect, it } from 'vitest';
import { DEFAULT_RACK_ID, presetById } from '../../data/racks';
import { specOf } from '../../data/catalogue';
import { buildPowerModel } from '../power';
import { buildWiringGraph, elbow } from '../wiring';
import type { Placement } from '../../types/rack';

const rack = presetById(DEFAULT_RACK_ID);

const placements: Placement[] = [
  { id: 'pduA', instanceId: 'p1', specId: 'pdu-h-32a', startU: 1, spanU: 1, rail: 'rear', feed: 'A' },
  { id: 'pduB', instanceId: 'p2', specId: 'pdu-h-32a', startU: 2, spanU: 1, rail: 'rear', feed: 'B' },
  { id: 'srv1', instanceId: 's1', specId: 'srv-2u-dual', startU: 10, spanU: 2, rail: 'front' },
  { id: 'edge1', instanceId: 'e1', specId: 'srv-1u-edge', startU: 12, spanU: 1, rail: 'front' },
];

const model = buildPowerModel(rack, placements, [], specOf);
const graph = buildWiringGraph(rack, placements, model, specOf);

describe('§3.3 topological mapping', () => {
  it('lays out three ordered columns', () => {
    const sourceXs = graph.nodes.filter((node) => node.kind === 'source').map((node) => node.x);
    const pduXs = graph.nodes.filter((node) => node.kind === 'pdu').map((node) => node.x);
    const deviceXs = graph.nodes.filter((node) => node.kind === 'device').map((node) => node.x);
    expect(Math.max(...sourceXs)).toBeLessThan(Math.min(...pduXs));
    expect(Math.max(...pduXs)).toBeLessThan(Math.min(...deviceXs));
  });

  it('renders one source node per utility feed', () => {
    const sources = graph.nodes.filter((node) => node.kind === 'source');
    expect(sources).toHaveLength(2);
    expect(sources.map((node) => node.feed).sort()).toEqual(['A', 'B']);
  });

  it('maps every PDU in the dual-feed pair to its branch', () => {
    const branchEdges = graph.edges.filter((edge) => edge.kind === 'branch' && edge.from.startsWith('src-'));
    expect(branchEdges).toHaveLength(2);
    expect(new Set(branchEdges.map((edge) => edge.feed))).toEqual(new Set(['A', 'B']));
  });

  it('creates one drop per device PSU', () => {
    const outletEdges = graph.edges.filter((edge) => edge.kind === 'outlet');
    expect(outletEdges).toHaveLength(3); // srv-2u-dual ×2 + srv-1u-edge ×1
    const toSrv = outletEdges.filter((edge) => edge.to === 'dev-srv1');
    expect(toSrv.map((edge) => edge.feed).sort()).toEqual(['A', 'B']);
  });

  it('gives every device node a port per PSU and keeps ports on the left edge', () => {
    const device = graph.nodes.find((node) => node.id === 'dev-srv1')!;
    expect(device.ports).toHaveLength(2);
    expect(device.ports.every((port) => port.x === device.x)).toBe(true);
    expect(device.ports.every((port) => port.y > device.y && port.y < device.y + device.height)).toBe(true);
  });

  it('keeps the whole diagram inside the reported viewBox', () => {
    for (const node of graph.nodes) {
      expect(node.x + node.width).toBeLessThanOrEqual(graph.width);
      expect(node.y + node.height).toBeLessThanOrEqual(graph.height);
    }
  });

  it('feeds totals mirror the power model', () => {
    expect(graph.feedTotalsW.A).toBeCloseTo(model.loadW.A, 6);
    expect(graph.feedTotalsW.B).toBeCloseTo(model.loadW.B, 6);
  });

  it('elbow() builds a rounded orthogonal run between anchors', () => {
    const path = elbow(10, 10, 90, 60);
    expect(path.startsWith('M 10 10')).toBe(true);
    expect(path).toContain('Q');
    expect(path.endsWith('L 90 60')).toBe(true);
    expect(elbow(0, 5, 40, 5)).toBe('M 0 5 L 40 5');
  });
});
