// Two ways to run the same screens:
// - server mode: the Express API in server/, with live AI when a key is set;
// - static mode: a claude.ai page with one finished project embedded. Changes run in the browser through
//   shared/actions.ts and are kept in this browser only.

import { applyPatch, applyRebuild, applyReview, applyRoutesEdit, applyRules, applyVerdict, type Verdict } from '../shared/actions';
import { toCsv } from '../shared/export';
import type { Correction, LdarType, Project, Route } from '../shared/types';

export const ROLE_KEY = 'm21.role';
export const currentRole = () => { try { return localStorage.getItem(ROLE_KEY) ?? 'Project manager'; } catch { return 'Project manager'; } };

/** Static mode is on when the page embeds <script id="m21-static" data-src="project.json">. */
const staticTag = typeof document !== 'undefined' ? document.getElementById('m21-static') : null;
export const STATIC = Boolean(staticTag);
const STATIC_SRC = staticTag?.getAttribute('data-src') ?? 'project.json';

type Status = { aiConfigured: boolean; model: string; static?: boolean };
type ListItem = Pick<Project, 'id' | 'name' | 'createdAt' | 'stage' | 'review'>;

// ---------- server mode ----------

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const serverApi = {
  status: () => call<Status>('/api/status'),
  list: () => call<ListItem[]>('/api/projects'),
  get: (id: string) => call<Project>(`/api/projects/${id}`),
  create: (form: FormData) => call<Project>('/api/projects', { method: 'POST', body: form }),
  verdict: (id: string, cid: string, body: Record<string, unknown>) => call<Project>(`/api/projects/${id}/components/${cid}/verdict`, json('POST', { ...body, role: currentRole() })),
  patch: (id: string, cid: string, body: Record<string, unknown>) => call<Project>(`/api/projects/${id}/components/${cid}`, json('PATCH', { ...body, role: currentRole() })),
  routes: (id: string, routes: Route[], note: string) => call<Project>(`/api/projects/${id}/routes`, json('PUT', { routes, note, role: currentRole() })),
  rebuild: (id: string, capacity: number) => call<Project>(`/api/projects/${id}/routes/rebuild`, json('POST', { capacity, role: currentRole() })),
  review: (id: string, stage: Project['review']) => call<Project>(`/api/projects/${id}/review`, json('POST', { stage, role: currentRole() })),
  rules: (id: string, overrides: Project['ruleOverrides']) => call<Project>(`/api/projects/${id}/rules`, json('PUT', { overrides, role: currentRole() })),
  ask: (id: string, question: string) => call<{ answer: string }>(`/api/projects/${id}/ask`, json('POST', { question })),
  file: (id: string, f: string) => `/api/projects/${id}/files/${f}`,
  csvUrl: (id: string) => `/api/projects/${id}/export.csv`,
  jsonUrl: (id: string) => `/api/projects/${id}/export.json`,
};

// ---------- static mode ----------

let original: Project | null = null;
let current: Project | null = null;
const key = (p: Project) => `m21.static.${p.id}`;
const corrKey = 'm21.static.corrections';

function store(p: Project) {
  try { localStorage.setItem(key(p), JSON.stringify(p)); } catch { /* storage blocked: changes last until reload */ }
}

async function loadStatic(): Promise<Project> {
  if (current) return current;
  const res = await fetch(STATIC_SRC);
  if (!res.ok) throw new Error('The embedded survey could not be loaded.');
  original = (await res.json()) as Project;
  let saved: Project | null = null;
  try { const raw = localStorage.getItem(key(original)); saved = raw ? (JSON.parse(raw) as Project) : null; } catch { saved = null; }
  current = saved ?? structuredClone(original);
  return current;
}

async function mutate(fn: (p: Project) => void): Promise<Project> {
  const p = structuredClone(await loadStatic());
  fn(p);
  current = p;
  store(p);
  return p;
}

export function staticCorrections(): Correction[] {
  try { return JSON.parse(localStorage.getItem(corrKey) ?? '[]') as Correction[]; } catch { return []; }
}

const staticApi: typeof serverApi = {
  status: async () => ({ aiConfigured: false, model: 'claude-opus-5-5', static: true }),
  list: async () => [],
  get: async () => loadStatic(),
  create: async () => { throw new Error('This page holds one prepared survey. New surveys need the app with a server.'); },
  verdict: (_id, cid, body) => mutate((p) => {
    const c = applyVerdict(p, cid, currentRole(), body as { verdict: Verdict; type?: LdarType; equipmentName?: string; locationDescription?: string; note?: string });
    try { localStorage.setItem(corrKey, JSON.stringify([...staticCorrections(), c])); } catch { /* not kept */ }
  }),
  patch: (_id, cid, body) => mutate((p) => applyPatch(p, cid, currentRole(), body)),
  routes: (_id, routes, note) => mutate((p) => applyRoutesEdit(p, routes, currentRole(), note)),
  rebuild: (_id, capacity) => mutate((p) => applyRebuild(p, currentRole(), capacity)),
  review: (_id, stage) => mutate((p) => applyReview(p, stage, currentRole())),
  rules: (_id, overrides) => mutate((p) => applyRules(p, overrides, currentRole())),
  ask: async () => { throw new Error('Ask the record needs a Claude API key, so it is off on this page.'); },
  file: (_id, f) => `files/${f}`,
  csvUrl: () => '',
  jsonUrl: () => '',
};

export const api = STATIC ? staticApi : serverApi;

/** Undo every change made in this browser and return to the analysis as delivered. */
export async function resetStatic(): Promise<Project | null> {
  if (!STATIC) return null;
  await loadStatic();
  try { localStorage.removeItem(key(original!)); } catch { /* nothing kept */ }
  current = structuredClone(original!);
  return current;
}

// ---------- downloads ----------

type Downloads = { save: (r: { filename: string; data: string | Blob }) => Promise<unknown> };
type ClaudeWin = { claude?: { use?: (n: string) => Promise<unknown> } };

/** Save a file. On the claude.ai page this goes through the viewer's download prompt; on the server app it is a normal link. */
export async function saveFile(filename: string, data: string, type: string, serverUrl?: string): Promise<string> {
  if (!STATIC && serverUrl) { location.href = serverUrl; return 'Downloading.'; }
  const w = window as unknown as ClaudeWin;
  const dl = (await w.claude?.use?.('downloads').catch(() => null)) as Downloads | null;
  if (dl) {
    try { await dl.save({ filename, data: new Blob([data], { type }) }); return 'Saved.'; }
    catch (e) { const code = (e as { code?: string }).code; return code === 'declined' ? 'Download cancelled.' : 'This file could not be saved here.'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = filename;
  a.click();
  return 'Downloading.';
}

export const exportCsv = (p: Project) => toCsv(p);
