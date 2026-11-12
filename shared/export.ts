// CSV export of the inventory and routes. Columns are Onterris's own layout until a Skybridge sample arrives.

import { FEDERAL_RULES } from './rules';
import { LDAR_TYPE_LABEL, type Project } from './types';

export const CSV_COLUMNS = [
  'Tag', 'Route', 'Route sequence', 'Route frequency', 'Component type', 'Size (in)', 'Equipment ID', 'Equipment name',
  'Area', 'Reference point', 'Location description', 'Parent tag', 'Rule', 'Leak definition', 'Leak ppm',
  'Monitoring frequency', 'First attempt (days)', 'Repair (days)', 'Difficult to monitor', 'Unsafe to monitor',
  'Video time (s)', 'AI confidence', 'Review status', 'Verified by', 'Stand-in for',
] as const;

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(p: Project): string {
  const area = (id: string) => p.survey?.areas.find((a) => a.id === id)?.name ?? id;
  const ref = (id: string | null) => (id ? p.survey?.referencePoints.find((r) => r.id === id)?.name ?? id : '');
  const route = (id: string | null) => p.routes.find((r) => r.id === id);
  const rows = [...p.components]
    .filter((c) => c.status !== 'rejected')
    .sort((a, b) => (a.routeId ?? '').localeCompare(b.routeId ?? '') || (a.routeSeq ?? 0) - (b.routeSeq ?? 0))
    .map((c) => {
      const rule = { ...FEDERAL_RULES[c.type], ...(p.ruleOverrides[c.type] ?? {}) };
      return [
        c.tag, c.routeId, c.routeSeq, route(c.routeId)?.frequency, LDAR_TYPE_LABEL[c.type], c.sizeInches, c.equipmentId, c.equipmentName,
        area(c.areaId), ref(c.referenceId), c.locationDescription, c.parentTag, rule.rule, rule.leakText, rule.leakPpm,
        rule.frequencyText, rule.firstAttemptDays, rule.repairDays, c.difficultToMonitor ? 'Y' : 'N', c.unsafeToMonitor ? 'Y' : 'N',
        c.sightings[0]?.t.toFixed(1), Math.round(c.confidence * 100) + '%', c.status, c.verifiedBy, c.householdName,
      ].map(cell).join(',');
    });
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}
