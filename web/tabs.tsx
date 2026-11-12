import { useEffect, useMemo, useState } from 'react';
import { runChecks } from '../shared/build';
import { FEDERAL_RULES } from '../shared/rules';
import { LDAR_TYPE_LABEL, LDAR_TYPES, type Component, type LdarType, type Project, type Route } from '../shared/types';
import { api } from './api';
import { Confidence, PlanView, STATUS_COLOR, STATUS_LABEL } from './views';

type Act = (fn: () => Promise<Project>) => Promise<void>;
const areaName = (p: Project, id: string) => p.survey?.areas.find((a) => a.id === id)?.name ?? id;

// ---------- Review ----------

export function ReviewTab({ p, selected, onSelect, act }: { p: Project; selected: string | null; onSelect: (id: string) => void; act: Act }) {
  const [sort, setSort] = useState<'route' | 'confidence'>('route');
  const [form, setForm] = useState<{ type: LdarType; equipmentName: string; locationDescription: string; note: string } | null>(null);
  const rows = useMemo(() => {
    const r = [...p.components];
    return sort === 'confidence'
      ? r.sort((a, b) => (a.status === 'proposed' ? 0 : 1) - (b.status === 'proposed' ? 0 : 1) || a.confidence - b.confidence)
      : r.sort((a, b) => (a.routeId ?? 'zz').localeCompare(b.routeId ?? 'zz') || (a.routeSeq ?? 0) - (b.routeSeq ?? 0));
  }, [p.components, sort]);
  const sel = p.components.find((c) => c.id === selected) ?? null;
  useEffect(() => { setForm(sel ? { type: sel.type, equipmentName: sel.equipmentName, locationDescription: sel.locationDescription, note: '' } : null); }, [sel?.id]);

  const verified = p.components.filter((c) => c.status !== 'proposed');
  const confirmed = verified.filter((c) => c.status === 'confirmed').length;
  const corrected = verified.filter((c) => c.status === 'corrected').length;
  const rejected = verified.filter((c) => c.status === 'rejected').length;
  const rate = verified.length ? Math.round((confirmed / verified.length) * 100) : null;

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <div className="col" style={{ gap: 2 }}>
          <strong style={{ color: 'var(--brand)' }}>How often the AI was right: {rate === null ? 'no verdicts yet' : `${rate}%`}</strong>
          <span className="small muted">{confirmed} confirmed, {corrected} corrected, {rejected} rejected, {p.components.length - verified.length} still to check. Confidence is the AI's own rating; a technician verifies it. Every verdict is saved and sent to the model as an example on the next survey, so proposals improve over time. This is learning from examples, not retraining the model.</span>
        </div>
        <label className="row small">Order by
          <select value={sort} onChange={(e) => setSort(e.target.value as 'route' | 'confidence')}>
            <option value="route">Route order</option>
            <option value="confidence">Lowest confidence first</option>
          </select>
        </label>
      </div>

      {sel && form && (
        <div className="card col" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>{sel.tag} · {sel.equipmentId} <span className="chip" style={{ marginLeft: 6, borderColor: STATUS_COLOR[sel.status], color: STATUS_COLOR[sel.status] }}>{STATUS_LABEL[sel.status]}</span></h3>
            <Confidence value={sel.confidence} />
          </div>
          <p className="small muted">AI note: {sel.confidenceNote || 'none'} · Stand-in for: {sel.householdName}</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="col" style={{ width: 200 }}><span className="small muted">Component type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LdarType })}>{LDAR_TYPES.map((t) => <option key={t} value={t}>{LDAR_TYPE_LABEL[t]}</option>)}</select>
            </label>
            <label className="col" style={{ flex: 1, minWidth: 220 }}><span className="small muted">Equipment name</span>
              <input type="text" value={form.equipmentName} onChange={(e) => setForm({ ...form, equipmentName: e.target.value })} />
            </label>
          </div>
          <label className="col"><span className="small muted">Location description, from the component out to a unique landmark</span>
            <input type="text" value={form.locationDescription} onChange={(e) => setForm({ ...form, locationDescription: e.target.value })} />
          </label>
          <label className="col"><span className="small muted">Note for the model (optional)</span>
            <input type="text" value={form.note} placeholder="e.g. braided supply lines are connectors at both ends" onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <div className="row">
            <button className="btn" onClick={() => act(() => api.verdict(p.id, sel.id, { verdict: 'confirmed', note: form.note }))}>Confirm as proposed</button>
            <button className="btn secondary" onClick={() => act(() => api.verdict(p.id, sel.id, { verdict: 'corrected', ...form }))}>Save correction</button>
            <button className="btn danger" onClick={() => act(() => api.verdict(p.id, sel.id, { verdict: 'rejected', note: form.note }))}>Not a component</button>
            <span className="grow" style={{ flex: 1 }} />
            <label className="row small"><input type="checkbox" checked={sel.difficultToMonitor} onChange={(e) => act(() => api.patch(p.id, sel.id, { difficultToMonitor: e.target.checked }))} /> Difficult to monitor</label>
            <label className="row small"><input type="checkbox" checked={sel.unsafeToMonitor} onChange={(e) => act(() => api.patch(p.id, sel.id, { unsafeToMonitor: e.target.checked }))} /> Unsafe to monitor</label>
          </div>
        </div>
      )}

      <div className="card scroll" style={{ maxHeight: 520, padding: 0 }}>
        <table className="grid">
          <thead><tr><th>Tag</th><th>Equipment</th><th>Type</th><th>Size</th><th>Area</th><th>Location</th><th>Route</th><th>Confidence</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={c.id === selected ? 'sel' : ''} onClick={() => onSelect(c.id)} style={{ opacity: c.status === 'rejected' ? 0.5 : 1 }}>
                <td className="num" style={{ fontWeight: 600, paddingLeft: c.parentTag ? 24 : 8 }}>{c.tag}</td>
                <td><div>{c.equipmentId}</div><div className="small muted">{c.equipmentName}</div></td>
                <td>{LDAR_TYPE_LABEL[c.type]}{c.difficultToMonitor && <span className="chip" style={{ marginLeft: 4, borderColor: '#e8a0b4' }}>DTM</span>}</td>
                <td className="num">{c.sizeInches ? `${c.sizeInches} in` : '–'}</td>
                <td>{c.areaId}</td>
                <td style={{ maxWidth: 320 }}>{c.locationDescription}</td>
                <td className="num small">{c.routeId ? `${c.routeId} #${c.routeSeq}` : '–'}</td>
                <td><Confidence value={c.confidence} /></td>
                <td><span className="row small" style={{ gap: 6 }}><span className="dot" style={{ background: STATUS_COLOR[c.status] }} />{STATUS_LABEL[c.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Routes ----------

export function RoutesTab({ p, onSelect, act }: { p: Project; onSelect: (id: string) => void; act: Act }) {
  const [routes, setRoutes] = useState<Route[]>(p.routes);
  const [dirty, setDirty] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [capacity, setCapacity] = useState(p.routeCapacity);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => { setRoutes(p.routes); setDirty([]); }, [p.routes]);
  const byId = new Map(p.components.map((c) => [c.id, c]));
  const change = (next: Route[], what: string) => { setRoutes(next); setDirty((d) => [...d, what]); };

  const move = (cid: string, toRoute: string, beforeId: string | null) => {
    const from = routes.find((r) => r.componentIds.includes(cid));
    const next = routes.map((r) => ({ ...r, componentIds: r.componentIds.filter((x) => x !== cid) }));
    const target = next.find((r) => r.id === toRoute)!;
    const at = beforeId ? target.componentIds.indexOf(beforeId) : -1;
    target.componentIds.splice(at < 0 ? target.componentIds.length : at, 0, cid);
    change(next, `moved ${byId.get(cid)?.tag} ${from?.id === toRoute ? 'within' : `from ${from?.id} to`} ${toRoute}`);
  };
  const split = (r: Route, after: number) => {
    const n = routes.filter((x) => x.frequency === r.frequency).length + 1;
    const id = `${r.id.split('-')[0]}-${r.frequency[0].toUpperCase()}-${String(n).padStart(2, '0')}`;
    const idx = routes.indexOf(r);
    const next = [...routes];
    next.splice(idx, 1, { ...r, componentIds: r.componentIds.slice(0, after + 1) }, { ...r, id: routes.some((x) => x.id === id) ? `${id}B` : id, name: `${r.name} (split)`, componentIds: r.componentIds.slice(after + 1) });
    change(next, `split ${r.id}`);
  };
  const merge = (i: number) => {
    const a = routes[i - 1], b = routes[i];
    const next = routes.filter((_, j) => j !== i);
    next[i - 1] = { ...a, componentIds: [...a.componentIds, ...b.componentIds] };
    change(next, `merged ${b.id} into ${a.id}`);
  };
  const edit = (i: number, patch: Partial<Route>, what: string) => { const next = [...routes]; next[i] = { ...next[i], ...patch }; change(next, what); };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <div className="col" style={{ gap: 2, maxWidth: 760 }}>
          <strong style={{ color: 'var(--brand)' }}>The ideal route, ready for a project manager to adjust</strong>
          <span className="small muted">Built by grouping components by area, walking the areas as a loop from the entry, following each area outward from where you come in, and splitting at the route size. Difficult or unsafe components go on their own annual route. Drag to reorder or move between routes; every change is logged.</span>
        </div>
        <div className="row">
          <label className="row small">Route size <input type="number" min={2} max={500} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} style={{ width: 70 }} /></label>
          <button className="btn secondary" onClick={() => act(() => api.rebuild(p.id, capacity))}>Rebuild ideal routes</button>
          <button className="btn" disabled={!dirty.length} onClick={() => act(() => api.routes(p.id, routes, `Route edits: ${dirty.join('; ')}.`))}>Save {dirty.length ? `${dirty.length} changes` : 'changes'}</button>
        </div>
      </div>
      <div className="routes">
        {routes.map((r, i) => (
          <section key={r.id + i} className="route" onMouseEnter={() => setFocus(r.id)}
            onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragging) move(dragging, r.id, null); setDragging(null); setOver(null); }}>
            <header>
              <div className="row" style={{ gap: 8 }}>
                <input type="text" aria-label="Route ID" value={r.id} style={{ width: 110, fontWeight: 600 }} onChange={(e) => edit(i, { id: e.target.value }, `renamed a route to ${e.target.value}`)} />
                <select aria-label="Frequency" value={r.frequency} onChange={(e) => edit(i, { frequency: e.target.value as Route['frequency'] }, `${r.id} set to ${e.target.value}`)}>
                  <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option>
                </select>
                <span className={`chip ${r.componentIds.length > p.routeCapacity ? 'warn' : ''}`}>{r.componentIds.length}</span>
              </div>
              <input type="text" aria-label="Route name" value={r.name} onChange={(e) => edit(i, { name: e.target.value }, `renamed ${r.id}`)} />
              {i > 0 && <button className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => merge(i)}>Merge into {routes[i - 1].id}</button>}
            </header>
            <ol>
              {r.componentIds.map((cid, j) => {
                const c = byId.get(cid);
                if (!c) return null;
                return (
                  <li key={cid} draggable className={`${c.parentTag ? 'child' : ''} ${over === cid ? 'over' : ''}`}
                    onDragStart={() => setDragging(cid)} onDragEnter={() => setOver(cid)}
                    onDrop={(e) => { e.stopPropagation(); if (dragging && dragging !== cid) move(dragging, r.id, cid); setDragging(null); setOver(null); }}
                    onClick={() => onSelect(cid)}>
                    <span className="num small muted" style={{ width: 20 }}>{j + 1}</span>
                    <span className="dot" style={{ background: STATUS_COLOR[c.status] }} />
                    <span className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{c.tag} · {c.equipmentId}</span>
                      <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.equipmentName}</span>
                    </span>
                    {j < r.componentIds.length - 1 && <button className="btn secondary small" title="Split the route after this component" onClick={(e) => { e.stopPropagation(); split(r, j); }}>Split</button>}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      <div className="card col" style={{ maxWidth: 900 }}>
        <h3>Route path on the survey{focus ? `: ${focus}` : ''}</h3>
        <PlanView p={{ ...p, routes }} selected={null} onSelect={onSelect} routeId={focus} />
      </div>
      <div className="card col">
        <h3>Change log</h3>
        <div className="scroll" style={{ maxHeight: 200 }}>
          {[...p.log].reverse().map((l, i) => <div key={i} className="small"><span className="muted">{new Date(l.at).toLocaleString()} · {l.who}:</span> {l.what}</div>)}
        </div>
      </div>
    </div>
  );
}

// ---------- Checks ----------

export function ChecksTab({ p, onSelect }: { p: Project; onSelect: (id: string) => void }) {
  const checks = runChecks(p);
  return (
    <div className="col" style={{ gap: 8 }}>
      <p className="muted small">The database checks itself, as the 10/28 session asked. Click a check to review the components it names.</p>
      {checks.map((c) => (
        <div key={c.id} className="card row" style={{ alignItems: 'flex-start' }}>
          <span className={`chip ${c.level === 'ok' ? 'ok' : c.level === 'warn' ? 'warn' : 'bad'}`}>{{ ok: 'Pass', warn: 'Check', fail: 'Fix' }[c.level]}</span>
          <div className="col" style={{ gap: 2, flex: 1 }}>
            <strong>{c.title}</strong>
            <span className="small muted">{c.detail}</span>
            {c.componentIds.length > 0 && (
              <div className="row" style={{ gap: 4 }}>
                {c.componentIds.slice(0, 30).map((id) => { const x = p.components.find((k) => k.id === id); return x ? <button key={id} className="btn secondary small" onClick={() => onSelect(id)}>{x.tag}</button> : null; })}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Rule test area ----------

const PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, annual: 1, none: 0 };

export function RulesTab({ p, act }: { p: Project; act: Act }) {
  const [o, setO] = useState(p.ruleOverrides);
  useEffect(() => setO(p.ruleOverrides), [p.ruleOverrides]);
  const live = p.components.filter((c) => c.status !== 'rejected');
  const count = (t: LdarType) => live.filter((c) => c.type === t).length;
  const freq = (t: LdarType) => o[t]?.frequency ?? FEDERAL_RULES[t].frequency;
  const base = LDAR_TYPES.reduce((s, t) => s + count(t) * PER_YEAR[FEDERAL_RULES[t].frequency], 0);
  const now = LDAR_TYPES.reduce((s, t) => s + count(t) * PER_YEAR[freq(t)], 0);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card col" style={{ gap: 4 }}>
        <strong style={{ color: 'var(--brand)' }}>See what a rule change does before it goes live</strong>
        <span className="small muted">Federal values from NSPS Subpart VVa and NESHAP Subpart H, for orientation only; none has been checked against the current CFR text. Changes here apply only to this survey.</span>
        <span>Readings per year at these rules: <strong className="num">{now}</strong> {now !== base && <span className="chip warn">{now > base ? '+' : ''}{now - base} against the federal values</span>}</span>
      </div>
      <div className="card scroll" style={{ padding: 0 }}>
        <table className="grid">
          <thead><tr><th>Type</th><th>Here</th><th>Rule</th><th>Leak definition</th><th>Leak ppm</th><th>Frequency</th><th>Repair (days)</th><th>Readings / year</th></tr></thead>
          <tbody>
            {LDAR_TYPES.map((t) => {
              const r = FEDERAL_RULES[t];
              return (
                <tr key={t}>
                  <td style={{ fontWeight: 600 }}>{LDAR_TYPE_LABEL[t]}</td>
                  <td className="num">{count(t)}</td>
                  <td className="small">{r.rule}</td>
                  <td className="small">{r.leakText}</td>
                  <td><input type="number" style={{ width: 80 }} value={o[t]?.leakPpm ?? r.leakPpm ?? ''} placeholder="none" onChange={(e) => setO({ ...o, [t]: { ...o[t], leakPpm: e.target.value === '' ? null : Number(e.target.value) } })} /></td>
                  <td><select value={freq(t)} onChange={(e) => setO({ ...o, [t]: { ...o[t], frequency: e.target.value } })}>{['monthly', 'quarterly', 'annual', 'none'].map((f) => <option key={f}>{f}</option>)}</select></td>
                  <td className="num small">{r.firstAttemptDays ? `${r.firstAttemptDays} / ${r.repairDays}` : '–'}</td>
                  <td className="num">{count(t) * PER_YEAR[freq(t)]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="btn" onClick={() => act(() => api.rules(p.id, o))}>Apply to this survey</button>
        <button className="btn secondary" onClick={() => act(() => api.rules(p.id, {}))}>Reset to federal values</button>
      </div>
    </div>
  );
}

// ---------- Ask the record ----------

const SUGGESTIONS = ['Which area has the most components?', 'Which components are difficult to monitor, and why?', 'How many valves are on route KIT-Q-01?', 'Which proposals have the lowest confidence?'];

export function AskTab({ p }: { p: Project }) {
  const [q, setQ] = useState('');
  const [a, setA] = useState<{ q: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    try { const r = await api.ask(p.id, question); setA((x) => [{ q: question, text: r.answer }, ...x]); }
    catch (e) { setA((x) => [{ q: question, text: e instanceof Error ? e.message : String(e) }, ...x]); }
    finally { setBusy(false); setQ(''); }
  };
  return (
    <div className="col" style={{ gap: 12, maxWidth: 900 }}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input id="ask" type="text" value={q} placeholder="Ask about this inventory in plain language" onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 260 }} />
        <button className="btn" disabled={busy}>{busy ? 'Asking' : 'Ask'}</button>
      </form>
      <div className="row" style={{ gap: 6 }}>{SUGGESTIONS.map((s) => <button key={s} className="btn secondary small" onClick={() => ask(s)}>{s}</button>)}</div>
      {a.map((x, i) => <div key={i} className="card col" style={{ gap: 4 }}><strong style={{ color: 'var(--brand)' }}>{x.q}</strong><p>{x.text}</p></div>)}
    </div>
  );
}

// ---------- Printed route sheet and exports ----------

export function SheetTab({ p }: { p: Project }) {
  const [only, setOnly] = useState<string>('all');
  const routes = p.routes.filter((r) => only === 'all' || r.id === only);
  const byId = new Map(p.components.map((c) => [c.id, c]));
  const rule = (c: Component) => ({ ...FEDERAL_RULES[c.type], ...(p.ruleOverrides[c.type] ?? {}) });
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card row noprint" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <label className="row small">Route
            <select value={only} onChange={(e) => setOnly(e.target.value)}>
              <option value="all">All routes</option>
              {p.routes.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
            </select>
          </label>
          <button className="btn" onClick={() => print()}>Print route sheet</button>
        </div>
        <div className="row">
          <a className="btn secondary" href={`/api/projects/${p.id}/export.csv`}>Download CSV</a>
          <a className="btn secondary" href={`/api/projects/${p.id}/export.json`}>Download JSON</a>
          <span className="small muted">Columns follow Onterris's own layout until a Skybridge sample arrives.</span>
        </div>
      </div>
      {routes.map((r) => (
        <div key={r.id} className="sheet">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Method 21 route sheet · {r.id}</h2>
            <span style={{ fontSize: 12 }}>{p.name} · {r.name} · {r.frequency} · {r.componentIds.length} {r.componentIds.length === 1 ? 'component' : 'components'}</span>
          </div>
          <div className="hdr">
            <span>Date:</span><span>Technician:</span><span>Instrument and serial:</span><span>Calibration time:</span>
            <span>Background ppm:</span><span>Start time:</span><span>End time:</span><span>QA reviewer:</span>
          </div>
          <table>
            <thead><tr><th>#</th><th>Tag</th><th>Equipment</th><th>Type</th><th>Size</th><th>Area</th><th>Location</th><th>Leak at</th><th className="fill">Reading ppm</th><th className="fill">Leak Y/N</th><th className="fill">Tag OK / missing</th><th className="fill">Notes</th></tr></thead>
            <tbody>
              {r.componentIds.map((cid, i) => {
                const c = byId.get(cid);
                if (!c) return null;
                const ru = rule(c);
                return (
                  <tr key={cid}>
                    <td>{i + 1}</td><td><strong>{c.tag}</strong></td><td>{c.equipmentId}<br />{c.equipmentName}</td><td>{LDAR_TYPE_LABEL[c.type]}{c.difficultToMonitor ? ' (DTM)' : ''}</td>
                    <td>{c.sizeInches ? `${c.sizeInches}"` : ''}</td><td>{areaName(p, c.areaId)}</td><td>{c.locationDescription}</td>
                    <td>{ru.leakPpm ? `${ru.leakPpm.toLocaleString()} ppm` : 'Not monitored'}</td><td /><td /><td /><td />
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 10, marginTop: 6 }}>Stand-in data. Leak values are federal figures for orientation only. Printed {new Date().toLocaleDateString()}. Record status {p.review.replace('_', ' ')}.</p>
        </div>
      ))}
    </div>
  );
}
