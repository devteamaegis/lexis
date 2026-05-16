# Lexis — Literature EXploration Intelligence System

> **JacHacks Spring 2026 Submission** · Agentic AI Track  
> A Jac-native research gap detection engine that autonomously maps the biomedical literature landscape

---

## What it does

Lexis is an agentic AI system that turns a one-line biomedical research question into a living knowledge graph. Given a query like *"AMD early detection retinal imaging"*, Lexis:

1. **Fetches** 25 real papers from PubMed via NCBI eUtils
2. **Extracts** semantic topics from every abstract using `by llm()` in parallel
3. **Detects research gaps** — topics with sparse coverage that represent unexplored territory
4. **Synthesizes** a structured literature review across all papers
5. **Explains connections** between any two papers via AI hover summaries
6. Renders everything as an **interactive force-directed knowledge graph**

The entire pipeline is Jac-native: walkers traverse the graph, nodes model the domain, and `by llm()` powers all AI reasoning.

---

## Jac Architecture

Lexis is built on Jac's core primitives:

### Graph-Native Data Modeling
```jac
node Paper {
    has pmid: str;
    has title: str;
    has abstract: str = "";
    has year: int = 0;
    has authors: list[str] = [];
    has citation_count: int = 0;
}

node Topic { has keyword: str; has paper_count: int = 0; }

node ResearchGap {
    has description: str;
    has confidence: float;
    has suggested_direction: str;
    has adjacent_pmids: list[str] = [];
}

edge Cites {}
edge HasTopic {}
edge NearGap {}
```

### Meaning Typed Programming (`by llm()`)
```jac
glob llm = Model(model_name="anthropic/claude-haiku-4-5");

"""Extract 3–5 concise topic keywords from a biomedical abstract.
Return ONLY a JSON array of lowercase strings."""
def extract_topics(abstract: str) -> list[str] by llm();

"""Identify whether a genuine research gap exists for this topic.
Return ONLY valid JSON: {is_gap, description, confidence, suggested_direction}"""
def detect_gap(topic: str, nearby_abstracts: list[str]) -> str by llm();

"""Write a 3–4 sentence structured literature synthesis."""
def synthesize_review(question: str, titles: list[str]) -> str by llm();

"""Explain in 1–2 sentences the scientific connection between two papers."""
def connection_summary(title_a: str, abstract_a: str, title_b: str, abstract_b: str) -> str by llm();
```

### Walkers (Agentic Graph Traversal)
```jac
walker ResearchWalker {
    has query: str;
    has max_papers: int = 25;

    can start with entry {
        sess = Session(query=self.query, created_at=str(datetime.now().isoformat()));
        here ++> sess;                          # attach session to root
        
        pmids = fetch_papers(self.query, max_results=self.max_papers);
        records = fetch_abstracts(pmids);
        
        # Build Paper nodes + connect to session graph
        for rec in records {
            p = Paper(pmid=rec["pmid"], title=rec["title"], ...);
            sess ++> p;                         # graph edge: session → paper
        }
        
        # LLM topic extraction → Topic nodes → HasTopic edges
        # Gap detection → ResearchGap nodes → NearGap edges
        # Synthesis → final report
    }
}

walker:pub RunQuery { ... }         # REST: POST /walker/RunQuery
walker:pub GetGraph { ... }         # REST: GET  /walker/GetGraph
walker:pub ConnectionSummary { ... } # REST: POST /walker/ConnectionSummary
```

### Graph Structure
```
root
 └──> Session
        ├──> Paper ──[HasTopic]──> Topic
        ├──> Paper ──[HasTopic]──> Topic
        ├──> Paper ──[Cites]────> Paper
        └──> ResearchGap ──[NearGap]──> Paper
```

---

## Features

