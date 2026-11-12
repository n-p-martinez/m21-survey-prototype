// Package one finished project as a static page for claude.ai: scripts and styles inlined, the project JSON,
// survey image, frames and video copied beside it. Usage:
//   npx tsx scripts/build-static.ts <projectDir> <outDir>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Project } from '../shared/types';

const [projectDir, outDir] = process.argv.slice(2);
if (!projectDir || !outDir) { console.error('Usage: npx tsx scripts/build-static.ts <projectDir> <outDir>'); process.exit(1); }

const p = JSON.parse(readFileSync(path.join(projectDir, 'project.json'), 'utf8')) as Project;
if (p.stage !== 'ready') throw new Error(`Project is at stage ${p.stage}, not ready.`);

const build = path.join(outDir, '.vite');
rmSync(outDir, { recursive: true, force: true });
execFileSync('npx', ['vite', 'build', '--base', './', '--outDir', path.resolve(build), '--emptyOutDir'], { stdio: 'inherit' });

const html = readFileSync(path.join(build, 'index.html'), 'utf8');
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"/g)].map((m) => readFileSync(path.join(build, m[1]), 'utf8'));
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map((m) => readFileSync(path.join(build, m[1]), 'utf8'));

const page = `<title>M21 Survey</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap">
<style>${css.join('\n')}
body{padding-left:max(0px, env(safe-area-inset-left, 0px));padding-right:max(0px, env(safe-area-inset-right, 0px));}</style>
<script id="m21-static" type="application/json" data-src="project.json">{}</script>
<div id="root"></div>
<script type="module">${js.join('\n').replace(/<\/script/gi, '<\\/script')}</script>
`;
mkdirSync(path.join(outDir, 'files', 'frames'), { recursive: true });
writeFileSync(path.join(outDir, 'index.html'), page);
writeFileSync(path.join(outDir, 'project.json'), JSON.stringify(p));
cpSync(path.join(projectDir, p.survey!.pageImage), path.join(outDir, 'files', p.survey!.pageImage));
for (const f of p.frames) cpSync(path.join(projectDir, f.file), path.join(outDir, 'files', f.file));
const video = path.join(projectDir, p.video!.file);
if (existsSync(video)) {
  const mb = statSync(video).size / 1024 / 1024;
  if (mb <= 15) cpSync(video, path.join(outDir, 'files', p.video!.file));
  else console.warn(`Video is ${mb.toFixed(1)} MB; over the 15 MB per-file limit. Re-encode it smaller with ffmpeg before packaging.`);
}
rmSync(build, { recursive: true, force: true });
const files = readdirSync(path.join(outDir, 'files', 'frames')).length;
console.log(`Static page in ${outDir}: index.html, project.json, survey image, ${files} frames${existsSync(path.join(outDir, 'files', p.video!.file)) ? ', video' : ''}.`);
