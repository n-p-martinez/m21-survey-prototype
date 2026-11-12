// Every call to Claude lives here. Each step returns JSON checked against a Zod schema.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { LDAR_TYPES, type Correction, type SurveyModel } from '../shared/types';

export const MODEL = process.env.M21_MODEL ?? 'claude-opus-5-5';
let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic());

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type Content = Anthropic.Beta.Messages.BetaContentBlockParam;

/**
 * One structured call. Server-side fallbacks are on: if the model declines, the API reruns the request on a
 * fallback model inside the same call.
 */
async function structured<S extends z.ZodType>(schema: S, system: string, content: Content[], effort: Effort): Promise<z.infer<S>> {
  const res = await api().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: betaZodOutputFormat(schema) },
  });
  if (res.stop_reason === 'refusal') throw new Error(`The model declined this step (${res.stop_details?.category ?? 'no category'}).`);
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off at the token limit. Try a shorter video segment.');
  if (!res.parsed_output) throw new Error('The model returned JSON that did not match the expected shape.');
  return res.parsed_output as z.infer<S>;
}

const img = (b64: string, media: 'image/png' | 'image/jpeg'): Content => ({ type: 'image', source: { type: 'base64', media_type: media, data: b64 } });

// ---------- Step 1: read the survey ----------

const BoxS = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const PointS = z.object({ x: z.number(), y: z.number() });

export const SurveyS = z.object({
  areas: z.array(z.object({ id: z.string(), name: z.string(), box: BoxS })),
  referencePoints: z.array(z.object({ id: z.string(), name: z.string(), areaId: z.string(), at: PointS })),
  entry: PointS,
  redactions: z.array(BoxS),
  notes: z.string(),
});

const SURVEY_SYSTEM = `You read site survey drawings for a Method 21 leak detection and repair (LDAR) program.
This drawing is a house survey used as stand-in data for an industrial facility. Treat rooms as process areas and large fixtures and furniture as major equipment.

Return, with every coordinate normalized 0..1 from the top-left of the page IMAGE provided:
- areas: each room or distinct outdoor zone. id is a 3-letter uppercase code from its use (KIT, LAU, BTH, GAR). name is "Area <n>, <room type>" numbered in a sensible walking order from the main entry. box encloses the room.
- referencePoints: major fixed items a technician would navigate by (water heater, furnace, refrigerator, range, washer, kitchen island, stairs, exterior wall door). id REF-01, REF-02... areaId is the containing area. Only items shown or labeled on the drawing.
- entry: the main entry door.
- redactions: boxes covering anything personal: owner or client names, street address, parcel or lot numbers, surveyor names, signatures, seals, phone numbers, dates of sale. Be generous; these are hidden in the app.
- notes: one or two sentences on what the drawing shows and any limits (scale, missing rooms).`;

export async function readSurvey(pdfB64: string, pagePngB64: string): Promise<z.infer<typeof SurveyS>> {
  return structured(SurveyS, SURVEY_SYSTEM, [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
    img(pagePngB64, 'image/png'),
    { type: 'text', text: 'The PDF is the survey. The image is page 1 rendered at the size the app displays; give all coordinates on that image.' },
  ], 'high');
}

// ---------- Step 2: find components in video frames ----------

export const ObservationsS = z.object({
  observations: z.array(z.object({
    frameIndex: z.number().int(),
    householdName: z.string(),
    type: z.enum(LDAR_TYPES),
    equipmentName: z.string(),
    sizeInches: z.number().nullable(),
    areaId: z.string(),
    nearReferenceId: z.string().nullable(),
    locationDescription: z.string(),
    box: BoxS,
    confidence: z.number(),
    confidenceNote: z.string(),
    difficultToMonitor: z.boolean(),
    unsafeToMonitor: z.boolean(),
  })),
  privacy: z.array(z.object({ frameIndex: z.number().int(), box: BoxS })),
});
export type Observations = z.infer<typeof ObservationsS>;

const TYPE_GUIDE = `Map household items to the federal equipment-leak component types:
- valve: faucets, fixture shutoff (angle stop) valves, main water shutoff, gas appliance shutoff, hose valves inside.
- connector: compression fittings, threaded unions, braided or flex supply lines, gas flex connectors, appliance hookups. Each end of a supply line is one connector.
- pump: dishwasher or washer pump housings, sump pump, well pump, recirculation pump.
- compressor: refrigerator or freezer compressor, AC condenser, heat pump.
- agitator: top-load washer agitator, stand mixer, blender base.
- pressure_relief_device: water heater temperature and pressure relief valve, boiler relief valve, pressure cooker valve.
- sampling_connection: refrigerator water or ice dispenser, outdoor hose bib, laundry sink sprayer.
- open_ended_line: sink and tub drains, washer standpipe, capped or uncapped stub-outs, dryer vent outlet.
- instrumentation: thermostats, gas meter, pressure gauges, water meter, smoke or CO detectors.
Large furniture and appliance bodies are reference points, not components. Do not list walls, decor or personal belongings.`;

