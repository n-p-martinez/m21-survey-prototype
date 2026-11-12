// Federal leak definitions applied to each component type.
// Orientation only: every value must be checked against the current CFR text before any product commitment.
// `checked` is false where the value comes from memory of the rule rather than a read of the regulation.

import type { LdarType } from './types';

export interface RuleEntry {
  rule: string;               // citation
  leakPpm: number | null;     // instrument reading that is a leak; null where the rule sets no reading
  leakText: string;           // how the rule states it
  frequency: 'monthly' | 'quarterly' | 'annual' | 'none';
  frequencyText: string;
  firstAttemptDays: number | null;
  repairDays: number | null;
  checked: boolean;
}

export const FEDERAL_RULES: Record<LdarType, RuleEntry> = {
  valve: {
    rule: '40 CFR 60.482-7a (NSPS Subpart VVa)',
    leakPpm: 500, leakText: '500 ppm or greater',
    frequency: 'monthly', frequencyText: 'Monthly; quarterly after two clean months',
    firstAttemptDays: 5, repairDays: 15, checked: false,
  },
  pump: {
    rule: '40 CFR 60.482-2a (NSPS Subpart VVa), light liquid',
    leakPpm: 2000, leakText: '2,000 ppm or greater',
    frequency: 'monthly', frequencyText: 'Monthly, plus weekly visual check',
    firstAttemptDays: 5, repairDays: 15, checked: false,
  },
  connector: {
    rule: '40 CFR 60.482-11a (NSPS Subpart VVa)',
    leakPpm: 500, leakText: '500 ppm or greater',
    frequency: 'annual', frequencyText: 'Annual after the initial survey',
    firstAttemptDays: 5, repairDays: 15, checked: false,
  },
  pressure_relief_device: {
    rule: '40 CFR 60.482-4a (NSPS Subpart VVa), gas or vapor service',
    leakPpm: 500, leakText: 'No detectable emissions: under 500 ppm above background',
    frequency: 'none', frequencyText: 'After each pressure release, within 5 days',
    firstAttemptDays: null, repairDays: null, checked: false,
  },
  open_ended_line: {
    rule: '40 CFR 60.482-6a (NSPS Subpart VVa)',
    leakPpm: null, leakText: 'No reading: must be capped, plugged, blind flanged or closed with a second valve',
    frequency: 'none', frequencyText: 'Equipment standard, not monitored',
    firstAttemptDays: null, repairDays: null, checked: false,
  },
  sampling_connection: {
    rule: '40 CFR 60.482-5a (NSPS Subpart VVa)',
    leakPpm: null, leakText: 'No reading: closed-purge, closed-loop or closed-vent system required',
    frequency: 'none', frequencyText: 'Equipment standard, not monitored',
    firstAttemptDays: null, repairDays: null, checked: false,
  },
  compressor: {
    rule: '40 CFR 60.482-3a (NSPS Subpart VVa)',
    leakPpm: null, leakText: 'Seal system with barrier fluid and sensor; sensor alarm is the leak indicator',
    frequency: 'none', frequencyText: 'Daily sensor check',
    firstAttemptDays: 5, repairDays: 15, checked: false,
  },
  agitator: {
    rule: '40 CFR 63.173 (NESHAP Subpart H)',
    leakPpm: 10000, leakText: '10,000 ppm or greater',
    frequency: 'monthly', frequencyText: 'Monthly, plus weekly visual check',
    firstAttemptDays: 5, repairDays: 15, checked: false,
  },
  instrumentation: {
    rule: '40 CFR 63.169 (NESHAP Subpart H)',
    leakPpm: 10000, leakText: 'Monitored within 5 days when a leak is seen, heard or smelled; 10,000 ppm',
    frequency: 'none', frequencyText: 'Sensory check, then monitor on evidence',
    firstAttemptDays: 5, repairDays: 15, checked: false,
  },
};

/** Share of valves allowed to be difficult to monitor at a new process unit, as cited in the 10/28 session. */
export const DTM_VALVE_CAP = 0.03;
