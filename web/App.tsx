import { useEffect, useState } from 'react';
import type { Project } from '../shared/types';
import { api, currentRole, ROLE_KEY, STATIC } from './api';
import { NewSurvey } from './NewSurvey';
import { Workspace } from './Workspace';

const ROLES = ['Documenter', 'Monitoring technician', 'QA person', 'Project manager'];

export function App() {
  const [hash, setHash] = useState(location.hash.slice(1));
  const [staticId, setStaticId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ aiConfigured: boolean; model: string } | null>(null);
  const [list, setList] = useState<Awaited<ReturnType<typeof api.list>>>([]);
  const [role, setRole] = useState(currentRole());

  useEffect(() => {
    const on = () => setHash(location.hash.slice(1));
    addEventListener('hashchange', on);
    api.status().then(setStatus).catch(() => setStatus(null));
    if (STATIC) api.get('').then((p) => setStaticId(p.id)).catch(() => setStaticId(null));
    api.list().then(setList).catch(() => setList([]));
    return () => removeEventListener('hashchange', on);
  }, [hash]);

  const pickRole = (r: string) => { setRole(r); try { localStorage.setItem(ROLE_KEY, r); } catch { /* per-browser convenience only */ } };
  const open = (p: Project) => { location.hash = p.id; };

  return (
    <div className="shell">
      <div className="topbar noprint">
        <a href="#" className="brand" style={{ color: '#fff', textDecoration: 'none' }}>Onterris</a>
        <span className="sub">Unicorn · Method 21 survey prototype</span>
        <span className="grow" />
        <label className="sub" htmlFor="role">Working as</label>
        <select id="role" value={role} onChange={(e) => pickRole(e.target.value)}>
          {ROLES.map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>
      <div className="banner noprint">
        Prototype with stand-in data: a house survey and walkthrough video, with household items treated as LDAR components. Federal rule values are orientation only.
        {status && !status.aiConfigured && !STATIC && <strong> No API key on this server: prepared analyses replay, live analysis and Ask the record are off.</strong>}
        {STATIC && <strong> This page holds one prepared survey. Your changes are kept in this browser only.</strong>}
      </div>
      {STATIC ? (staticId ? <Workspace id={staticId} role={role} /> : <div className="page"><p className="muted">Loading the survey</p></div>) : hash ? <Workspace id={hash} role={role} /> : (
        <div className="page">
          <NewSurvey onCreated={open} aiReady={Boolean(status?.aiConfigured)} />
          {list.length > 0 && (
            <div className="card col">
              <h2>Earlier surveys</h2>
              {list.map((p) => (
                <a key={p.id} href={`#${p.id}`} className="row" style={{ color: 'inherit', textDecoration: 'none', padding: '6px 0', borderTop: '1px solid var(--subtle)' }}>
                  <strong style={{ color: 'var(--brand)' }}>{p.name}</strong>
                  <span className="muted small">{new Date(p.createdAt).toLocaleString()}</span>
                  <span className="chip">{p.stage === 'ready' ? p.review.replace('_', ' ') : p.stage}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
