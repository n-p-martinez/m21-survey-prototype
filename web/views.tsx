// The survey plan and the video, the two views every tab links back to.

import { useEffect, useRef, useState } from 'react';
import type { Component, Project, ReviewStatus } from '../shared/types';
import { api } from './api';

export const STATUS_COLOR: Record<ReviewStatus, string> = { proposed: '#5294eb', confirmed: '#2f7d32', corrected: '#007878', rejected: '#b3240f' };
export const STATUS_LABEL: Record<ReviewStatus, string> = { proposed: 'Proposed', confirmed: 'Confirmed', corrected: 'Corrected', rejected: 'Rejected' };

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? '#2f7d32' : value >= 0.6 ? '#e8a04f' : '#b3240f';
  return (
    <span className="conf" title="The AI's own rating. A technician verifies it; every verdict trains later proposals.">
      <span className="bar"><i style={{ width: `${pct}%`, background: color }} /></span>
      <span className="num small">{pct}%</span>
    </span>
  );
}

/** The survey page with personal details hidden, areas, reference points, component pins and route paths. */
export function PlanView({ p, selected, onSelect, routeId, onMovePin }: {
  p: Project; selected: string | null; onSelect: (id: string) => void; routeId?: string | null; onMovePin?: (id: string, x: number, y: number) => void;
}) {
  const s = p.survey!;
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const ar = s.pageWidth && s.pageHeight ? s.pageHeight / s.pageWidth : 0.75;
  const W = 1000;
  const H = W * ar;
  const live = p.components.filter((c) => c.status !== 'rejected');
  const paths = p.routes.filter((r) => !routeId || r.id === routeId).map((r) => ({
    id: r.id,
    pts: r.componentIds.map((id) => p.components.find((c) => c.id === id)).filter(Boolean).map((c) => `${c!.plan.x * W},${c!.plan.y * H}`).join(' '),
  }));
  const toPlan = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  return (
    <div className="plan">
      <img src={api.file(p.id, s.pageImage)} alt="Site survey drawing, personal details hidden" />
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        onPointerMove={(e) => { if (drag && onMovePin) { const q = toPlan(e); (e.currentTarget.querySelector(`[data-pin="${drag}"]`) as SVGGElement | null)?.setAttribute('transform', `translate(${q.x * W} ${q.y * H})`); } }}
        onPointerUp={(e) => { if (drag && onMovePin) { const q = toPlan(e); onMovePin(drag, q.x, q.y); } setDrag(null); }}>
        {s.redactions.map((b, i) => (
          <g key={i}>
            <rect className="redact" x={b.x * W} y={b.y * H} width={b.w * W} height={b.h * H} />
            <text x={b.x * W + 4} y={b.y * H + 14} fill="#fff" fontSize="11" fontFamily="Inter, sans-serif">Hidden</text>
          </g>
        ))}
        {s.areas.map((a) => (
          <g key={a.id}>
            <rect x={a.box.x * W} y={a.box.y * H} width={a.box.w * W} height={a.box.h * H} fill="rgba(82,148,235,.06)" stroke="#5294eb" strokeDasharray="6 4" strokeWidth="1.5" />
            <text x={a.box.x * W + 6} y={a.box.y * H + 16} fill="#252d42" fontSize="13" fontWeight="600" fontFamily="Inter, sans-serif">{a.id}</text>
          </g>
        ))}
        {paths.map((r) => <polyline key={r.id} points={r.pts} fill="none" stroke="#007878" strokeWidth="2.5" strokeDasharray="2 5" strokeLinecap="round" />)}
        {s.referencePoints.map((r) => (
          <g key={r.id} transform={`translate(${r.at.x * W} ${r.at.y * H})`}>
            <rect x={-7} y={-7} width={14} height={14} fill="#252d42" transform="rotate(45)" />
            <text x={10} y={4} fontSize="11" fill="#252d42" fontFamily="Inter, sans-serif">{r.name}</text>
          </g>
        ))}
        <g transform={`translate(${s.entry.x * W} ${s.entry.y * H})`}><circle r={9} fill="#fff" stroke="#252d42" strokeWidth="2" /><text x={12} y={4} fontSize="11" fontWeight="600" fill="#252d42" fontFamily="Inter, sans-serif">Entry</text></g>
        {live.map((c) => (
          <g key={c.id} data-pin={c.id} transform={`translate(${c.plan.x * W} ${c.plan.y * H})`} style={{ cursor: onMovePin ? 'grab' : 'pointer' }}
            onPointerDown={(e) => { onSelect(c.id); if (onMovePin) { setDrag(c.id); (e.target as Element).setPointerCapture?.(e.pointerId); } }}>
            <circle r={c.id === selected ? 10 : 7} fill={STATUS_COLOR[c.status]} stroke={c.difficultToMonitor ? '#e8a0b4' : '#fff'} strokeWidth={c.difficultToMonitor ? 4 : 2} />
            {(c.id === selected || !c.parentTag) && <text x={11} y={-6} fontSize="11" fontWeight="600" fill="#252d42" fontFamily="Inter, sans-serif">{c.tag}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}

/** The walkthrough video with a timeline of highlights. The selected component is boxed; privacy boxes are blurred. */
export function VideoView({ p, selected, onSelect }: { p: Project; selected: Component | null; onSelect: (id: string) => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const dur = p.video?.duration || 1;
  useEffect(() => {
    if (selected?.sightings[0] && v.current) { v.current.currentTime = selected.sightings[0].t; v.current.pause(); }
  }, [selected?.id]);
  const near = (x: number) => Math.abs(x - t) < 1.2;
  const box = selected?.sightings.find((s) => near(s.t))?.box;
  const frameIdx = p.frames.findIndex((f) => near(f.t));
  const blurs = p.privacy.filter((q) => q.frame === frameIdx);
  const marks = p.components.filter((c) => c.status !== 'rejected').flatMap((c) => c.sightings.slice(0, 1).map((s) => ({ c, t: s.t })));
  return (
    <div>
      <div className="video-wrap">
        <video ref={v} src={api.file(p.id, p.video!.file)} controls preload="metadata" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
        {blurs.map((b, i) => <div key={i} className="blur" style={{ left: `${b.box.x * 100}%`, top: `${b.box.y * 100}%`, width: `${b.box.w * 100}%`, height: `${b.box.h * 100}%` }} />)}
        {box && <div className="box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />}
      </div>
      <div className="timeline" aria-label="Highlights: where each component first appears">
        {marks.map(({ c, t: at }) => (
          <button key={c.id} title={`${c.tag} ${c.equipmentName} at ${at.toFixed(1)} s`} aria-label={`Jump to ${c.tag}`}
            style={{ left: `${(at / dur) * 100}%`, background: STATUS_COLOR[c.status], outline: c.id === selected?.id ? '2px solid #252d42' : 'none' }}
            onClick={() => { onSelect(c.id); if (v.current) v.current.currentTime = at; }} />
        ))}
        <div className="head" style={{ left: `${(t / dur) * 100}%` }} />
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>Blurred boxes cover people, mail and screens the AI found in sampled frames. Playback between frames is not blurred.</p>
    </div>
  );
}

/** When only still frames are kept (no video file), show the frame each component was seen in, with its box. */
export function FramesView({ p, selected, onSelect }: { p: Project; selected: Component | null; onSelect: (id: string) => void }) {
  const [pick, setPick] = useState(0);
  const sel = selected?.sightings[0];
  const idx = sel ? Math.max(0, p.frames.findIndex((f) => f.file === sel.frame)) : pick;
  const frame = p.frames[idx];
  const here = p.components.filter((c) => c.status !== 'rejected' && c.sightings.some((s) => s.frame === frame?.file));
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  if (!frame) return <p className="muted">No frames yet.</p>;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="video-wrap" style={{ background: '#111', display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
          <img src={api.file(p.id, frame.file)} alt={`Walkthrough frame at ${fmt(frame.t)}`} style={{ display: 'block', maxWidth: '100%', maxHeight: 420 }} />
          {here.map((c) => c.sightings.filter((s) => s.frame === frame.file).map((s, i) => (
            <button key={c.id + i} type="button" title={`${c.tag} ${c.equipmentName}`} aria-label={`Select ${c.tag}`} onClick={() => onSelect(c.id)}
              className="box" style={{ pointerEvents: 'auto', cursor: 'pointer', background: 'transparent', left: `${s.box.x * 100}%`, top: `${s.box.y * 100}%`, width: `${s.box.w * 100}%`, height: `${s.box.h * 100}%`, borderColor: c.id === selected?.id ? '#e8a04f' : STATUS_COLOR[c.status], borderWidth: c.id === selected?.id ? 4 : 2 }}>
              <span style={{ position: 'absolute', left: -2, top: -20, background: c.id === selected?.id ? '#e8a04f' : STATUS_COLOR[c.status], color: '#fff', font: '600 11px Inter, sans-serif', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>{c.tag}</span>
            </button>
          )))}
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} aria-label="Frames kept from the walkthrough">
        {p.frames.map((f, i) => (
          <button key={f.file} type="button" onClick={() => { setPick(i); const c = p.components.find((x) => x.sightings.some((s) => s.frame === f.file)); if (c) onSelect(c.id); }}
            style={{ padding: 0, border: i === idx ? '2px solid #252d42' : '1px solid var(--line)', borderRadius: 4, background: 'none', cursor: 'pointer' }} title={`Frame at ${fmt(f.t)}`}>
            <img src={api.file(p.id, f.file)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', display: 'block', borderRadius: 3 }} />
          </button>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Only close crops of each component are kept from the walkthrough; the full video and anything personal are left out. Click a box or a frame to select a component.</p>
    </div>
  );
}
