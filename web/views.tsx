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
