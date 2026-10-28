/** Real-time spatial diagnostics list (PRD §2.4). */

import { usePlanner } from '../state/PlannerContext';
import { diagnosticCounts } from '../utils/diagnostics';
import type { Diagnostic } from '../types/rack';

export function DiagnosticsPanel() {
  const { derived, dispatch } = usePlanner();
  const counts = diagnosticCounts(derived.diagnostics);

  return (
    <section className="panel diagnostics">
      <header className="panel-head">
        <h2>Diagnostics</h2>
        <span className="severity-badges">
          <i className="badge error">{counts.error} error</i>
          <i className="badge warning">{counts.warning} warning</i>
          <i className="badge info">{counts.info} info</i>
        </span>
      </header>
      <ul className="diag-list">
        {derived.diagnostics.map((diagnostic) => (
          <DiagRow
            key={diagnostic.id}
            diagnostic={diagnostic}
            onSelect={() =>
              diagnostic.placementIds[0] && dispatch({ type: 'select', id: diagnostic.placementIds[0] })
            }
          />
        ))}
      </ul>
    </section>
  );
}

function DiagRow({ diagnostic, onSelect }: { diagnostic: Diagnostic; onSelect: () => void }) {
  return (
    <li
      className={`diag sev-${diagnostic.severity} ${diagnostic.placementIds.length ? 'is-clickable' : ''}`}
      onClick={onSelect}
    >
      <span className="diag-code mono">{diagnostic.code}</span>
      <span className="diag-body">
        <strong className="diag-subject">{diagnostic.subject}</strong>
        <p className="diag-message">{diagnostic.message}</p>
      </span>
      {diagnostic.uRange && (
        <span className="diag-u mono">
          U{diagnostic.uRange[0]}
          {diagnostic.uRange[0] !== diagnostic.uRange[1] ? `-U${diagnostic.uRange[1]}` : ''}
        </span>
      )}
    </li>
  );
}
