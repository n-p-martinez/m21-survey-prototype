import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../shared/types';
import { api, resetStatic, STATIC } from './api';
import { AskTab, ChecksTab, ReviewTab, RoutesTab, RulesTab, SheetTab } from './tabs';
import { FramesView, PlanView, VideoView } from './views';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const TABS = [
  { id: 'review', label: 'Review proposals' },
  { id: 'routes', label: 'Routes' },
  { id: 'checks', label: 'Checks' },
  { id: 'rules', label: 'Rule test area' },
  { id: 'ask', label: 'Ask the record' },
  { id: 'sheet', label: 'Route sheet and CSV' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function Workspace({ id, role }: { id: string; role: string }) {
  const [p, setP] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabId>('review');
  const [selected, setSelected] = useState<string | null>(null);

  const [replayAt, setReplayAt] = useState<number | null>(null);

  useEffect(() => {
    api.get(id).then((x) => { setP(x); if (STATIC && x.replay) setReplayAt(0); }).catch((e) => setError(e.message));
    if (STATIC) return;
    const es = new EventSource(`/api/projects/${id}/events`);
    es.onmessage = (m) => setP(JSON.parse(m.data));
    return () => es.close();
  }, [id]);

  // On the claude.ai page, walk through the recorded analysis step by step before opening the results.
  const batches = p ? Math.ceil(p.frames.length / 8) : 0;
  const replaySteps = p ? 3 + batches : 0;
  useEffect(() => {
    if (replayAt === null || !p) return;
    if (replayAt >= replaySteps) { const t = setTimeout(() => setReplayAt(null), 900); return () => clearTimeout(t); }
    const t = setTimeout(() => setReplayAt(replayAt + 1), replayAt < 2 ? 1800 : replayAt < 2 + batches ? 700 : 1800);
    return () => clearTimeout(t);
  }, [replayAt, p, replaySteps, batches]);

  const sel = useMemo(() => p?.components.find((c) => c.id === selected) ?? null, [p, selected]);
  const act = async (fn: () => Promise<Project>) => {
    setError('');
    try { setP(await fn()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  if (!p) return <div className="page"><p className="muted">{error || 'Loading'}</p></div>;

  if (replayAt !== null) {
    const labels = ['Read the survey', 'Sample the video', 'Find components', 'Merge sightings', 'Build tags and routes'];
    const at = replayAt < 1 ? 0 : replayAt < 2 ? 1 : replayAt < 2 + batches ? 2 : replayAt < 3 + batches ? 3 : 4;
    const shown = p.frames.slice(0, Math.min(p.frames.length, Math.max(0, replayAt - 1) * 8));
    return (
      <div className="page">
        <div className="card col" style={{ maxWidth: 900, gap: 14 }}>
          <h1>{p.name}</h1>
          <p className="chip warn" style={{ whiteSpace: 'normal' }}>Replaying the analysis run on {new Date(p.replay!.ranAt).toLocaleDateString()} by {p.replay!.ranBy}. Every result shown is that run's real output.</p>
          <div className="steps">
            {labels.map((l, i) => (
              <div key={l} className="s">
                <span className="dot" style={{ background: i < at ? '#2f7d32' : i === at ? '#5294eb' : '#e3e6ea' }} />
                <span style={{ fontWeight: i === at ? 600 : 400 }}>{l}</span>
                {i === 0 && at > 0 && <span className="small muted">{plural(p.survey?.areas.length ?? 0, 'area')}, {plural(p.survey?.referencePoints.length ?? 0, 'reference point')}, {plural(p.survey?.redactions.length ?? 0, 'personal detail')} hidden</span>}
                {i === 1 && at > 1 && <span className="small muted">{p.frames.length} frames</span>}
                {i === 2 && at >= 2 && <span className="small muted">batch {Math.min(batches, Math.max(0, replayAt - 1))} of {batches}</span>}
                {i === 3 && at > 3 && <span className="small muted">{p.components.length} components</span>}
                {i === 4 && at >= 4 && <span className="small muted">{p.routes.length} routes</span>}
              </div>
            ))}
          </div>
          <div className="progress"><i style={{ width: `${(Math.min(replayAt, replaySteps) / Math.max(1, replaySteps)) * 100}%` }} /></div>
          <div className="row" style={{ gap: 6 }}>
            {shown.slice(-16).map((f) => <img key={f.file} src={api.file(p.id, f.file)} alt="" style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 4, filter: 'blur(1px)' }} />)}
          </div>
          <button className="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setReplayAt(null)}>Skip to the results</button>
        </div>
      </div>
    );
  }

  if (p.stage !== 'ready') {
    const order = ['survey', 'frames', 'detect', 'consolidate', 'build'];
    const labels = ['Read the survey', 'Sample the video', 'Find components', 'Merge sightings', 'Build tags and routes'];
    const at = order.indexOf(p.stage);
    return (
      <div className="page">
        <div className="card col" style={{ maxWidth: 640, gap: 14 }}>
          <h1>{p.name}</h1>
          {p.replay && <p className="chip warn" style={{ whiteSpace: 'normal' }}>Replaying the analysis run on {new Date(p.replay.ranAt).toLocaleDateString()} by {p.replay.ranBy}. Every result shown is that run's real output.</p>}
          {p.stage === 'error' ? (
            <p className="chip bad" style={{ whiteSpace: 'normal' }}>Stopped: {p.error}</p>
          ) : (
            <>
              <div className="steps">
                {labels.map((l, i) => (
                  <div key={l} className="s">
                    <span className="dot" style={{ background: i < at ? '#2f7d32' : i === at ? '#5294eb' : '#e3e6ea' }} />
                    <span style={{ fontWeight: i === at ? 600 : 400 }}>{l}</span>
                  </div>
                ))}
              </div>
              <div className="progress"><i style={{ width: `${(p.progress.done / Math.max(1, p.progress.total)) * 100}%` }} /></div>
              <p className="muted small">{p.progress.step}: {p.progress.message}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const counts = {
    total: p.components.length,
    proposed: p.components.filter((c) => c.status === 'proposed').length,
  };

  return (
    <div className="page">
      <div className="row noprint" style={{ justifyContent: 'space-between' }}>
        <div className="col" style={{ gap: 2 }}>
          <h1>{p.name}</h1>
          <span className="muted small">{counts.total} components proposed · {p.routes.length} routes · {counts.proposed} awaiting a technician · working as {role}</span>
        </div>
        <div className="row">
          {STATIC && p.replay && <button className="btn secondary small" onClick={() => setReplayAt(0)}>Replay the analysis</button>}
          {STATIC && <button className="btn secondary small" title="Undo every change made in this browser" onClick={() => act(async () => (await resetStatic())!)}>Reset my changes</button>}
          <span className={`chip ${p.review === 'approved' ? 'ok' : p.review === 'in_review' ? 'warn' : ''}`}>{{ draft: 'Draft', in_review: 'In QA review', approved: 'Approved into the record' }[p.review]}</span>
          {p.review === 'draft' && <button className="btn secondary" onClick={() => act(() => api.review(p.id, 'in_review'))}>Send for QA review</button>}
          {p.review === 'in_review' && <>
            <button className="btn secondary" onClick={() => act(() => api.review(p.id, 'draft'))}>Return to draft</button>
            <button className="btn" disabled={role !== 'QA person' && role !== 'Project manager'} title="QA or a project manager approves" onClick={() => act(() => api.review(p.id, 'approved'))}>Approve into the record</button>
          </>}
        </div>
      </div>
      {error && <p className="chip bad noprint" role="alert" style={{ whiteSpace: 'normal' }}>{error}</p>}
      {p.replay && <p className="small muted noprint">AI proposals replayed from the analysis run on {new Date(p.replay.ranAt).toLocaleDateString()} by {p.replay.ranBy}. {p.replay.note} Everything from review onward is live.</p>}

      {tab !== 'sheet' && (
        <div className="grid2 noprint">
          <div className="card col">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2>Site survey</h2><span className="small muted">{p.survey?.notes}</span></div>
            <PlanView p={p} selected={selected} onSelect={setSelected} onMovePin={tab === 'review' ? (cid, x, y) => act(() => api.patch(p.id, cid, { plan: { x, y } })) : undefined} />
            <span className="small muted">Pins: blue proposed, green confirmed, teal corrected; pink ring difficult to monitor. Diamonds are reference points. Drag a pin to correct its position.</span>
          </div>
          <div className="card col">
            <h2>{p.video ? 'Walkthrough video' : 'Walkthrough frames'}</h2>
            {p.video ? <VideoView p={p} selected={sel} onSelect={setSelected} /> : p.frames.length ? <FramesView p={p} selected={sel} onSelect={setSelected} /> : <p className="muted">No walkthrough video yet. Components found in the video appear here, on the plan and in review once it is analysed.</p>}
            {sel && (
              <div className="col" style={{ gap: 2, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <strong style={{ color: 'var(--brand)' }}>{sel.tag} · {sel.equipmentId} · {sel.equipmentName}</strong>
                <span>{sel.locationDescription}</span>
                <span className="small muted">Stand-in for: {sel.householdName} · {sel.sightings.length ? `seen ${sel.sightings.length} time${sel.sightings.length === 1 ? '' : 's'}` : 'expected but not seen in the video'}</span>
                <span className="small muted">{sel.confidenceNote}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="tabs noprint" role="tablist">
        {TABS.map((t) => <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === 'review' && <ReviewTab p={p} selected={selected} onSelect={setSelected} act={act} />}
      {tab === 'routes' && <RoutesTab p={p} onSelect={setSelected} act={act} />}
      {tab === 'checks' && <ChecksTab p={p} onSelect={(cid) => { setSelected(cid); setTab('review'); }} />}
      {tab === 'rules' && <RulesTab p={p} act={act} />}
      {tab === 'ask' && <AskTab p={p} />}
      {tab === 'sheet' && <SheetTab p={p} />}
    </div>
  );
}
