import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInventory, planRoutes, runChecks, type Proposal } from './build';
import { toCsv } from './export';
import type { Project, SurveyModel } from './types';

const survey: SurveyModel = {
  pageImage: 'survey.png', pageWidth: 1000, pageHeight: 800, entry: { x: 0, y: 0.5 }, redactions: [], notes: '',
  areas: [
    { id: 'KIT', name: 'Area 1, kitchen', box: { x: 0, y: 0.3, w: 0.3, h: 0.4 } },
    { id: 'LAU', name: 'Area 2, laundry', box: { x: 0.7, y: 0.3, w: 0.3, h: 0.4 } },
    { id: 'BTH', name: 'Area 3, bath', box: { x: 0.35, y: 0.3, w: 0.3, h: 0.4 } },
  ],
  referencePoints: [{ id: 'REF-01', name: 'Refrigerator', areaId: 'KIT', at: { x: 0.1, y: 0.4 } }],
};

const p = (key: string, areaId: string, x: number, extra: Partial<Proposal> = {}): Proposal => ({
  key, parentKey: null, householdName: key, equipmentName: key, type: 'valve', sizeInches: 0.5, areaId, referenceId: null,
  locationDescription: `desc ${key}`, plan: { x, y: 0.5 }, sightings: [{ t: 1, frame: 'f.jpg', box: { x: 0, y: 0, w: 0.1, h: 0.1 } }],
  confidence: 0.8, confidenceNote: '', difficultToMonitor: false, unsafeToMonitor: false, ...extra,
});

const proposals = [
  p('sink', 'KIT', 0.2),
  p('sink-conn', 'KIT', 0.21, { parentKey: 'sink', type: 'connector' }),
  p('washer-pump', 'LAU', 0.8, { type: 'pump' }),
  p('tub', 'BTH', 0.5),
  p('attic', 'BTH', 0.55, { difficultToMonitor: true, locationDescription: 'desc tub' }),
];

test('areas are walked nearest-first from the entry, children follow the parent', () => {
  const { components } = buildInventory(proposals, survey, 500);
  assert.deepEqual(components.map((c) => c.areaId), ['KIT', 'KIT', 'BTH', 'BTH', 'LAU']);
  assert.equal(components[0].tag, '100');
  assert.equal(components[1].tag, '100.1');
  assert.equal(components[1].parentTag, '100');
  assert.equal(components[0].equipmentId, 'V-101');
  assert.equal(components[1].equipmentId, 'CN-101');
  assert.equal(components.find((c) => c.id === 'washer-pump')!.equipmentId, 'P-301');
});

test('difficult components go on a separate annual route; routes split at capacity', () => {
  const { components, routes } = buildInventory(proposals, survey, 2);
  const annual = routes.find((r) => r.frequency === 'annual')!;
  assert.deepEqual(annual.componentIds, ['attic']);
  const q = routes.filter((r) => r.frequency === 'quarterly');
  assert.ok(q.every((r) => r.componentIds.length <= 2));
  assert.ok(components.every((c) => c.routeId && c.routeSeq));
});

test('rejected components drop off routes; checks find duplicate descriptions', () => {
  const built = buildInventory(proposals, survey, 500);
  const project = { components: built.components, routes: built.routes, routeCapacity: 500, survey, ruleOverrides: {} } as unknown as Project;
  const checks = runChecks(project);
  assert.equal(checks.find((c) => c.id === 'unique-location')!.level, 'fail');
  built.components.find((c) => c.id === 'tub')!.status = 'rejected';
  project.routes = planRoutes(built.components, survey, 500);
  assert.ok(!project.routes.some((r) => r.componentIds.includes('tub')));
});

test('CSV quotes commas and lists every live component once', () => {
  const built = buildInventory(proposals, survey, 500);
  built.components[0].locationDescription = 'Under the sink, left side';
  const project = { components: built.components, routes: built.routes, survey, ruleOverrides: {} } as unknown as Project;
  const csv = toCsv(project).trim().split('\r\n');
  assert.equal(csv.length, 1 + proposals.length);
  assert.ok(csv.some((l) => l.includes('"Under the sink, left side"')));
});
