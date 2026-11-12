// Frame sampling with ffmpeg. Short clips get a frame every 2 seconds; long videos are spread evenly
// across the whole length up to M21_MAX_FRAMES, so a 40 minute walk costs about the same as a 4 minute one.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`${cmd} could not start: ${e.message}. Is ffmpeg installed and on PATH?`)));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} failed: ${err.slice(-400)}`))));
  });

export async function probe(file: string): Promise<{ duration: number; width: number; height: number }> {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
  const j = JSON.parse(out);
  return { duration: Number(j.format?.duration ?? 0), width: j.streams?.[0]?.width ?? 0, height: j.streams?.[0]?.height ?? 0 };
}

export function frameInterval(duration: number, maxFrames: number): number {
  return Math.max(2, duration / maxFrames);
}

/** The times a run samples: every 2 seconds, or spread evenly across a long video. Shared by live runs and recorded analyses. */
export function frameTimes(duration: number, maxFrames: number): number[] {
  const step = frameInterval(duration, maxFrames);
  const out: number[] = [];
  for (let t = step / 2; t < duration && out.length < maxFrames; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

/** Pull one frame at each given time. Exact times keep a recorded analysis valid across ffmpeg versions. */
export async function extractFramesAt(file: string, outDir: string, times: number[]): Promise<{ file: string; t: number }[]> {
  await mkdir(outDir, { recursive: true });
  const out: { file: string; t: number }[] = [];
  for (let i = 0; i < times.length; i++) {
    const name = `f_${String(i + 1).padStart(4, '0')}.jpg`;
    await run('ffmpeg', ['-v', 'error', '-ss', times[i].toFixed(2), '-i', file, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '4', '-y', path.join(outDir, name)]);
    out.push({ file: `frames/${name}`, t: times[i] });
  }
  return out;
}
