// Shared data model for the server and the web app.

export const LDAR_TYPES = [
  'valve',
  'connector',
  'pump',
  'compressor',
  'agitator',
  'pressure_relief_device',
  'sampling_connection',
  'open_ended_line',
  'instrumentation',
] as const;
export type LdarType = (typeof LDAR_TYPES)[number];

export const LDAR_TYPE_LABEL: Record<LdarType, string> = {
  valve: 'Valve',
  connector: 'Connector',
  pump: 'Pump',
  compressor: 'Compressor',
  agitator: 'Agitator',
  pressure_relief_device: 'Pressure relief device',
  sampling_connection: 'Sampling connection',
  open_ended_line: 'Open-ended line',
  instrumentation: 'Instrumentation',
};

/** Normalized box on an image: 0..1 from the top-left corner. */
export interface Box { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

export interface Area {
  id: string;            // short code, e.g. KIT
  name: string;          // dummy label shown in the app, e.g. "Area 1, kitchen"
  box: Box;              // on the survey page image
}

export interface ReferencePoint {
  id: string;            // e.g. REF-03
  name: string;          // e.g. "Refrigerator"
  areaId: string;
  at: Point;             // on the survey page image
}

export interface SurveyModel {
  pageImage: string;     // file name under the project folder
  pageWidth: number;
  pageHeight: number;
  areas: Area[];
  referencePoints: ReferencePoint[];
  entry: Point;
  redactions: Box[];     // personal details hidden in the app
  notes: string;
}

export interface Frame { file: string; t: number }

export interface Sighting {
  t: number;             // seconds into the video
  frame: string;
  box: Box;              // on the frame
}

export type ReviewStatus = 'proposed' | 'confirmed' | 'corrected' | 'rejected';

export interface Component {
  id: string;            // stable internal id
  tag: string;           // e.g. 100.1
  equipmentId: string;   // e.g. V-101
  equipmentName: string; // e.g. "Kitchen sink supply valve, cold"
  householdName: string; // what it really is, kept for the dummy-data label
  type: LdarType;
  sizeInches: number | null;
  areaId: string;
  referenceId: string | null;
  locationDescription: string;
  parentTag: string | null;
  plan: Point;           // pin on the survey page image
  sightings: Sighting[];
  confidence: number;    // 0..1, the AI's own rating
  confidenceNote: string;
  difficultToMonitor: boolean;
  unsafeToMonitor: boolean;
  status: ReviewStatus;
  verifiedBy: string | null;
  routeId: string | null;
  routeSeq: number | null;
}

export interface Route {
  id: string;            // e.g. KIT-Q-01
  name: string;          // e.g. "Kitchen and laundry"
  frequency: 'monthly' | 'quarterly' | 'annual';
  componentIds: string[];
}

export interface ChangeEntry {
  at: string;            // ISO time
  who: string;           // role, not a person
  what: string;
}

export type ProjectStage = 'uploaded' | 'survey' | 'frames' | 'detect' | 'consolidate' | 'build' | 'ready' | 'error';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  stage: ProjectStage;
  progress: { step: string; done: number; total: number; message: string };
  error: string | null;
  video: { file: string; duration: number; width: number; height: number } | null;
  survey: SurveyModel | null;
  frames: Frame[];
  /** People, mail, screens or house numbers seen in a frame; blurred in the app. */
  privacy: { frame: number; box: Box }[];
  components: Component[];
  routes: Route[];
  review: 'draft' | 'in_review' | 'approved';
  log: ChangeEntry[];
  routeCapacity: number;
  /** Set when the analysis was replayed from a recorded file instead of run live. */
  replay: { ranAt: string; ranBy: string; note: string } | null;
  ruleOverrides: Partial<Record<LdarType, { leakPpm?: number | null; frequency?: string }>>;
}

/** A technician's verdict on one AI proposal. Stored across projects and fed back as examples. */
export interface Correction {
  at: string;
  householdName: string;
  proposedType: LdarType;
  finalType: LdarType;
  proposedConfidence: number;
  verdict: 'confirmed' | 'corrected' | 'rejected';
  note: string;
}
