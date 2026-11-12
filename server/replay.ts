// A recorded analysis: the same three AI steps as a live run, captured as JSON so the app can
// replay them without an API key. The app labels every replay with when and how it was made.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { MergedS, ObservationsS, SurveyS } from './ai';

export const AnalysisFileS = z.object({
  format: z.literal('m21-analysis/1'),
  ranAt: z.string(),          // ISO date the analysis was run
  ranBy: z.string(),          // e.g. "Claude (claude-opus-5-5) in a Claude Code session"
  note: z.string(),
  video: z.object({ sha256: z.string(), duration: z.number() }),
  frameTimes: z.array(z.number()),  // seconds; frames are pulled at exactly these times
  survey: SurveyS,
  batches: z.array(ObservationsS), // one per 8-frame batch, in order
  merged: MergedS,
});
export type AnalysisFile = z.infer<typeof AnalysisFileS>;

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

export function parseAnalysis(text: string): AnalysisFile {
  const r = AnalysisFileS.safeParse(JSON.parse(text));
  if (!r.success) throw new Error(`The analysis file is not in the expected format: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  return r.data;
}
