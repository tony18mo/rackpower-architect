/** App shell: toolbar, three spatial views, inventory tray and diagnostics rails. */

import { useState } from 'react';
import type { DeviceInstance } from './types/rack';
import { PlannerProvider } from './state/PlannerContext';
import { Toolbar } from './components/Toolbar';
import { RackVisualizer } from './components/RackVisualizer';
import { RackSideView } from './components/RackSideView';
import { WiringDiagram } from './components/WiringDiagram';
import { InventoryTray } from './components/InventoryTray';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { CapacitySummary } from './components/CapacitySummary';
import { ChannelPanel } from './components/ChannelPanel';
import { PlacementInspector } from './components/PlacementInspector';

type ViewKey = 'front' | 'side' | 'wiring';

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'front', label: 'front elevation' },
  { key: 'side', label: 'side cross-section' },
  { key: 'wiring', label: 'wiring diagram' },
];

export function App({ instances }: { instances?: DeviceInstance[] }) {
  return (
    <PlannerProvider instances={instances}>
      <Shell />
    </PlannerProvider>
  );
}

function Shell() {
  const [view, setView] = useState<ViewKey>('front');

  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
        <aside className="rail rail-left">
          <InventoryTray />
          <ChannelPanel />
        </aside>

        <section className="stage">
          <nav className="tabs" role="tablist">
            {VIEWS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={view === entry.key}
                className={view === entry.key ? 'is-active' : ''}
                onClick={() => setView(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          {view === 'front' && <RackVisualizer />}
          {view === 'side' && <RackSideView />}
          {view === 'wiring' && <WiringDiagram />}
        </section>

        <aside className="rail rail-right">
          <PlacementInspector />
          <CapacitySummary />
          <DiagnosticsPanel />
        </aside>
      </main>
    </div>
  );
}
