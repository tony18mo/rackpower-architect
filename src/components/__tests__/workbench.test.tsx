/** Shell wiring: views, virtualized tray, strategy engine and live diagnostics. */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../App';
import { buildInventory, specOf } from '../../data/catalogue';
import type { DeviceInstance } from '../../types/rack';

const smallPlan: DeviceInstance[] = [
  { uid: 'pdu-h-32a#0001', specId: 'pdu-h-32a', assetTag: 'PDU-A1' },
  { uid: 'pdu-h-32a#0002', specId: 'pdu-h-32a', assetTag: 'PDU-B1' },
  { uid: 'srv-2u-dual#0001', specId: 'srv-2u-dual', assetTag: 'SRV-0001' },
  { uid: 'srv-2u-dual#0002', specId: 'srv-2u-dual', assetTag: 'SRV-0002' },
  { uid: 'srv-1u-edge#0001', specId: 'srv-1u-edge', assetTag: 'EDG-0001' },
  { uid: 'net-1u-tor#0001', specId: 'net-1u-tor', assetTag: 'TOR-0001' },
  { uid: 'pdu-v-42u#0001', specId: 'pdu-v-42u', assetTag: 'VPU-A1' },
];

describe('workbench shell', () => {
  it('shows the three spatial views and switches between them', () => {
    render(<App instances={smallPlan} />);
    expect(screen.getByRole('tab', { name: 'front elevation' })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.rack-face')).not.toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'side cross-section' }));
    expect(screen.getByRole('img', { name: 'Rack side cross-section' })).toBeInTheDocument();
    expect(screen.getByText(/front rail/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'wiring diagram' }));
    expect(screen.getByText(/Nothing powered yet/)).toBeInTheDocument();
  });

  it('virtualizes the tray: thousands of units, a handful of rows', () => {
    const { container } = render(<App />);
    const rows = container.querySelectorAll('.tray-row');
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.length).toBeLessThan(60);
    const poolSize = buildInventory().length.toLocaleString();
    expect(screen.getByText(new RegExp(`${poolSize} unmounted`))).toBeInTheDocument();
  });

  it('auto-places the staged plan onto the U grid', () => {
    render(<App instances={smallPlan} />);
    fireEvent.click(screen.getByRole('button', { name: 'auto-place plan' }));

    const face = document.querySelector('.rack-face') as HTMLElement;
    const blocks = face.querySelectorAll('.unit');
    expect(blocks.length).toBe(6); // 2 PDUs + 4 powered devices; the zero-U strip is not a face unit
    expect(within(face).getAllByText('R760 Dual-Socket Compute')).toHaveLength(2);
    expect(within(face).getAllByText('HP32 Rear-Mount PDU (IEC-309 inlet)')).toHaveLength(2);
  });

  it('mounts the zero-U strip into a rear channel', () => {
    render(<App instances={smallPlan} />);
    fireEvent.click(screen.getByRole('button', { name: 'auto-place plan' }));
    const channels = document.querySelectorAll('.channel-strip');
    expect(channels.length).toBe(1);
    expect(screen.getByText(/1780 \/ 1786\.9 mm/)).toBeInTheDocument();
  });

  it('turns a frame change into live out-of-bounds diagnostics', () => {
    render(<App instances={smallPlan} />);
    fireEvent.click(screen.getByRole('button', { name: 'auto-place plan' }));
    const before = document.querySelectorAll('.diag.sev-error').length;

    fireEvent.change(screen.getByRole('combobox', { name: /rack preset/i }), {
      target: { value: 'rc-12-600x800' },
    });
    expect(document.querySelectorAll('.diag.sev-error').length).toBeGreaterThan(before);
    expect(screen.getAllByText(/falls outside the 12U grid/).length).toBeGreaterThan(0);
  });

  it('mounts from the tray at the first conflict-free slot', () => {
    render(<App instances={smallPlan} />);
    const rows = document.querySelectorAll('.tray-row');
    const mountButtons = Array.from(rows).map((row) => within(row as HTMLElement).getByRole('button', { name: 'mount' }));
    fireEvent.click(mountButtons[0]);
    expect(document.querySelectorAll('.rack-face .unit').length).toBe(1);
    expect(screen.getByText(/Mounted/)).toBeInTheDocument();
  });

  it('builds the dual-feed topology after placement', () => {
    render(<App instances={smallPlan} />);
    fireEvent.click(screen.getByRole('button', { name: 'auto-place plan' }));
    fireEvent.click(screen.getByRole('tab', { name: 'wiring diagram' }));
    expect(screen.getByText('Utility Feed A')).toBeInTheDocument();
    expect(screen.getByText('Utility Feed B')).toBeInTheDocument();
    const svg = document.querySelector('.wiring-svg') as SVGSVGElement;
    expect(svg.querySelectorAll('.wire').length).toBeGreaterThanOrEqual(6);
    expect(svg.querySelectorAll('.wnode-device').length).toBe(4);
  });

  it('keeps the EIA-310-D pitch visible in the elevation ruler', () => {
    render(<App instances={smallPlan} />);
    const labels = Array.from(document.querySelectorAll('.u-label')).map((node) => node.textContent);
    expect(labels[0]).toBe('42');
    expect(labels[labels.length - 1]).toBe('1');
    expect(specOf('srv-2u-dual')!.heightU).toBe(2);
  });
});
