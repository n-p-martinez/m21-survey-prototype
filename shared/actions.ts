// Every change a person makes to a project, as plain functions on the Project object.
// The server calls these and saves the result; the static claude.ai page calls them in the browser.

import { applyRoutes, planRoutes } from './build';
import { LDAR_TYPES, type Component, type Correction, type LdarType, type Project, type Route } from './types';

const now = () => new Date().toISOString();
const log = (p: Project, who: string, what: string) => p.log.push({ at: now(), who, what });

export type Verdict = 'confirmed' | 'corrected' | 'rejected';

/** A technician's verdict on one proposal. Returns the correction to keep as a future example. */
export function applyVerdict(
  p: Project, cid: string, who: string,
  body: { verdict: Verdict; type?: LdarType; equipmentName?: string; locationDescription?: string; note?: string },
): Correction {
  const c = p.components.find((x) => x.id === cid);
  if (!c) throw new Error('No such component.');
  if (!['confirmed', 'corrected', 'rejected'].includes(body.verdict)) throw new Error('Unknown verdict.');
  if (body.type && !LDAR_TYPES.includes(body.type)) throw new Error('Unknown component type.');
  const before = c.type;
  if (body.verdict === 'corrected') {
    if (body.type) c.type = body.type;
    if (typeof body.equipmentName === 'string') c.equipmentName = body.equipmentName.slice(0, 120);
    if (typeof body.locationDescription === 'string') c.locationDescription = body.locationDescription.slice(0, 240);
  }
  c.status = body.verdict;
  c.verifiedBy = who;
  if (body.verdict === 'rejected') {
    for (const r of p.routes) r.componentIds = r.componentIds.filter((id) => id !== c.id);
    applyRoutes(p.components, p.routes);
  }
  log(p, who, `${body.verdict[0].toUpperCase() + body.verdict.slice(1)} ${c.tag} ${c.equipmentId}${body.verdict === 'corrected' && before !== c.type ? `, type ${before} to ${c.type}` : ''}.`);
  return { at: now(), householdName: c.householdName, proposedType: before, finalType: c.type, proposedConfidence: c.confidence, verdict: body.verdict, note: String(body.note ?? '').slice(0, 200) };
}

/** Field edits that are not a verdict: difficult or unsafe to monitor, pin position, location text. */
export function applyPatch(p: Project, cid: string, who: string, body: { difficultToMonitor?: boolean; unsafeToMonitor?: boolean; plan?: { x: number; y: number }; locationDescription?: string }): void {
  const c = p.components.find((x) => x.id === cid);
  if (!c) throw new Error('No such component.');
  const changes: string[] = [];
  const set = <K extends keyof Component>(k: K, v: Component[K], label: string) => { c[k] = v; changes.push(label); };
  if (typeof body.difficultToMonitor === 'boolean') set('difficultToMonitor', body.difficultToMonitor, `difficult to monitor ${body.difficultToMonitor ? 'on' : 'off'}`);
  if (typeof body.unsafeToMonitor === 'boolean') set('unsafeToMonitor', body.unsafeToMonitor, `unsafe to monitor ${body.unsafeToMonitor ? 'on' : 'off'}`);
  if (body.plan && typeof body.plan.x === 'number') set('plan', { x: Math.min(1, Math.max(0, body.plan.x)), y: Math.min(1, Math.max(0, body.plan.y)) }, 'pin moved');
  if (typeof body.locationDescription === 'string') set('locationDescription', body.locationDescription.slice(0, 240), 'location described');
  if (changes.length) log(p, who, `${c.tag}: ${changes.join(', ')}.`);
}

/** The project manager's route edits, checked so no component is lost or doubled. */
export function applyRoutesEdit(p: Project, routes: Route[], who: string, note: string): void {
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
  p.routes = routes.filter((r) => r.componentIds.length).map((r) => ({ id: r.id, name: String(r.name).slice(0, 80), frequency: r.frequency, componentIds: [...r.componentIds] }));
  applyRoutes(p.components, p.routes);
  log(p, who, String(note || 'Edited routes.').slice(0, 200));
}

export function applyRebuild(p: Project, who: string, capacity?: number): void {
  if (!p.survey) throw new Error('No survey yet.');
  if (typeof capacity === 'number') p.routeCapacity = Math.max(2, Math.min(500, Math.round(capacity)));
  p.routes = planRoutes(p.components, p.survey, p.routeCapacity);
  log(p, who, `Rebuilt the ideal routes at ${p.routeCapacity} components per route.`);
}

export function applyReview(p: Project, stage: Project['review'], who: string): void {
  if (!['draft', 'in_review', 'approved'].includes(stage)) throw new Error('Unknown review stage.');
  if (stage === 'approved' && p.components.some((c) => c.status === 'proposed')) throw new Error('Every proposal must be confirmed, corrected or rejected before approval.');
  p.review = stage;
  log(p, who, { draft: 'Returned to draft.', in_review: 'Sent for QA review.', approved: 'Approved into the record.' }[stage]);
}

export function applyRules(p: Project, overrides: Project['ruleOverrides'], who: string): void {
  p.ruleOverrides = overrides ?? {};
  log(p, who, Object.keys(p.ruleOverrides).length ? 'Changed rule values in the test area.' : 'Reset rules to the federal values.');
}
