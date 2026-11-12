// Projects live as JSON plus files under data/, which git ignores.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Correction, Project } from '../shared/types';

export const DATA_DIR = path.resolve(process.env.M21_DATA_DIR ?? 'data');
export const projectDir = (id: string) => path.join(DATA_DIR, 'projects', id);

const safeId = (id: string) => {
  if (!/^[a-z0-9-]{6,40}$/.test(id)) throw new Error('Bad project id');
  return id;
};

export async function saveProject(p: Project): Promise<void> {
  const dir = projectDir(safeId(p.id));
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, 'project.json.tmp');
  await writeFile(tmp, JSON.stringify(p, null, 2));
  await rename(tmp, path.join(dir, 'project.json'));
}

export async function loadProject(id: string): Promise<Project | null> {
  const f = path.join(projectDir(safeId(id)), 'project.json');
  if (!existsSync(f)) return null;
  return JSON.parse(await readFile(f, 'utf8')) as Project;
}

export async function listProjects(): Promise<Pick<Project, 'id' | 'name' | 'createdAt' | 'stage' | 'review'>[]> {
  const root = path.join(DATA_DIR, 'projects');
  if (!existsSync(root)) return [];
  const out = [];
  for (const id of await readdir(root)) {
    const p = await loadProject(id).catch(() => null);
    if (p) out.push({ id: p.id, name: p.name, createdAt: p.createdAt, stage: p.stage, review: p.review });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const correctionsFile = () => path.join(DATA_DIR, 'corrections.json');

/** Technician verdicts kept across projects. The newest are fed back to the model as examples. */
export async function loadCorrections(): Promise<Correction[]> {
  if (!existsSync(correctionsFile())) return [];
  return JSON.parse(await readFile(correctionsFile(), 'utf8')) as Correction[];
}

export async function addCorrection(c: Correction): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const all = await loadCorrections();
  all.push(c);
  await writeFile(correctionsFile(), JSON.stringify(all, null, 2));
}
