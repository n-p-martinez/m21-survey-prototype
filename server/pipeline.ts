// From uploads to a proposed inventory: read the survey, sample the video, find components, merge, build.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildInventory, type Proposal } from '../shared/build';
import type { Project, SurveyModel } from '../shared/types';
import { detectInFrames, mergeObservations, readSurvey, type Observations } from './ai';
import { loadCorrections, projectDir, saveProject } from './store';
import type { AnalysisFile } from './replay';
import { extractFramesAt, frameTimes } from './video';

const BATCH = 8;          // frames per detection call
const PARALLEL = 3;       // detection calls at once
const clamp = (n: number) => Math.min(1, Math.max(0, n));

type Emit = (p: Project) => void;

async function step(p: Project, emit: Emit, stage: Project['stage'], stepName: string, done: number, total: number, message: string) {
  p.stage = stage;
  p.progress = { step: stepName, done, total, message };
  await saveProject(p);
  emit(p);
}

/** Live runs call Claude. A replay returns the recorded answers in the same order, paced so the steps can be watched. */
export async function runPipeline(p: Project, emit: Emit, recorded?: AnalysisFile): Promise<void> {
  const dir = projectDir(p.id);
  const pause = (ms: number) => new Promise((r) => setTimeout(r, recorded ? ms : 0));
  try {
    // 1. Survey
    await step(p, emit, 'survey', 'Reading the survey', 0, 1, 'Finding areas, reference points and personal details to hide');
    const pdf = recorded ? '' : (await readFile(path.join(dir, 'survey.pdf'))).toString('base64');
    const png = recorded ? '' : (await readFile(path.join(dir, p.survey!.pageImage))).toString('base64');
    const s = recorded ? (await pause(2500), recorded.survey) : await readSurvey(pdf, png);
    const survey: SurveyModel = { ...p.survey!, ...s };
    p.survey = survey;
    p.log.push({ at: new Date().toISOString(), who: 'AI', what: `Read the survey: ${s.areas.length} areas, ${s.referencePoints.length} reference points, ${s.redactions.length} personal details hidden.` });

    // 2. Frames
    await step(p, emit, 'frames', 'Sampling the video', 0, 1, 'Pulling frames with ffmpeg');
    const times = recorded ? recorded.frameTimes : frameTimes(p.video!.duration, Number(process.env.M21_MAX_FRAMES ?? 120));
    p.frames = await extractFramesAt(path.join(dir, p.video!.file), path.join(dir, 'frames'), times);
    const examples = recorded ? [] : (await loadCorrections()).slice(-30);
    const batches: number[][] = [];
    for (let i = 0; i < p.frames.length; i += BATCH) batches.push(p.frames.slice(i, i + BATCH).map((_, j) => i + j));
    const all: (Observations['observations'][number] & { frame: number })[] = [];
    const privacy: { frame: number; box: { x: number; y: number; w: number; h: number } }[] = [];
    let finished = 0;
    await step(p, emit, 'detect', 'Finding components', 0, batches.length, `${p.frames.length} frames in ${batches.length} batches`);
    if (recorded && recorded.batches.length !== batches.length) throw new Error('The analysis file does not match this video\'s frame batches.');
    for (let i = 0; i < batches.length; i += PARALLEL) {
      await Promise.all(batches.slice(i, i + PARALLEL).map(async (idx, j) => {
        const r = recorded
          ? (await pause(900 + 300 * j), recorded.batches[i + j])
          : await detectInFrames(
            await Promise.all(idx.map(async (k) => ({ b64: (await readFile(path.join(dir, p.frames[k].file))).toString('base64'), t: p.frames[k].t }))),
            survey, examples);
        for (const o of r.observations) if (idx[o.frameIndex] !== undefined) all.push({ ...o, frame: idx[o.frameIndex] });
        for (const q of r.privacy) if (idx[q.frameIndex] !== undefined) privacy.push({ frame: idx[q.frameIndex], box: q.box });
        finished += 1;
        await step(p, emit, 'detect', 'Finding components', finished, batches.length, `${all.length} sightings so far`);
      }));
    }
    p.privacy = privacy;

    // 4. Merge sightings into components
    await step(p, emit, 'consolidate', 'Merging sightings', 0, 1, `${all.length} sightings into components`);
    const merged = recorded ? (await pause(2500), recorded.merged) : await mergeObservations(
      all.map((o, id) => ({ id, t: p.frames[o.frame].t, householdName: o.householdName, type: o.type, equipmentName: o.equipmentName, areaId: o.areaId, nearReferenceId: o.nearReferenceId, locationDescription: o.locationDescription, confidence: o.confidence, sizeInches: o.sizeInches })),
      survey,
    );
    const areaIds = new Set(survey.areas.map((a) => a.id));
    const proposals: Proposal[] = merged.components.map((m) => ({
      key: m.key,
      parentKey: m.parentKey,
      householdName: m.householdName,
      equipmentName: m.equipmentName,
      type: m.type,
      sizeInches: m.sizeInches,
      areaId: areaIds.has(m.areaId) ? m.areaId : survey.areas[0]?.id ?? 'GEN',
      referenceId: m.referenceId,
      locationDescription: m.locationDescription,
      plan: { x: clamp(m.plan.x), y: clamp(m.plan.y) },
      sightings: m.observationIds.filter((id) => all[id]).map((id) => ({ t: p.frames[all[id].frame].t, frame: p.frames[all[id].frame].file, box: all[id].box })),
      confidence: clamp(m.confidence),
      confidenceNote: m.confidenceNote,
      difficultToMonitor: m.difficultToMonitor,
      unsafeToMonitor: m.unsafeToMonitor,
    }));

    // 5. Tags, equipment IDs and the ideal route
    await step(p, emit, 'build', 'Building routes', 0, 1, `${proposals.length} components`);
    const built = buildInventory(proposals, survey, p.routeCapacity);
    p.components = built.components;
    p.routes = built.routes;
    p.log.push({ at: new Date().toISOString(), who: 'AI', what: `Proposed ${proposals.length} components on ${built.routes.length} routes from ${p.frames.length} frames${recorded ? `, replayed from the analysis run on ${recorded.ranAt.slice(0, 10)}` : ''}.` });
    await step(p, emit, 'ready', 'Ready for review', 1, 1, 'Every proposal needs a technician to confirm or correct it');
  } catch (e) {
    p.stage = 'error';
    p.error = e instanceof Error ? e.message : String(e);
    await saveProject(p);
    emit(p);
  }
}
