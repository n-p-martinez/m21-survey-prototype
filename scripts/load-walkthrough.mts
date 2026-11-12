// Load a walkthrough analysis made outside the app (proposals from still frames) into a project:
// tags, equipment IDs and routes come from the app's own builder, so they match a live run.
// Usage: npx tsx scripts/load-walkthrough.mts <projectDir> <proposals.json>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildInventory, type Proposal } from '../shared/build';
import type { Project } from '../shared/types';

const [dir, file] = process.argv.slice(2);
if (!dir || !file) { console.error('Usage: npx tsx scripts/load-walkthrough.mts <projectDir> <proposals.json>'); process.exit(1); }
const p = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8')) as Project;
const w = JSON.parse(readFileSync(file, 'utf8')) as {
  ranAt: string; ranBy: string; note: string;
  frames: Project['frames']; referencePoints: NonNullable<Project['survey']>['referencePoints']; proposals: Proposal[];
};
const survey = p.survey!;
for (const r of w.referencePoints) if (!survey.referencePoints.some((x) => x.id === r.id)) survey.referencePoints.push(r);
const built = buildInventory(w.proposals, survey, p.routeCapacity);
p.frames = w.frames;
p.privacy = [];
p.components = built.components;
p.routes = built.routes;
p.replay = { ranAt: w.ranAt, ranBy: w.ranBy, note: w.note };
p.review = 'draft';
p.log.push({ at: w.ranAt, who: 'AI', what: `Proposed ${built.components.length} components on ${built.routes.length} routes from ${w.frames.length} walkthrough frames and the survey.` });
writeFileSync(path.join(dir, 'project.json'), JSON.stringify(p, null, 2));
console.log(built.components.map((c) => `${c.tag}\t${c.equipmentId}\t${c.type}\t${Math.round(c.confidence * 100)}%\t${c.equipmentName}`).join('\n'));
console.log(built.routes.map((r) => `${r.id}: ${r.componentIds.length}`).join('\n'));
