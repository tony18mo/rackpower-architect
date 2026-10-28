/** View geometry: pointer→slot mapping and drop anchoring used by drag-and-drop. */

import { describe, expect, it } from 'vitest';
import { anchorForDrop, makeGeometry, slotAtOffset } from '../view';

const geometry = makeGeometry(42, 20);

describe('rack elevation geometry', () => {
  it('places U42 at the top of the face and U1 at the bottom', () => {
    expect(geometry.yTop(42)).toBe(0);
    expect(geometry.yTop(1)).toBe(41 * 20);
    expect(geometry.height(2)).toBe(40);
  });

  it('maps a pointer offset to the U slot under the cursor', () => {
    expect(slotAtOffset(0, geometry)).toBe(42);
    expect(slotAtOffset(19, geometry)).toBe(42);
    expect(slotAtOffset(20, geometry)).toBe(41);
    expect(slotAtOffset(42 * 20 - 1, geometry)).toBe(1);
  });

  it('clamps offsets beyond the rack ends', () => {
    expect(slotAtOffset(-50, geometry)).toBe(42);
    expect(slotAtOffset(9999, geometry)).toBe(1);
  });

  it('anchors a block upward from the cursor and clamps to the grid', () => {
    expect(anchorForDrop(10, 2, geometry)).toBe(10); // occupies U10-U11
    expect(anchorForDrop(10, 4, geometry)).toBe(10);
    expect(anchorForDrop(42, 2, geometry)).toBe(41);
    expect(anchorForDrop(1, 4, geometry)).toBe(1);
  });
});
