// Prepare a video for an analysis made outside the app: hash it, choose the frame times a live run
// would use, and pull those frames. Usage: npx tsx scripts/prepare-analysis.ts <video> <outDir> [maxFrames]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256File } from '../server/replay';
import { extractFramesAt, frameTimes, probe } from '../server/video';

const [video, out, max] = process.argv.slice(2);
if (!video || !out) { console.error('Usage: npx tsx scripts/prepare-analysis.ts <video> <outDir> [maxFrames]'); process.exit(1); }
const meta = await probe(video);
const times = frameTimes(meta.duration, Number(max ?? 120));
const frames = await extractFramesAt(video, path.join(out, 'frames'), times);
const prep = { sha256: await sha256File(video), duration: meta.duration, width: meta.width, height: meta.height, frameTimes: times, batches: Math.ceil(frames.length / 8) };
await writeFile(path.join(out, 'prep.json'), JSON.stringify(prep, null, 2));
console.log(`${frames.length} frames in ${prep.batches} batches written to ${out}`);