| Feature | How it works |
|---------|-------------|
| **Autonomous literature search** | Walker fetches 25 real PubMed papers per query |
| **AI topic extraction** | `extract_topics()` via `by llm()` — parallel across all papers |
| **Research gap detection** | `detect_gap()` via `by llm()` — finds under-explored topic clusters |
| **Literature synthesis** | `synthesize_review()` via `by llm()` — 3–4 sentence structured summary |
| **Edge AI summaries** | Hover any connection → Claude explains the scientific link |
| **Voice interface** | Speak queries using Web Speech API |
| **Year filter** | Slider filters papers by publication year |
| **Sensitivity control** | Adjustable gap detection threshold (Loose / Balanced / Strict) |
| **Node expansion** | Click any paper → expand its citation network |
| **Export** | Download full report as Markdown or JSON |

---

## Graph Visualization

- 🟣 **Purple nodes** = Papers (size = citation count)
- 🟢 **Teal nodes** = Semantic Topics (extracted by LLM)
- ⚪ **White pulsing nodes** = Research Gaps (unexplored areas)
- **Amber lines** = Citation edges (paper cites paper)
- **Teal dashed lines** = Topic membership edges
- **White dashed lines** = Gap adjacency edges
- **Hover any edge** → AI explains the connection in real-time

---

## Setup

### Requirements
- Python 3.10+
- Node.js 18+
- An Anthropic API key

### Install
```bash
# Backend
cd lexis/
pip install -r requirements.txt

# Frontend
cd frontend/
npm install
```

### Configure
```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### Run
```bash
chmod +x start.sh
./start.sh
```

Opens at **http://localhost:5173**

### Run with Jac directly (for demos)
```bash
# Verify Jac syntax
jac check lexis.jac

# Run the Jac backend standalone
jac start lexis.jac --port 8001
```

---

## Project Structure

```
lexis/
├── lexis.jac          # Jac walker definitions, byLLM functions, graph nodes/edges
├── jac.toml           # Jac project config (byllm plugin, model settings)
├── server.py          # FastAPI backend — WebSocket streaming, parallel LLM calls
├── lexis_pubmed.py    # PubMed eUtils API client (fetch papers + abstracts)
├── lexis_enrich.py    # Semantic similarity edge computation (TF-IDF embeddings)
├── start.sh           # One-command launcher (backend + frontend)
├── requirements.txt
└── frontend/
    └── src/
        ├── App.jsx         # Main app, force-directed graph, WebSocket
        ├── NodePopup.jsx   # Paper/topic/gap detail card
        ├── RightPanel.jsx  # Synthesis, gaps list, paper table
        ├── VoiceAgent.jsx  # Speech-to-query interface
        └── StarfieldCanvas.jsx  # Animated space background
```

---

## Jac Features Used

| Jac Feature | Usage in Lexis |
|-------------|---------------|
| `node` definitions | `Paper`, `Topic`, `ResearchGap`, `Session` |
| `edge` definitions | `Cites`, `HasTopic`, `NearGap` |
| `walker` definitions | `ResearchWalker`, `RunQuery`, `GetGraph`, `ConnectionSummary` |
| `by llm()` (Meaning Typed Programming) | 4 AI functions — topic extraction, gap detection, synthesis, connection summary |
| `walker:pub` REST endpoints | 3 public walkers exposed as HTTP endpoints via `jac start` |
| Graph traversal syntax | `here ++> node`, `[sess --> ][?:Paper]`, `p +>:HasTopic:+> t` |
| `report` statements | Streaming event emission from walkers |
| `disengage` | Early exit on empty results |
| `glob` model variable | Shared LLM model instance |

---

## Track

**Agentic AI** — Lexis demonstrates genuine agent behavior:
- **Multi-step planning**: fetch → extract → detect gaps → synthesize (fully autonomous pipeline)
- **Tool use**: PubMed API, Semantic Scholar citation counts, Claude LLM
- **Memory**: Session graph persists across walker invocations; graph structure *is* the memory
- **Reasoning**: Gap detection evaluates each sparse topic cluster and returns confidence scores

---

## Team

Built for JacHacks Spring 2026 · Cornell University
