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

- **▶ PLAY** — you control the station. Assign trains to platforms, hold or
  priority-clear departures, and advance time minute by minute while honoring
  platform-length, electrification, and single-occupancy safety constraints.
- **🤖 BENCHMARK** — TrainBench renders the current situation as a fixed-width
  prompt for any LLM, scored across five dimensions. Either **copy/paste** the
  model's JSON reply, or **run it live**: enter an OpenAI-compatible or
  Anthropic endpoint URL, token, and model id and TrainBench calls the model
  from the browser and scores the reply automatically (a per-session run
  history compares models). The endpoint must allow cross-origin (CORS) browser
  requests; the API key is stored only in your browser's localStorage.

## The live track yard

The centerpiece is an animated track yard: an approach throat on the left,
platform roads (twin rails, sleepers, signal lights) in the middle, and a
departure throat on the right. Each train is a card that slides from the
approach yard onto its assigned platform and off to departure as the clock
advances — blocked trains and downed signals are shown in red. In PLAY mode you
can click trains and platforms directly in the yard to route them.

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
