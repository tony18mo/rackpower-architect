/**
 * Logical wiring topology + layout (PRD §3.3).
 *
 * Three columns — utility feeds, PDU pair per feed, device PSUs — with orthogonal
 * feed-coloured runs. Coordinates are produced here so the React view stays a thin
 * renderer and the layout is unit-testable.
 */

import type { DeviceSpec, FeedId, Placement, RackPreset } from '../types/rack';
import { uSpanLabel } from './placement';
import type { PowerConnection, PowerModel } from './power';

export type WiringNodeKind = 'source' | 'pdu' | 'device';

export interface WiringNode {
  id: string;
  kind: WiringNodeKind;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
  feed?: FeedId;
  /** Port anchor points, index-aligned with `ports`. */
  ports: { x: number; y: number; label: string }[];
  meta?: { loadW?: number; outlets?: string };
}

export interface WiringEdge {
  id: string;
  from: string;
  to: string;
  feed: FeedId;
  kind: 'branch' | 'outlet';
  path: string;
  inlet: string;
  watts: number;
  unresolved: boolean;
}

export interface WiringGraph {
  width: number;
  height: number;
  nodes: WiringNode[];
  edges: WiringEdge[];
  feedTotalsW: Record<FeedId, number>;
}

const MARGIN = 24;
const SOURCE_W = 150;
const PDU_W = 232;
const DEVICE_W = 268;
const COL_GAP = 72;
const ROW_GAP = 18;
const PORT_H = 17;
const PDU_PORT_H = 13;
const HEADER_H = 34;

