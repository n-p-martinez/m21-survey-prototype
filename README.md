# M21 survey prototype

Method 21 in Unicorn, prototype. Give it a site drawing (PDF) and a walkthrough video. It proposes every leak detection and repair (LDAR) component it can see, gives each a tag, an equipment ID and a location, builds the ideal route, and hands it to people to review, adjust, print and export.

**Stand-in data.** The first demo uses a house survey and a video of the house, with household items treated as LDAR components (a faucet is a valve, the water heater's relief valve is a pressure relief device). Personal details on the drawing and in the video are hidden by the app. Federal rule values are orientation only and have not been checked against the current Code of Federal Regulations (CFR) text.

## Run it on a laptop

You need Node.js 20 or later and ffmpeg on your PATH (on Windows: `winget install --id Gyan.FFmpeg -e`).

```
npm install
copy .env.example .env      # macOS or Linux: cp .env.example .env
# put your Claude API key in .env as ANTHROPIC_API_KEY=...
npm run dev
```

Open http://localhost:5173. To run the built version on one port instead: `npm start`, then http://localhost:8787.

### Without an API key: replay a prepared analysis

If you cannot get a Claude API key, the analysis can be run elsewhere and replayed:

1. Run `npm run prepare-analysis -- <video> <outDir>`. It hashes the video, picks the frame times a live run would use and pulls those frames.
2. The analysis (the survey reading, one detection result per 8-frame batch, and the merge) is written to an `analysis.json` in the format `server/replay.ts` checks.
3. In the app, add that file under **Prepared analysis** next to the same survey and video. The app checks the video matches, pulls the same frames, and replays each step in order with a banner saying when and by whom the analysis was run.

Everything from review onward is live. Ask the record needs a key and is off without one.

### As a claude.ai page

`npm run build-static -- data/projects/<id> <outDir>` packages one finished project as a static page: the app with its scripts inlined, plus the project JSON, survey image, frames and the video (if 15 MB or less). Published as a claude.ai artifact, it opens in any browser with no install. Review, routes, checks, the rule test area, the route sheet and the CSV work in the page; changes are kept in that browser only. Uploading a new survey and Ask the record need the server.

Survey drawings, videos, frames and every AI result are written to `data/`, which git ignores. Delete that folder to start clean.

## What it does

| Step | How |
|---|---|
| Read the survey | Claude reads the PDF and page image: rooms become areas, large fixtures become reference points, the entry is found, and personal details are boxed and hidden. |
| Sample the video | ffmpeg pulls a frame every 2 seconds, or spreads `M21_MAX_FRAMES` (default 120) evenly across a long video. Damaged stretches are skipped. |
| Find components | Frames go to Claude 8 at a time. Each sighting gets an LDAR type, an equipment name, a size, a location written outward from the component to a landmark, a box on the frame, a confidence and a note on what would raise it. People, mail and screens are boxed for blurring. |
| Merge | Sightings of the same physical component are merged, connectors are placed under their valve or appliance, and each component is pinned on the survey. |
| Build | No AI: equipment IDs (V-101 is the first valve in area 1), tags in walk order with decimal children (100, 100.1), and the ideal route (areas walked as a loop from the entry, components followed outward, split at the route size, difficult or unsafe components on their own annual route). |
| Review | A technician confirms, corrects or rejects each proposal. A running meter shows how often the AI was right. Every verdict is stored in `data/corrections.json` and sent to the model as an example on the next survey. That is learning from examples, not retraining. |
| Routes | A project manager drags to reorder or move components, splits, merges, renames and sets frequency. Every change is logged by role. |
| Checks | Unique location descriptions, the difficult-to-monitor valve cap, unverified and low-confidence proposals, unrouted components, route size. |
| Rule test area | Change a leak value or frequency per type and see the readings per year before applying it. |
| Ask the record | Plain-language questions about the inventory. |
| Output | A printed route sheet per route (letter, landscape), a CSV and a JSON file. CSV columns are Onterris's own layout until a Skybridge sample arrives. |

Draft, In QA review and Approved into the record track the review stage. Nothing is deleted: a rejected proposal stays in the record, marked rejected.

## Code

| Path | What |
|---|---|
| `shared/types.ts` | The data model |
| `shared/build.ts` | Equipment IDs, tags, route building, checks. Tested in `shared/build.test.ts` (`npm test`). |
| `shared/rules.ts` | Federal leak definitions per component type, with citations, all marked unchecked |
| `shared/export.ts` | CSV export |
| `server/ai.ts` | Every Claude call, each with a Zod schema for its JSON. Model `claude-opus-5-5` (override with `M21_MODEL`), server-side fallbacks on. |
| `server/pipeline.ts` | Upload to proposed inventory |
| `server/video.ts` | ffmpeg frame sampling |
| `server/index.ts` | The HTTP API |
| `web/` | The React app, in the Onterris design system's colors and type |
| `docs/large-facilities.md` | How this scales from one plot plan to a facility drawing set |

## Known limits

* Video playback between sampled frames is not blurred; only the sampled frames' privacy boxes are.
* GPS location checks belong to the field app and are described, not exercised.
* Rule values are from memory of NSPS Subpart VVa and NESHAP Subpart H and need checking against the CFR.
* No sign-in. Roles are picked from the top bar and recorded in the change log.
