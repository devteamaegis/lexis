# Devpost Submission — Copy-paste this into each field

---

## Project Name
Lexis — Literature EXploration Intelligence System

## Tagline (one line)
An agentic AI system that autonomously maps biomedical research landscapes and detects unexplored gaps using Jac walkers and by llm().

## Track
**Agentic AI** (primary)

---

## What it does

Lexis is a research gap detection engine. Give it any biomedical research question — like "AMD early detection retinal imaging" — and it runs a fully autonomous multi-step pipeline:

1. Fetches 25 real papers from PubMed via NCBI eUtils
2. Extracts 3–5 semantic topic keywords from every abstract using `by llm()`
3. Builds a live knowledge graph: Paper nodes, Topic nodes, and Citation edges
4. Detects research gaps — sparse topic clusters where the literature hasn't gone yet — using a second `by llm()` call per candidate
5. Generates a structured literature synthesis across all 25 papers
6. Explains any connection between two papers with a hover-triggered AI summary

The result is a living, interactive knowledge graph that shows you not just what has been published, but where science hasn't looked yet.

---

## How I built it

**The Jac layer (lexis.jac)** defines the entire agentic architecture:

```jac
glob llm = Model(model_name="anthropic/claude-haiku-4-5");

def extract_topics(abstract: str) -> list[str] by llm();
def detect_gap(topic: str, nearby_abstracts: list[str]) -> str by llm();
def synthesize_review(question: str, titles: list[str]) -> str by llm();
def connection_summary(title_a: str, abstract_a: str, title_b: str, abstract_b: str) -> str by llm();

walker ResearchWalker {
    has query: str;
    has max_papers: int = 25;
    can start with entry { ... }
}

walker:pub RunQuery { ... }
walker:pub GetGraph { ... }
walker:pub ConnectionSummary { ... }
```

Every AI call in Lexis is a `by llm()` Meaning Typed function — Jac's most distinctive feature. The graph structure (Papers, Topics, ResearchGaps, and their edges) is modeled natively in Jac with typed `node` and `edge` definitions.

**The Python backend (server.py)** wraps the Jac engine, adds WebSocket streaming so the graph builds in real-time as events arrive, runs topic extraction in parallel (8-worker ThreadPoolExecutor, 5× faster), and exposes the `/edge-summary` endpoint for hover tooltips.

**The frontend (React + react-force-graph-2d)** renders the knowledge graph as an interactive force-directed visualization with custom canvas drawing for each node type, flowing particle animations on citation edges, AI hover tooltips on connections, year-range filtering, sensitivity controls, a voice query interface, and Markdown/JSON export.

---

## Jac and Jaseci Features Used

| Feature | How Lexis uses it |
|---------|------------------|
| `node` definitions | `Paper`, `Topic`, `ResearchGap`, `Session` — the entire knowledge graph lives in Jac |
| `edge` definitions | `Cites`, `HasTopic`, `NearGap` — typed relationships between entities |
| `walker` definitions | `ResearchWalker` (pipeline), `RunQuery`, `GetGraph`, `ConnectionSummary` |
| `by llm()` (Meaning Typed Programming) | 4 AI functions — topic extraction, gap detection, literature synthesis, connection explanation |
| `walker:pub` | 3 public HTTP endpoints auto-exposed by `jac start` |
| Graph traversal | `here ++> sess`, `sess ++> p`, `p +>:HasTopic:+> t`, `[sess --> ][?:Paper]` |
| `report` | Streaming event emission from walkers to the frontend |
| `disengage` | Early exit on empty result sets |
| `glob` model | Shared LLM model instance across all `by llm()` calls |

---

## Challenges I ran into

**Jac 0.14.1 syntax compatibility** — Several constructs had breaking changes from earlier versions: `with root entry` needed to become `with entry`, backtick filter syntax changed to `[?:NodeType]`, and tuple unpacking in for loops isn't supported so `for kw, v in dict.items()` had to become explicit indexed access. I worked through each error systematically until `jac check lexis.jac` passed clean.

**PubMed rarely includes reference lists in XML** — Most papers come back without references, so Cites edges between papers are sparse. The knowledge graph is actually held together by HasTopic edges (paper → shared semantic topic) rather than direct citations, which turns out to be richer anyway — it surfaces thematic connections that citation graphs miss.

**Force simulation collapse** — With 150+ nodes, d3-force's defaults (charge: -30, link distance: 30px) caused everything to collapse into a single point. The fix was pre-assigning golden-angle spiral positions to each node when it arrives and tuning charge to -260 with longer link distances, so the simulation starts from a spread layout and fine-tunes rather than fighting from origin.

**Speed** — 25 sequential LLM calls for topic extraction took ~50 seconds. Parallelizing with `ThreadPoolExecutor(max_workers=8)` cut it to ~10 seconds.

---

## Accomplishments I'm proud of

- `jac check lexis.jac` passes — the Jac code is real, not decorative
- The gap detection is genuinely useful — tested on AMD, CRISPR, drug resistance queries and the identified gaps match known literature holes
- The hover AI summaries work end-to-end: hovering a connection fires a Claude call and explains the scientific link in 1–2 sentences
- The graph builds in real-time as events stream over WebSocket — you watch the knowledge network assemble itself

---

## What I learned

`by llm()` is genuinely powerful for this kind of problem. Instead of writing prompt engineering scaffolding for each AI call, I write a docstring describing the expected behavior and the return type, and Jac handles the rest. The `def detect_gap(...) -> str by llm()` function is 3 lines of Jac but encodes a nuanced scientific judgment task.

Graph-native data modeling made the knowledge structure natural. `Paper --[HasTopic]--> Topic <--[NearGap]-- ResearchGap` reads exactly like the domain model, not a database schema.

---

## What's next

- Add persistent memory across sessions (store sessions in Jac's object storage so you can compare queries over time)
- Expand to arXiv, bioRxiv, and ClinicalTrials.gov for non-PubMed sources
- Add a "Recommended Questions" walker that suggests follow-up queries based on the detected gaps
- Multi-agent version: one walker per topic cluster, coordinating to triangulate gaps in parallel

---

## GitHub
https://github.com/devteamaegis/lexis

## Demo Video
[3-minute demo — link after recording]

---

## Built with
Jac · byLLM · FastAPI · React · react-force-graph-2d · Anthropic Claude Haiku · PubMed eUtils · Semantic Scholar API · WebSocket
