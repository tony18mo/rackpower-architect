/**
 * Virtualized inventory tray (PRD §3.1).
 *
 * react-window keeps ~5k unmounted units cheap: only the visible rows are in the DOM.
 * Rows are drag sources for the elevation and can be staged for the automated
 * strategy engine in one click.
 */

import { useMemo, useState, type DragEvent } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { usePlanner } from '../state/PlannerContext';
import { DEVICE_CATALOGUE, specOf } from '../data/catalogue';
import { findMountSlot } from '../utils/placement';
import { beginDrag, endDrag, setDragPayload, type DragPayload } from '../utils/view';
import type { DeviceCategory, DeviceInstance, DeviceSpec } from '../types/rack';

const ROW_H = 58;
const LIST_H = 430;

type SortKey = 'model' | 'height' | 'power' | 'weight' | 'depth';

interface RowData {
  items: DeviceInstance[];
  specById: Record<string, DeviceSpec>;
  staged: Set<string>;
  onStage: (uid: string) => void;
  onUnstage: (uid: string) => void;
  onMount: (uid: string) => void;
}

export function InventoryTray() {
  const { state, dispatch } = usePlanner();
  const [mode, setMode] = useState<'inventory' | 'plan'>('inventory');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<DeviceCategory | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('model');

  const staged = useMemo(() => new Set(state.stagedUids), [state.stagedUids]);
  const mountedUids = useMemo(() => {
    const set = new Set<string>();
    for (const placement of state.placements) set.add(placement.instanceId);
    for (const vertical of state.verticals) set.add(vertical.instanceId);
    return set;
  }, [state.placements, state.verticals]);

  const items = useMemo(() => {
    const source =
      mode === 'inventory'
        ? state.inventory
        : state.stagedUids.map((uid) => state.instances[uid]).filter((instance): instance is DeviceInstance => Boolean(instance) && !mountedUids.has(instance.uid));
    const needle = query.trim().toLowerCase();
    const filtered = source.filter((instance) => {
      const spec = specOf(instance.specId);
      if (!spec) return false;
      if (category !== 'all' && spec.category !== category) return false;
      if (!needle) return true;
      return (
        spec.model.toLowerCase().includes(needle) ||
        spec.vendor.toLowerCase().includes(needle) ||
        spec.id.includes(needle) ||
        instance.assetTag.toLowerCase().includes(needle)
      );
    });
    const compare = (a: DeviceInstance, b: DeviceInstance): number => {
      const sa = specOf(a.specId)!;
      const sb = specOf(b.specId)!;
      switch (sort) {
        case 'height':
          return sa.heightU - sb.heightU || sa.model.localeCompare(sb.model);
        case 'power':
          return sb.powerDrawW - sa.powerDrawW || sa.model.localeCompare(sb.model);
        case 'weight':
          return sb.weightKg - sa.weightKg || sa.model.localeCompare(sb.model);
        case 'depth':
          return sb.depthMm - sa.depthMm || sa.model.localeCompare(sb.model);
        default:
          return sa.model.localeCompare(sb.model) || a.uid.localeCompare(b.uid);
      }
    };
    return mode === 'inventory' ? filtered.sort(compare) : filtered;
  }, [mode, state.inventory, state.stagedUids, state.instances, mountedUids, query, category, sort]);

  const rowProps = useMemo<RowData>(
    () => ({
      items,
      specById: Object.fromEntries(DEVICE_CATALOGUE.map((spec) => [spec.id, spec])),
      staged,
      onStage: (uid) => dispatch({ type: 'stage', uid }),
      onUnstage: (uid) => dispatch({ type: 'unstage', uid }),
      onMount: (uid) => {
        const instance = state.instances[uid];
        const spec = instance ? specOf(instance.specId) : undefined;
        if (!instance || !spec) return;
        const rail = spec.rails[0];
        const startU = spec.category === 'pdu-vertical' ? 1 : findMountSlot(state.rack, specOf, state.placements, uid, spec, rail) ?? 1;
        dispatch({ type: 'mount', uid, startU, rail });
      },
    }),
    [items, staged, dispatch, state.instances, state.rack, state.placements],
  );

  return (
    <section className="panel tray">
      <header className="panel-head">
        <h2>Inventory</h2>
        <span className="mono muted">
          {state.inventory.length.toLocaleString()} unmounted · {state.stagedUids.length} staged
        </span>
      </header>

      <div className="segmented tray-mode">
        <button type="button" className={mode === 'inventory' ? 'is-active' : ''} onClick={() => setMode('inventory')}>
          tray
        </button>
        <button type="button" className={mode === 'plan' ? 'is-active' : ''} onClick={() => setMode('plan')}>
          staged plan
        </button>
      </div>

      <div className="tray-filters">
        <input
          className="search"
          type="search"
          placeholder="search model, vendor, asset tag"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search inventory"
        />
        <select value={category} onChange={(event) => setCategory(event.target.value as DeviceCategory | 'all')} aria-label="Filter category">
          <option value="all">all categories</option>
          {DEVICE_CATALOGUE.map((spec) => spec.category)
            .filter((value, index, list) => list.indexOf(value) === index)
            .map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Sort inventory">
          <option value="model">sort: model</option>
          <option value="height">sort: height</option>
          <option value="power">sort: power</option>
          <option value="weight">sort: weight</option>
          <option value="depth">sort: depth</option>
        </select>
      </div>

      <List
        className="tray-list"
        rowComponent={TrayRow}
        rowCount={items.length}
        rowHeight={ROW_H}
        rowProps={rowProps}
        overscanCount={6}
        style={{ height: LIST_H }}
      />
      {items.length === 0 && <p className="empty">No units match this filter.</p>}

      <footer className="tray-foot">
        <button
          type="button"
          className="btn ghost"
          onClick={() => dispatch({ type: 'stageAll', uids: items.slice(0, 40).map((item) => item.uid) })}
          disabled={items.length === 0}
        >
          stage first {Math.min(40, items.length)}
        </button>
        <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'clearPlan' })}>
          clear plan
        </button>
      </footer>
    </section>
  );
}

