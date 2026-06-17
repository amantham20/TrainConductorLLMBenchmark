# 🚂 TrainBench

A turn-based train station control game that doubles as a **model-agnostic LLM
benchmark**. Play it yourself, or use it to test any LLM (GPT-4o, Claude,
Gemini, Llama, Mistral…): copy the generated prompt, paste it into any model,
paste the JSON response back, and get a score out of 100.

Dark monospace terminal aesthetic — a railway control room. React + Vite, plain
inline styles, no dependencies beyond React.

## Run

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
npm run preview  # preview the production build
```

## Two modes

- **▶ PLAY** — you are the signaller. Throw points to line routes through the
  interlocking, set/release routes, hold or priority-clear departures, and
  advance time minute by minute while honoring platform-length, electrification,
  and single-occupancy (block) safety constraints.
- **🤖 BENCHMARK** — TrainBench renders the current situation as a fixed-width
  prompt for any LLM, scored across five dimensions. Either **copy/paste** the
  model's JSON reply, or **run it live**: enter an OpenAI-compatible or
  Anthropic endpoint URL, token, and model id and TrainBench calls the model
  from the browser and scores the reply automatically (a per-session run
  history compares models). The endpoint must allow cross-origin (CORS) browser
  requests; the API key is stored only in your browser's localStorage.

## The interlocking yard

The centerpiece is a working signalling interlocking, not just a map. The throat
is drawn as a real **ladder of points (turnouts)** descending from the approach,
with platform roads branching off, track **blocks** coloured by occupancy
(red = occupied, green = a set route, dark = clear), and **signals** at the
approach, each platform entry, and each starting (departure) end.

In PLAY mode you operate it like a signaller:

1. **Select a train** (click it in the yard or the train table).
2. **Line a route** — throw points **N/R** in the yard (the first point set to
   REVERSE peels the route off the ladder onto its platform), or click a
   platform to line the whole path at once. The header shows where the points
   currently lead.
3. **SET ROUTE** in the signal box — this *locks* the points, reserves the
   platform block, and clears the signal. The train then runs down the ladder
   and berths; clearing the throat releases the points for the next move.

The interlocking enforces realistic rules: a held train will not move until its
route is set, points **lock** under a set route (you must RELEASE to re-line),
you cannot line a route through points another route already holds, and routing
into an occupied block is a conflict (a safety penalty). HOLD / PRIORITY CLEAR
regulate delays; ADVANCE steps the clock one minute.

## Scenarios

| Scenario | City | Difficulty | The decision |
|----------|------|-----------|--------------|
| **Stockholm Central** | Sweden | EASY | Two intercity services + a delayed local converging on overlapping platform windows; one bay platform is short. |
| **Frankfurt Hbf** | Germany | MEDIUM | A late ICE forces a connection-vs-cascade trade-off — hold the train with the largest connecting-passenger ROI, let the rest go. |
| **Penn Station** | USA | HARD | A blocked platform during rush hour; waterfall four inbound trains onto free platforms without a conflict. |
| **Clapham Junction** | UK | EXPERT | A signal failure strands two packed trains; route inbound services while signals restore on a schedule. |

## Scoring

**PLAY** (live, out of 100): Safety (40, −15 per conflict), Efficiency (40,
by departure lateness), Throughput (20, fraction of trains departed).

**BENCHMARK** (LLM response, out of 100): Format (15), Safety (35), Decision
Quality (35, vs. a reference solution), Reasoning (10), Risk Assessment (5).
Graded S / A / B / C / D / F.

## Structure

```
index.html
vite.config.js
package.json
src/
  main.jsx
  App.jsx         # entire app: engine, prompt generator, scorer, UI
  scenarios.js    # the four scenario definitions
```
