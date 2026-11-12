// Deterministic steps after the AI proposes components: equipment IDs, tag numbers,
// the ideal route, and the checks the 10/28 session asked for. No AI calls here.

import { DTM_VALVE_CAP } from './rules';
import type { Area, Component, LdarType, Point, Project, Route, SurveyModel } from './types';

export const TYPE_PREFIX: Record<LdarType, string> = {
  valve: 'V',
  connector: 'CN',
  pump: 'P',
  compressor: 'C',
  agitator: 'AG',
  pressure_relief_device: 'PSV',
  sampling_connection: 'SC',
  open_ended_line: 'OEL',
  instrumentation: 'I',
};

/** What the AI consolidation step returns for each physical component. */
export interface Proposal {
  key: string;
  parentKey: string | null;
  householdName: string;
  equipmentName: string;
  type: LdarType;
  sizeInches: number | null;
  areaId: string;
  referenceId: string | null;
  locationDescription: string;
  plan: Point;
  sightings: Component['sightings'];
  confidence: number;
  confidenceNote: string;
  difficultToMonitor: boolean;
  unsafeToMonitor: boolean;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (a: Area): Point => ({ x: a.box.x + a.box.w / 2, y: a.box.y + a.box.h / 2 });

/** Order areas as a walkable loop: start nearest the entry, then always the nearest unvisited area. */
export function orderAreas(survey: SurveyModel, used: Set<string>): Area[] {
  const left = survey.areas.filter((a) => used.has(a.id));
  const out: Area[] = [];
  let at = survey.entry;
  while (left.length) {
    left.sort((a, b) => dist(at, center(a)) - dist(at, center(b)));
    const next = left.shift()!;
    out.push(next);
    at = center(next);
  }
  return out;
}

/** Order components inside one area by nearest neighbour from where the walker enters it. Children follow their parent. */
export function orderWithinArea<T extends { key: string; parentKey: string | null; plan: Point }>(items: T[], enterAt: Point): T[] {
  const parents = items.filter((p) => !p.parentKey || !items.some((q) => q.key === p.parentKey));
  const kids = (k: string) => items.filter((c) => c.parentKey === k);
  const out: T[] = [];
  let at = enterAt;
  const left = [...parents];
  while (left.length) {
    left.sort((a, b) => dist(at, a.plan) - dist(at, b.plan));
    const p = left.shift()!;
    out.push(p, ...kids(p.key));
    at = p.plan;
  }
  return out;
}

/**
 * Build the first, ideal version of the inventory and routes.
 * Areas are grouped and ordered, components ordered within each area, routes split at capacity,
 * and difficult or unsafe components routed separately on an annual route.
 */
export function buildInventory(proposals: Proposal[], survey: SurveyModel, capacity: number): { components: Component[]; routes: Route[] } {
  const areaIds = new Set(proposals.map((p) => p.areaId));
  const areas = orderAreas(survey, areaIds);
  const areaIndex = new Map(areas.map((a, i) => [a.id, i + 1]));

  // Walk order across the facility.
  const walk: Proposal[] = [];
  let at = survey.entry;
  for (const a of areas) {
    const inArea = proposals.filter((p) => p.areaId === a.id);
    const ordered = orderWithinArea(inArea, at);
    walk.push(...ordered);
    if (ordered.length) at = ordered[ordered.length - 1].plan;
  }

  // Equipment IDs: type prefix, area number, sequence. V-101 is the first valve in area 1.
  const seq = new Map<string, number>();
  const equipmentId = (p: Proposal) => {
    const n = areaIndex.get(p.areaId) ?? 9;
    const k = `${TYPE_PREFIX[p.type]}-${n}`;
    const i = (seq.get(k) ?? 0) + 1;
    seq.set(k, i);
    return `${TYPE_PREFIX[p.type]}-${n}${String(i).padStart(2, '0')}`;
  };

  // Tags: base numbers in walk order starting at 100, decimal children (100.1, 100.2) under their parent.
  const tagOf = new Map<string, string>();
  let base = 100;
  const childCount = new Map<string, number>();
  for (const p of walk) {
    const parentTag = p.parentKey ? tagOf.get(p.parentKey) : undefined;
    if (parentTag) {
      const c = (childCount.get(parentTag) ?? 0) + 1;
      childCount.set(parentTag, c);
      tagOf.set(p.key, `${parentTag}.${c}`);
    } else {
      tagOf.set(p.key, String(base));
      base += 1;
    }
  }

  const components: Component[] = walk.map((p) => ({
    id: p.key,
    tag: tagOf.get(p.key)!,
    equipmentId: equipmentId(p),
    equipmentName: p.equipmentName,
    householdName: p.householdName,
    type: p.type,
    sizeInches: p.sizeInches,
    areaId: p.areaId,
    referenceId: p.referenceId,
    locationDescription: p.locationDescription,
    parentTag: p.parentKey ? tagOf.get(p.parentKey) ?? null : null,
    plan: p.plan,
    sightings: p.sightings,
    confidence: p.confidence,
    confidenceNote: p.confidenceNote,
    difficultToMonitor: p.difficultToMonitor,
    unsafeToMonitor: p.unsafeToMonitor,
    status: 'proposed',
    verifiedBy: null,
    routeId: null,
    routeSeq: null,
  }));

  const routes = planRoutes(components, survey, capacity);
  return { components, routes };
}

/** Group components into routes: areas in walk order, split at capacity; hard-to-reach work on its own annual route. */
export function planRoutes(components: Component[], survey: SurveyModel, capacity: number): Route[] {
  const live = components.filter((c) => c.status !== 'rejected');
  const hard = live.filter((c) => c.difficultToMonitor || c.unsafeToMonitor);
  const normal = live.filter((c) => !hard.includes(c));
  const areaName = (id: string) => survey.areas.find((a) => a.id === id)?.name ?? id;

  const routes: Route[] = [];
  let current: Component[] = [];
  const flush = () => {
    if (!current.length) return;
    const codes = [...new Set(current.map((c) => c.areaId))];
    const n = routes.filter((r) => r.frequency === 'quarterly' && r.id.startsWith(`${codes[0]}-`)).length + 1;
    routes.push({
      id: `${codes[0]}-Q-${String(n).padStart(2, '0')}`,
      name: codes.map(areaName).join(', '),
      frequency: 'quarterly',
      componentIds: current.map((c) => c.id),
    });
    current = [];
  };
  for (const c of normal) {
    // Keep a parent and its children together when splitting.
    if (current.length >= capacity && !c.parentTag) flush();
    current.push(c);
  }
  flush();
  if (hard.length) {
    routes.push({
      id: `${hard[0].areaId}-A-01`,
      name: 'Difficult or unsafe to monitor',
      frequency: 'annual',
      componentIds: hard.map((c) => c.id),
    });
  }
  applyRoutes(components, routes);
  return routes;
}

/** Write route id and sequence back onto each component after any route change. */
export function applyRoutes(components: Component[], routes: Route[]): void {
  for (const c of components) { c.routeId = null; c.routeSeq = null; }
  const byId = new Map(components.map((c) => [c.id, c]));
  for (const r of routes) {
    r.componentIds = r.componentIds.filter((id) => byId.has(id));
    r.componentIds.forEach((id, i) => {
      const c = byId.get(id)!;
      c.routeId = r.id;
      c.routeSeq = i + 1;
    });
  }
}

export interface Check { id: string; level: 'ok' | 'warn' | 'fail'; title: string; detail: string; componentIds: string[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The checks the 10/28 session asked the database to run on itself. */
export function runChecks(p: Project): Check[] {
  const live = p.components.filter((c) => c.status !== 'rejected');
  const checks: Check[] = [];

  const byDesc = new Map<string, string[]>();
  for (const c of live) {
    const k = norm(c.locationDescription);
    byDesc.set(k, [...(byDesc.get(k) ?? []), c.id]);
  }
  const dupes = [...byDesc.values()].filter((ids) => ids.length > 1);
  checks.push({
    id: 'unique-location',
    level: dupes.length ? 'fail' : 'ok',
    title: 'Every location description is unique',
    detail: dupes.length
      ? `${dupes.flat().length} components share ${dupes.length} descriptions. A repeated description makes a component impossible to find again.`
      : 'No two components share a description.',
    componentIds: dupes.flat(),
  });

  const valves = live.filter((c) => c.type === 'valve');
  const dtm = valves.filter((c) => c.difficultToMonitor);
  const share = valves.length ? dtm.length / valves.length : 0;
  checks.push({
    id: 'dtm-cap',
    level: share > DTM_VALVE_CAP ? 'warn' : 'ok',
    title: 'Difficult-to-monitor valves under the cap',
    detail: `${dtm.length} of ${valves.length} valves (${(share * 100).toFixed(1)}%) are difficult to monitor. The cap cited on 10/28 is ${DTM_VALVE_CAP * 100}% for a new unit; orientation only.`,
    componentIds: dtm.map((c) => c.id),
  });

  const unverified = live.filter((c) => c.status === 'proposed');
  checks.push({
    id: 'verified',
    level: unverified.length ? 'warn' : 'ok',
    title: 'Every proposal verified by a technician',
    detail: unverified.length ? `${unverified.length} proposals still need a technician to confirm or correct them.` : 'All proposals verified.',
    componentIds: unverified.map((c) => c.id),
  });

  const lowConf = live.filter((c) => c.status === 'proposed' && c.confidence < 0.6);
  checks.push({
    id: 'low-confidence',
    level: lowConf.length ? 'warn' : 'ok',
    title: 'Low-confidence proposals reviewed first',
    detail: lowConf.length ? `${lowConf.length} unverified proposals are below 60% confidence.` : 'No unverified proposal is below 60% confidence.',
    componentIds: lowConf.map((c) => c.id),
  });

  const unrouted = live.filter((c) => !c.routeId);
  checks.push({
    id: 'routed',
    level: unrouted.length ? 'fail' : 'ok',
    title: 'Every component is on a route',
    detail: unrouted.length ? `${unrouted.length} components are on no route.` : 'All components are on a route.',
    componentIds: unrouted.map((c) => c.id),
  });

  const over = p.routes.filter((r) => r.componentIds.length > p.routeCapacity);
  checks.push({
    id: 'capacity',
    level: over.length ? 'warn' : 'ok',
    title: 'Routes fit a technician day',
    detail: over.length ? `${over.map((r) => r.id).join(', ')} exceed ${p.routeCapacity} components.` : `All routes are at or under ${p.routeCapacity} components.`,
    componentIds: over.flatMap((r) => r.componentIds),
  });

  checks.push({
    id: 'location-gps',
    level: 'ok',
    title: 'Reading taken at the component',
    detail: 'In the field app, GPS confirms the technician is near the pinned location before a reading saves. GPS is unreliable indoors, so it asks rather than blocks. Not exercised in this prototype.',
    componentIds: [],
  });

  return checks;
}