function TrayRow({ index, style, items, specById, staged, onStage, onUnstage, onMount }: RowComponentProps<RowData>) {
  const instance = items[index];
  if (!instance) return null;
  const spec = specById[instance.specId];
  const isStaged = staged.has(instance.uid);

  const payload: DragPayload = {
    kind: 'inventory',
    uid: instance.uid,
    specId: spec.id,
    spanU: Math.max(1, spec.heightU),
    model: spec.model,
    rail: spec.rails[0],
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    setDragPayload(event, payload);
    beginDrag(payload);
  };

  return (
    <div
      className={`tray-row cat-${spec.category}`}
      style={style}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={endDrag}
      aria-label={`${spec.model}, ${instance.assetTag}`}
    >
      <div className="tray-main">
        <span className="tray-model">{spec.model}</span>
        <span className="tray-sub">
          {spec.vendor} · {instance.assetTag}
          {spec.category === 'pdu-vertical' ? ` · zero-U ${spec.lengthMm} mm` : ''}
        </span>
        <span className="tray-chips mono">
          <i>{spec.heightU === 0 ? '0U' : `${spec.heightU}U`}</i>
          <i>{spec.depthMm} mm</i>
          <i>{spec.powerDrawW} W</i>
          <i>{spec.weightKg} kg</i>
          <i>{spec.psuCount} PSU</i>
        </span>
      </div>
      <div className="tray-actions">
        <button type="button" className="btn tiny" onClick={() => onMount(instance.uid)} title="Mount into the first conflict-free slot">
          mount
        </button>
        <button
          type="button"
          className={`btn tiny ${isStaged ? 'is-active' : ''}`}
          onClick={() => (isStaged ? onUnstage(instance.uid) : onStage(instance.uid))}
        >
          {isStaged ? 'staged' : 'stage'}
        </button>
      </div>
    </div>
  );
}
