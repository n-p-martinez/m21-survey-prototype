import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { applyRoutes, planRoutes, runChecks } from '../shared/build';
import { toCsv } from '../shared/export';
import { LDAR_TYPES, type Component, type LdarType, type Project, type Route } from '../shared/types';
import { aiConfigured, askRecord, MODEL } from './ai';
import { runPipeline } from './pipeline';
import { parseAnalysis, sha256File, type AnalysisFile } from './replay';
import { addCorrection, DATA_DIR, listProjects, loadProject, projectDir, saveProject } from './store';
import { probe } from './video';

const app = express();
app.use(express.json({ limit: '2mb' }));
const upload = multer({ dest: path.join(DATA_DIR, 'uploads'), limits: { fileSize: 8 * 1024 * 1024 * 1024 } });

// Live progress per project, pushed to open pages with server-sent events.
const listeners = new Map<string, Set<Response>>();
const emit = (p: Project) => {
  for (const res of listeners.get(p.id) ?? []) res.write(`data: ${JSON.stringify(p)}\n\n`);
};

const now = () => new Date().toISOString();
const role = (req: Request) => String(req.body?.role ?? 'Project manager').slice(0, 40);

async function withProject(req: Request, res: Response, fn: (p: Project) => Promise<unknown> | unknown) {
  try {
    const p = await loadProject(String(req.params.id));
    if (!p) return res.status(404).json({ error: 'No such project.' });
    const out = await fn(p);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

app.get('/api/status', (_req, res) => res.json({ aiConfigured: aiConfigured(), model: MODEL }));
app.get('/api/projects', async (_req, res) => res.json(await listProjects()));

app.post(
  '/api/projects',
  upload.fields([{ name: 'survey', maxCount: 1 }, { name: 'surveyPage', maxCount: 1 }, { name: 'video', maxCount: 1 }, { name: 'analysis', maxCount: 1 }]),
  async (req, res) => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]>;
      let recorded: AnalysisFile | undefined;
      if (files.analysis?.[0]) {
        recorded = parseAnalysis(await readFile(files.analysis[0].path, 'utf8'));
        await rm(files.analysis[0].path, { force: true });
      } else if (!aiConfigured()) {
        throw new Error('This server has no ANTHROPIC_API_KEY. Add the prepared analysis file to replay a recorded analysis instead.');
      }
      const survey = files.survey?.[0];
      const page = files.surveyPage?.[0];
      const video = files.video?.[0];
      if (!survey || !page || !video) throw new Error('Upload a survey PDF and a video.');
      const id = randomUUID().slice(0, 13);
      const dir = projectDir(id);
      await mkdir(dir, { recursive: true });
      const ext = path.extname(video.originalname).toLowerCase() || '.mp4';
      await rename(survey.path, path.join(dir, 'survey.pdf'));
      await rename(page.path, path.join(dir, 'survey.png'));
      await rename(video.path, path.join(dir, `video${ext}`));
      const meta = await probe(path.join(dir, `video${ext}`));
      if (recorded && (await sha256File(path.join(dir, `video${ext}`))) !== recorded.video.sha256) {
        await rm(dir, { recursive: true, force: true });
        throw new Error('This analysis was made from a different video. Upload the same video file it was made from.');
      }
      const p: Project = {
        id,
        name: String(req.body.name || 'Untitled survey').slice(0, 80),
        createdAt: now(),
        stage: 'uploaded',
        progress: { step: 'Uploaded', done: 0, total: 1, message: '' },
        error: null,
        video: { file: `video${ext}`, ...meta },
        survey: {
          pageImage: 'survey.png', pageWidth: Number(req.body.pageWidth) || 0, pageHeight: Number(req.body.pageHeight) || 0,
          areas: [], referencePoints: [], entry: { x: 0, y: 0 }, redactions: [], notes: '',
        },
        frames: [],
        privacy: [],
        components: [],
        routes: [],
        review: 'draft',
        log: [{ at: now(), who: role(req), what: 'Uploaded the survey and the video.' }],
        routeCapacity: Math.max(2, Math.min(500, Number(req.body.capacity) || 12)),
        ruleOverrides: {},
        replay: recorded ? { ranAt: recorded.ranAt, ranBy: recorded.ranBy, note: recorded.note } : null,
      };
      await saveProject(p);
      res.json(p);
      void runPipeline(p, emit, recorded);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

app.get('/api/projects/:id', (req, res) => withProject(req, res, (p) => p));

app.get('/api/projects/:id/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const id = String(req.params.id);
  const set = listeners.get(id) ?? new Set();
  set.add(res);
  listeners.set(id, set);
  req.on('close', () => set.delete(res));
});

// Uploaded and generated files: survey image, frames, video. Paths are confined to the project folder.
app.get('/api/projects/:id/files/*rest', (req, res) => {
  const dir = projectDir(String(req.params.id));
  const rest = ([] as string[]).concat((req.params as Record<string, string | string[]>).rest).join('/');
  const file = path.resolve(dir, rest);
  if (!file.startsWith(dir + path.sep) || !existsSync(file) || file.endsWith('.json') || file.endsWith('.pdf')) return res.sendStatus(404);
  res.sendFile(file);
});

// A technician's verdict on one proposal. Every verdict is kept and fed back to the model as an example.
app.post('/api/projects/:id/components/:cid/verdict', (req, res) =>
  withProject(req, res, async (p) => {
    const c = p.components.find((x) => x.id === req.params.cid);
    if (!c) throw new Error('No such component.');
    const verdict = req.body.verdict as 'confirmed' | 'corrected' | 'rejected';
    if (!['confirmed', 'corrected', 'rejected'].includes(verdict)) throw new Error('Unknown verdict.');
    const before = c.type;
    const newType = req.body.type as LdarType | undefined;
    if (newType && !LDAR_TYPES.includes(newType)) throw new Error('Unknown component type.');
    if (verdict === 'corrected') {
      if (newType) c.type = newType;
      if (typeof req.body.equipmentName === 'string') c.equipmentName = req.body.equipmentName.slice(0, 120);
      if (typeof req.body.locationDescription === 'string') c.locationDescription = req.body.locationDescription.slice(0, 240);
    }
    c.status = verdict;
    c.verifiedBy = role(req);
    await addCorrection({ at: now(), householdName: c.householdName, proposedType: before, finalType: c.type, proposedConfidence: c.confidence, verdict, note: String(req.body.note ?? '').slice(0, 200) });
    if (verdict === 'rejected') {
      for (const r of p.routes) r.componentIds = r.componentIds.filter((id) => id !== c.id);
      applyRoutes(p.components, p.routes);
    }
    p.log.push({ at: now(), who: role(req), what: `${verdict[0].toUpperCase() + verdict.slice(1)} ${c.tag} ${c.equipmentId}${verdict === 'corrected' && before !== c.type ? `, type ${before} to ${c.type}` : ''}.` });
    await saveProject(p);
    emit(p);
    return p;
  }),
);

// Field edits that are not a verdict: difficult to monitor, pin position on the plan.
app.patch('/api/projects/:id/components/:cid', (req, res) =>
  withProject(req, res, async (p) => {
    const c = p.components.find((x) => x.id === req.params.cid);
    if (!c) throw new Error('No such component.');
    const changes: string[] = [];
    const set = <K extends keyof Component>(k: K, v: Component[K], label: string) => { c[k] = v; changes.push(label); };
    if (typeof req.body.difficultToMonitor === 'boolean') set('difficultToMonitor', req.body.difficultToMonitor, `difficult to monitor ${req.body.difficultToMonitor ? 'on' : 'off'}`);
    if (typeof req.body.unsafeToMonitor === 'boolean') set('unsafeToMonitor', req.body.unsafeToMonitor, `unsafe to monitor ${req.body.unsafeToMonitor ? 'on' : 'off'}`);
    if (req.body.plan && typeof req.body.plan.x === 'number') set('plan', { x: Math.min(1, Math.max(0, req.body.plan.x)), y: Math.min(1, Math.max(0, req.body.plan.y)) }, 'pin moved');
    if (typeof req.body.locationDescription === 'string') set('locationDescription', req.body.locationDescription.slice(0, 240), 'location described');
    p.log.push({ at: now(), who: role(req), what: `${c.tag}: ${changes.join(', ')}.` });
    await saveProject(p);
    emit(p);
    return p;
  }),
);

// The project manager's route edits: order, moves between routes, splits, merges, names.
app.put('/api/projects/:id/routes', (req, res) =>
  withProject(req, res, async (p) => {
    const routes = req.body.routes as Route[];
    if (!Array.isArray(routes)) throw new Error('Send the full list of routes.');
    const ids = new Set(p.components.map((c) => c.id));
    const seen = new Set<string>();
    for (const r of routes) {
      if (!/^[A-Za-z0-9-]{2,24}$/.test(r.id)) throw new Error(`Route ID "${r.id}" must be 2 to 24 letters, digits or dashes.`);
      for (const cid of r.componentIds) {
        if (!ids.has(cid)) throw new Error('A route names a component that does not exist.');
        if (seen.has(cid)) throw new Error('A component is on two routes.');
        seen.add(cid);
      }
    }
    if (new Set(routes.map((r) => r.id)).size !== routes.length) throw new Error('Two routes share an ID.');
    p.routes = routes.filter((r) => r.componentIds.length).map((r) => ({ id: r.id, name: String(r.name).slice(0, 80), frequency: r.frequency, componentIds: r.componentIds }));
    applyRoutes(p.components, p.routes);
    p.log.push({ at: now(), who: role(req), what: String(req.body.note ?? 'Edited routes.').slice(0, 200) });
    await saveProject(p);
    emit(p);
    return p;
  }),
);

app.post('/api/projects/:id/routes/rebuild', (req, res) =>
  withProject(req, res, async (p) => {
    if (!p.survey) throw new Error('No survey yet.');
    if (typeof req.body.capacity === 'number') p.routeCapacity = Math.max(2, Math.min(500, Math.round(req.body.capacity)));
    p.routes = planRoutes(p.components, p.survey, p.routeCapacity);
    p.log.push({ at: now(), who: role(req), what: `Rebuilt the ideal routes at ${p.routeCapacity} components per route.` });
    await saveProject(p);
    emit(p);
    return p;
  }),
);

app.post('/api/projects/:id/review', (req, res) =>
  withProject(req, res, async (p) => {
    const stage = req.body.stage as Project['review'];
    if (!['draft', 'in_review', 'approved'].includes(stage)) throw new Error('Unknown review stage.');
    if (stage === 'approved' && p.components.some((c) => c.status === 'proposed')) throw new Error('Every proposal must be confirmed, corrected or rejected before approval.');
    p.review = stage;
    p.log.push({ at: now(), who: role(req), what: { draft: 'Returned to draft.', in_review: 'Sent for QA review.', approved: 'Approved into the record.' }[stage] });
    await saveProject(p);
    emit(p);
    return p;
  }),
);

app.put('/api/projects/:id/rules', (req, res) =>
  withProject(req, res, async (p) => {
    p.ruleOverrides = req.body.overrides ?? {};
    p.log.push({ at: now(), who: role(req), what: 'Changed rule values in the test area.' });
    await saveProject(p);
    emit(p);
    return p;
  }),
);

app.get('/api/projects/:id/checks', (req, res) => withProject(req, res, (p) => runChecks(p)));

app.post('/api/projects/:id/ask', (req, res) =>
  withProject(req, res, async (p) => {
    if (!aiConfigured()) throw new Error('Ask the record needs ANTHROPIC_API_KEY on the server. It is off in replay-only setups.');
    const q = String(req.body.question ?? '').trim().slice(0, 500);
    if (!q) throw new Error('Ask a question.');
    const inventory = {
      areas: p.survey?.areas.map(({ id, name }) => ({ id, name })),
      routes: p.routes.map((r) => ({ id: r.id, name: r.name, frequency: r.frequency, count: r.componentIds.length })),
      components: p.components.map(({ tag, equipmentId, equipmentName, type, sizeInches, areaId, locationDescription, status, confidence, difficultToMonitor, routeId, routeSeq }) =>
        ({ tag, equipmentId, equipmentName, type, sizeInches, areaId, locationDescription, status, confidence, difficultToMonitor, routeId, routeSeq })),
    };
    return { answer: await askRecord(q, inventory) };
  }),
);

app.get('/api/projects/:id/export.csv', (req, res) =>
  withProject(req, res, (p) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${p.name.replace(/[^A-Za-z0-9-]+/g, '_')}_inventory.csv"`);
    res.send(toCsv(p));
  }),
);

app.get('/api/projects/:id/export.json', (req, res) =>
  withProject(req, res, (p) => {
    res.set('Content-Disposition', `attachment; filename="${p.name.replace(/[^A-Za-z0-9-]+/g, '_')}_inventory.json"`);
    res.json({ name: p.name, survey: p.survey, routes: p.routes, components: p.components, log: p.log });
  }),
);

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve('dist');
  app.use(express.static(dist));
  app.get('/*rest', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`M21 survey prototype API on http://localhost:${port}${aiConfigured() ? '' : '  (ANTHROPIC_API_KEY not set: uploads will be refused)'}`);
});