export async function detectInFrames(
  frames: { b64: string; t: number }[],
  survey: SurveyModel,
  examples: Correction[],
): Promise<Observations> {
  const areaList = survey.areas.map((a) => `${a.id}: ${a.name}`).join('\n');
  const refList = survey.referencePoints.map((r) => `${r.id}: ${r.name} (${r.areaId})`).join('\n');
  const ex = examples.length
    ? `Technician verdicts on earlier proposals. Learn from them; where a technician corrected a type, use the corrected type for similar items:\n${examples
        .map((c) => `- "${c.householdName}": proposed ${c.proposedType} at ${Math.round(c.proposedConfidence * 100)}%, technician ${c.verdict}${c.verdict === 'corrected' ? ` to ${c.finalType}` : ''}${c.note ? ` (${c.note})` : ''}`)
        .join('\n')}`
    : 'No technician verdicts yet.';
  const system = `You are building a Method 21 component inventory from walkthrough video frames.
${TYPE_GUIDE}

Areas on the survey:
${areaList}

Reference points:
${refList}

For every component you can see, return one observation per frame it appears in:
- frameIndex: the index of the image it appears in.
- equipmentName: a plain engineering name, e.g. "Kitchen sink cold supply valve" or "Water heater relief valve". Never a person's name.
- areaId: which survey area the frame shows. Use the room visible and the order of frames.
- locationDescription: start at the component and move outward to a unique landmark, relative to a reference point where possible, e.g. "Under kitchen sink, left of the drain, 1 ft above the cabinet floor". Make it specific enough that no other component could match.
- box: where it is in that frame, normalized 0..1.
- sizeInches: nominal connection size if you can estimate it, else null.
- confidence 0..1: how sure you are of the TYPE and that it is real. Be honest; low scores are useful. confidenceNote says what would raise it.
- difficultToMonitor: it would need a ladder, crawlspace or moving furniture. unsafeToMonitor: hot, energized or otherwise hazardous to reach.
Also return privacy boxes for people, faces, mail, documents, screens or house numbers visible in any frame.

${ex}`;
  const content: Content[] = [];
  frames.forEach((f, i) => {
    content.push({ type: 'text', text: `Image ${i} at ${f.t.toFixed(1)} s` });
    content.push(img(f.b64, 'image/jpeg'));
  });
  content.push({ type: 'text', text: 'List the components and privacy boxes in these frames.' });
  return structured(ObservationsS, system, content, 'medium');
}

// ---------- Step 3: merge sightings into components ----------

export const MergedS = z.object({
  components: z.array(z.object({
    key: z.string(),
    parentKey: z.string().nullable(),
    householdName: z.string(),
    equipmentName: z.string(),
    type: z.enum(LDAR_TYPES),
    sizeInches: z.number().nullable(),
    areaId: z.string(),
    referenceId: z.string().nullable(),
    locationDescription: z.string(),
    plan: PointS,
    observationIds: z.array(z.number().int()),
    confidence: z.number(),
    confidenceNote: z.string(),
    difficultToMonitor: z.boolean(),
    unsafeToMonitor: z.boolean(),
  })),
});

export async function mergeObservations(
  observations: { id: number; t: number; householdName: string; type: string; equipmentName: string; areaId: string; nearReferenceId: string | null; locationDescription: string; confidence: number; sizeInches: number | null }[],
  survey: SurveyModel,
): Promise<z.infer<typeof MergedS>> {
  const system = `You merge frame-by-frame observations from a walkthrough video into one list of physical components for a Method 21 inventory.
The same component is usually seen in several consecutive frames; merge those. Two similar items in the same room (two faucets, hot and cold supply valves) are separate components.

Survey areas (box on the survey image, normalized 0..1):
${survey.areas.map((a) => `${a.id} ${a.name}: x ${a.box.x.toFixed(2)}, y ${a.box.y.toFixed(2)}, w ${a.box.w.toFixed(2)}, h ${a.box.h.toFixed(2)}`).join('\n')}
Reference points:
${survey.referencePoints.map((r) => `${r.id} ${r.name} in ${r.areaId} at ${r.at.x.toFixed(2)},${r.at.y.toFixed(2)}`).join('\n')}

For each component:
- key: short unique slug.
- parentKey: the key of the component it is physically part of, so connectors sit under their valve or appliance (supply line connectors under the shutoff valve). Null for top-level items.
- plan: its estimated position on the survey image, inside its area's box and near its reference point.
- locationDescription: the clearest description from its observations; rewrite so that no two components share a description.
- observationIds: every observation merged into it.
- confidence: combine the observations; lower it where they disagree on type.`;
  return structured(MergedS, system, [{ type: 'text', text: JSON.stringify(observations) }], 'high');
}

// ---------- Ask the record ----------

export async function askRecord(question: string, inventory: unknown): Promise<string> {
  const res = await api().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: 'You answer questions about one Method 21 component inventory, given as JSON. Answer in two to four plain sentences, cite tags or route IDs, and say plainly when the inventory does not hold the answer. The data is a house used as stand-in for a facility; the rules are federal values for orientation only.',
    messages: [{ role: 'user', content: `Inventory:\n${JSON.stringify(inventory)}\n\nQuestion: ${question}` }],
  });
  if (res.stop_reason === 'refusal') return 'The model declined to answer this question.';
  return res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
}
