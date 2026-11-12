import { useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Project } from '../shared/types';
import { api } from './api';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Render page 1 of the survey PDF to a PNG, the image every plan coordinate is measured on. */
async function renderFirstPage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2000 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  await page.render({ canvas, viewport: vp }).promise;
  const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('Could not render the survey.'))), 'image/png'));
  return { blob, width: canvas.width, height: canvas.height };
}

export function NewSurvey({ onCreated, aiReady }: { onCreated: (p: Project) => void; aiReady: boolean }) {
  const [name, setName] = useState('Stand-in facility, survey 1');
  const [survey, setSurvey] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<File | null>(null);
  const [capacity, setCapacity] = useState(12);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const start = async () => {
    if (!survey || !video) return;
    setError('');
    try {
      setBusy('Rendering the survey');
      const page = await renderFirstPage(survey);
      const form = new FormData();
      form.append('name', name);
      form.append('capacity', String(capacity));
      form.append('pageWidth', String(page.width));
      form.append('pageHeight', String(page.height));
      form.append('survey', survey);
      form.append('surveyPage', page.blob, 'survey.png');
      form.append('video', video);
      if (analysis) form.append('analysis', analysis);
      setBusy('Uploading');
      onCreated(await api.create(form));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card col" style={{ gap: 16, maxWidth: 760 }}>
      <div className="col" style={{ gap: 4 }}>
        <h1>New site survey</h1>
        <p className="muted">Give it a site drawing and a walkthrough video. It proposes every component it can see, with a tag, an equipment ID and a location, then builds the ideal route for a project manager to adjust.</p>
      </div>
      <label className="col"><span className="small muted">Survey name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <label className="col" style={{ flex: 1, minWidth: 240 }}>
          <span className="small muted">Site drawing (PDF)</span>
          <input type="file" accept="application/pdf" onChange={(e) => setSurvey(e.target.files?.[0] ?? null)} />
        </label>
        <label className="col" style={{ flex: 1, minWidth: 240 }}>
          <span className="small muted">Walkthrough video</span>
          <input type="file" accept="video/*" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <label className="col">
        <span className="small muted">Prepared analysis (optional)</span>
        <input type="file" accept="application/json,.json" onChange={(e) => setAnalysis(e.target.files?.[0] ?? null)} />
        <span className="small muted">An analysis.json made from this exact video. The app replays it step by step, labeled with when it was run, and needs no API key.</span>
      </label>
      <label className="col" style={{ maxWidth: 260 }}>
        <span className="small muted">Components per route</span>
        <input type="number" min={2} max={500} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        <span className="small muted">About 500 at a real facility. Set it small for a house so the split shows.</span>
      </label>
      <div className="row">
        <button className="btn" disabled={!survey || !video || Boolean(busy) || (!aiReady && !analysis)} onClick={start}>{busy || (analysis ? 'Replay the prepared analysis' : 'Analyse survey and video')}</button>
        {!aiReady && !analysis && <span className="small muted">This server has no ANTHROPIC_API_KEY. Add a prepared analysis to replay one.</span>}
      </div>
      {error && <p className="chip bad" role="alert" style={{ whiteSpace: 'normal' }}>{error}</p>}
    </div>
  );
}
