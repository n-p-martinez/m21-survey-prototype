import type { Project, Route } from '../shared/types';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const ROLE_KEY = 'm21.role';
export const currentRole = () => { try { return localStorage.getItem(ROLE_KEY) ?? 'Project manager'; } catch { return 'Project manager'; } };

export const api = {
  status: () => call<{ aiConfigured: boolean; model: string }>('/api/status'),
  list: () => call<Pick<Project, 'id' | 'name' | 'createdAt' | 'stage' | 'review'>[]>('/api/projects'),
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
};