export function buildWiringGraph(
  rack: RackPreset,
  placements: Placement[],
  model: PowerModel,
  specOf: (specId: string) => DeviceSpec | undefined,
): WiringGraph {
  const connectionsByPlacement = new Map<string, PowerConnection[]>();
  for (const connection of model.connections) {
    const list = connectionsByPlacement.get(connection.placementId) ?? [];
    list.push(connection);
    connectionsByPlacement.set(connection.placementId, list);
  }

  const devices = placements
    .filter((placement) => (connectionsByPlacement.get(placement.id)?.length ?? 0) > 0)
    .sort((a, b) => a.startU - b.startU);

  const pduPorts = new Map<string, number>();
  for (const connection of model.connections) {
    if (!connection.pduPlacementId) continue;
    pduPorts.set(connection.pduPlacementId, (pduPorts.get(connection.pduPlacementId) ?? 0) + 1);
  }

  const pdus = [...model.pdus].sort((a, b) => {
    const feedDelta = compareFeed(a.feed, b.feed);
    if (feedDelta !== 0) return feedDelta;
    if (a.kind !== b.kind) return a.kind === 'horizontal' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  const nodes: WiringNode[] = [];
  const edges: WiringEdge[] = [];

  const deviceColumnX = MARGIN + SOURCE_W + COL_GAP + PDU_W + COL_GAP;
  const pduColumnX = MARGIN + SOURCE_W + COL_GAP;

  /* Devices (right column). */
  let deviceY = MARGIN;
  const deviceNodes = new Map<string, WiringNode>();
  for (const placement of devices) {
    const spec = specOf(placement.specId);
    if (!spec) continue;
    const connections = connectionsByPlacement.get(placement.id) ?? [];
    const height = HEADER_H + Math.max(1, spec.psuCount) * PORT_H + 10;
    const node: WiringNode = {
      id: `dev-${placement.id}`,
      kind: 'device',
      label: `${spec.vendor} ${spec.model}`,
      sublabel: `${uSpanLabel(placement.startU, placement.spanU)} · ${spec.powerDrawW} W`,
      x: deviceColumnX,
      y: deviceY,
      width: DEVICE_W,
      height,
      ports: connections.map((connection, index) => ({
        x: deviceColumnX,
        y: deviceY + HEADER_H + index * PORT_H + PORT_H / 2,
        label: `PSU-${connection.psuIndex + 1} · ${connection.inlet}`,
      })),
      meta: { loadW: spec.powerDrawW },
    };
    deviceNodes.set(placement.id, node);
    nodes.push(node);
    deviceY += height + ROW_GAP;
  }
  const deviceStackHeight = deviceY - MARGIN;

  /* PDU pair per feed (middle column). */
  let pduY = MARGIN;
  const pduNodes = new Map<string, WiringNode>();
  for (const pdu of pdus) {
    const spec = specOf(pdu.specId);
    const portCount = Math.max(1, pduPorts.get(pdu.id) ?? 0);
    const height = 24 + portCount * PDU_PORT_H + 12;
    const node: WiringNode = {
      id: `pdu-${pdu.id}`,
      kind: 'pdu',
      label: spec?.model ?? pdu.specId,
      sublabel: pdu.label,
      x: pduColumnX,
      y: pduY,
      width: PDU_W,
      height,
      feed: pdu.feed,
      ports: Array.from({ length: portCount }, (_, index) => ({
        x: pduColumnX + PDU_W,
        y: pduY + 24 + index * PDU_PORT_H + PDU_PORT_H / 2,
        label: `outlet ${index + 1}`,
      })),
      meta: {
        outlets: `${pdu.used.c13}/${pdu.outlets.c13} C13 · ${pdu.used.c19}/${pdu.outlets.c19} C19`,
      },
    };
    pduNodes.set(pdu.id, node);
    nodes.push(node);
    pduY += height + ROW_GAP;
  }
  const pduStackHeight = pduY - MARGIN;

  /* Utility feeds (left column). */
  const stackHeight = Math.max(deviceStackHeight, pduStackHeight, 160);
  const sourceNodes = new Map<FeedId, WiringNode>();
  (['A', 'B'] as FeedId[]).forEach((feed, index) => {
    const height = 74;
    const y =
      index === 0
        ? MARGIN + Math.max(0, stackHeight / 2 - height - ROW_GAP / 2)
        : MARGIN + stackHeight / 2 + ROW_GAP / 2;
    const node: WiringNode = {
      id: `src-${feed}`,
      kind: 'source',
      label: `Utility Feed ${feed}`,
      sublabel: rack.branchCircuitLabel[feed],
      x: MARGIN,
      y,
      width: SOURCE_W,
      height,
      feed,
      ports: [
        { x: MARGIN + SOURCE_W, y: y + height / 2, label: 'branch' },
      ],
      meta: { loadW: model.loadW[feed] },
    };
    sourceNodes.set(feed, node);
    nodes.push(node);
  });

  /* Edges: feed → PDU. */
  for (const pdu of pdus) {
    const source = pdu.feed ? sourceNodes.get(pdu.feed) : undefined;
    const target = pduNodes.get(pdu.id);
    if (!source || !target) continue;
    const from = source.ports[0];
    const to = { x: target.x, y: target.y + target.height / 2 };
    edges.push({
      id: `edge-${source.id}-${target.id}`,
      from: source.id,
      to: target.id,
      feed: pdu.feed ?? 'A',
      kind: 'branch',
      path: elbow(from.x, from.y, to.x, to.y),
      inlet: 'IEC-309 branch',
      watts: 0,
      unresolved: false,
    });
  }

  /* Edges: PDU outlet → device PSU. */
  const pduCursor = new Map<string, number>();
  for (const placement of devices) {
    const connections = connectionsByPlacement.get(placement.id) ?? [];
    const target = deviceNodes.get(placement.id);
    if (!target) continue;
    connections.forEach((connection, portIndex) => {
      const port = target.ports[portIndex];
      const feed = connection.feed;
      const sourceNode = connection.pduPlacementId
        ? pduNodes.get(connection.pduPlacementId)
        : sourceNodes.get(feed);
      if (!sourceNode) return;
      let from: { x: number; y: number };
      let kind: WiringEdge['kind'];
      if (connection.pduPlacementId) {
        const cursor = pduCursor.get(sourceNode.id) ?? 0;
        pduCursor.set(sourceNode.id, cursor + 1);
        const nodePort = sourceNode.ports[Math.min(cursor, sourceNode.ports.length - 1)];
        from = { x: nodePort.x, y: nodePort.y };
        kind = 'outlet';
      } else {
        // IEC-309 inlets land directly on the branch; other starved PSUs are shown
        // from the feed so the gap is visible instead of silently dropped.
        from = { x: sourceNode.ports[0].x, y: sourceNode.ports[0].y };
        kind = 'branch';
      }
      edges.push({
        id: `edge-${sourceNode.id}-${target.id}-${portIndex}`,
        from: sourceNode.id,
        to: target.id,
        feed,
        kind,
        path: elbow(from.x, from.y, port.x, port.y),
        inlet: connection.inlet,
        watts: connection.watts,
        unresolved: kind === 'outlet' ? false : connection.target === 'branch' ? false : true,
      });
    });
  }

  return {
    width: deviceColumnX + DEVICE_W + MARGIN,
    height: stackHeight + MARGIN * 2,
    nodes,
    edges,
    feedTotalsW: model.loadW,
  };
}

function compareFeed(a: FeedId | undefined, b: FeedId | undefined): number {
  return (a ?? 'Z').localeCompare(b ?? 'Z');
}

/** Rounded orthogonal run between two anchors. */
export function elbow(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  const radius = Math.min(10, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
  if (radius <= 0 || y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const down = y2 > y1 ? 1 : -1;
  return [
    `M ${x1} ${y1}`,
    `L ${midX - radius} ${y1}`,
    `Q ${midX} ${y1} ${midX} ${y1 + radius * down}`,
    `L ${midX} ${y2 - radius * down}`,
    `Q ${midX} ${y2} ${midX + radius} ${y2}`,
    `L ${x2} ${y2}`,
  ].join(' ');
}
