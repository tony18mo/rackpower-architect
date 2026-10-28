/** Shared view geometry + drag-and-drop payload plumbing. */

import type { DragEvent as ReactDragEvent } from 'react';
import type { RailPosition } from '../types/rack';

export const DND_MIME = 'application/x-rackpower-unit';

export interface DragPayload {
  kind: 'inventory' | 'placement';
  /** Inventory instance uid (when dragging from the tray). */
  uid?: string;
  /** Placement id (when re-seating an already-mounted unit). */
  placementId?: string;
  specId: string;
  spanU: number;
  model: string;
  /** Rail the unit was mounted on, used as the default for a move. */
  rail: RailPosition;
}

export function setDragPayload(event: ReactDragEvent, payload: DragPayload): void {
  event.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
  event.dataTransfer.setData('text/plain', payload.model);
  event.dataTransfer.effectAllowed = 'move';
}

export function readDragPayload(event: ReactDragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(DND_MIME) || event.dataTransfer.getData('text/plain');
  if (!raw) return peekDrag();
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (!parsed || typeof parsed.specId !== 'string' || typeof parsed.spanU !== 'number') return null;
    return parsed;
  } catch {
    return peekDrag();
  }
}

/**
 * Browsers hide custom `setData` payloads during `dragover` for security, but the
 * ghost preview needs span/rail information while the pointer moves. The drag is
 * mirrored here for the lifetime of the gesture.
 */
let currentDragPayload: DragPayload | null = null;

export function beginDrag(payload: DragPayload): void {
  currentDragPayload = payload;
}

export function endDrag(): void {
  currentDragPayload = null;
}

export function peekDrag(): DragPayload | null {
  return currentDragPayload;
}

export interface RackGeometry {
  /** Pixels rendered per EIA-310-D rack unit. */
  pxPerU: number;
  totalU: number;
  /** Y coordinate (px) of the top edge of U slot `u`. */
  yTop: (u: number) => number;
  /** Height in px of a `spanU` block. */
  height: (spanU: number) => number;
}

export function makeGeometry(totalU: number, pxPerU: number): RackGeometry {
  return {
    pxPerU,
    totalU,
    yTop: (u: number) => (totalU - u) * pxPerU,
    height: (spanU: number) => spanU * pxPerU,
  };
}

/**
 * U slot under a pointer offset measured from the top of the rack face.
 * Rack units increase upward, so the topmost row is U(totalU).
 */
export function slotAtOffset(offsetY: number, geometry: RackGeometry): number {
  const row = Math.floor(offsetY / geometry.pxPerU);
  const clamped = Math.max(0, Math.min(geometry.totalU - 1, row));
  return geometry.totalU - clamped;
}

/**
 * Bottom-most U of a `spanU` block whose cursor sits on `hoveredU`, clamped to the
 * grid. Blocks grow upward from the cursor, matching how a rail is bolted on.
 */
export function anchorForDrop(hoveredU: number, spanU: number, geometry: RackGeometry): number {
  const top = Math.min(geometry.totalU, hoveredU + spanU - 1);
  return Math.max(1, top - spanU + 1);
}
