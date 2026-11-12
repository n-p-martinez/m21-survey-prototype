// Frame sampling with ffmpeg. Short clips get a frame every 2 seconds; long videos are spread evenly
// across the whole length up to M21_MAX_FRAMES, so a 40 minute walk costs the same as a 4 minute one.

import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
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

export async function extractFrames(file: string, outDir: string, duration: number, maxFrames: number): Promise<{ file: string; t: number }[]> {
  await mkdir(outDir, { recursive: true });
  const step = frameInterval(duration, maxFrames);
  // Damaged stretches are skipped instead of stopping the run, as with the 11/03 recording.
  await run('ffmpeg', ['-v', 'error', '-err_detect', 'ignore_err', '-fflags', '+discardcorrupt', '-i', file,
    '-vf', `fps=1/${step.toFixed(3)},scale='min(1280,iw)':-2`, '-q:v', '4', '-y', path.join(outDir, 'f_%04d.jpg')]);
  const files = (await readdir(outDir)).filter((f) => f.startsWith('f_')).sort();
  return files.map((f, i) => ({ file: `frames/${f}`, t: Math.min(duration, i * step + step / 2) }));
}
