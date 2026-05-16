"""
server.py — Lexis backend (pure Python, no jaclang)
Run with:  uvicorn server:app --reload --port 8000
"""

import asyncio
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from urllib.request import urlopen, Request

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from litellm import completion as _llm

from lexis_pubmed import fetch_papers, fetch_abstracts
from lexis_enrich  import compute_semantic_edges

load_dotenv()

# Manual .env fallback — dotenv may fail if the process lacks file-read grants
_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    try:
        with open(_env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    _val = _v.strip()
                    if _val:                          # only overwrite if file has a real value
                        os.environ[_k.strip()] = _val
    except Exception:
        pass


# ─── In-memory session store ───────────────────────────────────────────────────
# Stores per-session state for /expand and /redetect-gaps
_sessions: dict[str, dict] = {}


# ─── LLM helpers ──────────────────────────────────────────────────────────────

def _chat(messages: list[dict], temperature: float = 0) -> str:
    resp = _llm(
        model="claude-haiku-4-5",
        messages=messages,
        temperature=temperature,
        api_key=os.environ.get("ANTHROPIC_API_KEY"),
    )
    return resp.choices[0].message.content.strip()


def _parse_json(raw: str):
    raw = re.sub(r"^```[a-z]*\n?", "", raw.strip(), flags=re.IGNORECASE)
    raw = re.sub(r"\n?```$", "", raw.strip())
    return json.loads(raw.strip())


def extract_topics(abstract: str) -> list[str]:
    raw = _chat([
        {"role": "system", "content":
            'Extract 3–5 concise topic keywords from the biomedical abstract. '
            'Return ONLY a JSON array of lowercase strings, e.g. '
            '["gene therapy", "retinal degeneration"]. No explanation, no markdown.'},
        {"role": "user", "content": abstract[:800]},
    ])
    try:
        parsed = _parse_json(raw)
    except Exception:
        m = re.search(r'\[.*?\]', raw, re.DOTALL)
        parsed = json.loads(m.group()) if m else []
    if isinstance(parsed, list):
        return [str(k).lower().strip() for k in parsed if k]
    for key in ("keywords", "topics", "terms", "results"):
        if key in parsed and isinstance(parsed[key], list):
            return [str(k).lower().strip() for k in parsed[key] if k]
    return []


def detect_gap(topic: str, nearby_abstracts: list[str]) -> dict:
    prompt = (
        f"Topic: {topic}\n\nNearby abstracts:\n" + "\n---\n".join(nearby_abstracts) +
        "\n\nDoes a genuine research gap exist for this topic? "
        "Return ONLY valid JSON: {is_gap, description, confidence, suggested_direction}. "
        "No markdown."
    )
    raw = _chat([{"role": "user", "content": prompt}])
    try:
        return _parse_json(raw)
    except Exception:
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if m:
            return json.loads(m.group())
        raise


def synthesize_review(question: str, titles: list[str]) -> str:
    prompt = (
        f"Research question: {question}\n\nPaper titles:\n" +
        "\n".join(f"- {t}" for t in titles) +
        "\n\nWrite a 3–4 sentence structured literature synthesis. Be specific."
    )
    return _chat([{"role": "user", "content": prompt}], temperature=0.3)


def connection_summary(title_a: str, abstract_a: str, title_b: str, abstract_b: str) -> str:
    prompt = (
        f"Paper A: {title_a}\n{abstract_a[:400]}\n\n"
        f"Paper B: {title_b}\n{abstract_b[:400]}\n\n"
        "Explain in exactly 1–2 sentences the scientific connection between these two papers. "
        "Be specific and concise. No preamble, no 'Paper A' labels."
    )
    return _chat([{"role": "user", "content": prompt}], temperature=0.2)


# ─── Semantic Scholar citation counts ─────────────────────────────────────────

def fetch_citation_counts(pmids: list[str]) -> dict[str, int]:
    if not pmids:
        return {}
    result: dict[str, int] = {}
    for i in range(0, len(pmids), 100):
        chunk = pmids[i:i + 100]
        body  = json.dumps({"ids": [f"PMID:{p}" for p in chunk]}).encode()
        req   = Request(
            "https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,externalIds",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(req, timeout=15) as r:
                data = json.loads(r.read())
            for paper in data:
                if not paper:
                    continue
                ext  = paper.get("externalIds") or {}
                pmid = str(ext.get("PubMed", ""))
                if pmid and "citationCount" in paper:
                    result[pmid] = paper["citationCount"] or 0
        except Exception as e:
            print(f"[lexis] Semantic Scholar chunk {i} failed: {e}")
        if i + 100 < len(pmids):
            time.sleep(0.5)
    return result


# ─── PubMed elink (cited-by) ──────────────────────────────────────────────────

def fetch_citing_pmids(pmid: str) -> list[str]:
    """Use NCBI elink to find papers that cite the given PMID."""
    from urllib.parse import urlencode
    params = urlencode({
        "dbfrom": "pubmed", "db": "pubmed",
        "id": pmid, "linkname": "pubmed_pubmed_citedin",
        "retmode": "json", "tool": "lexis", "email": "lexis@example.com",
    })
    url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?{params}"
    try:
        req = Request(url, headers={"User-Agent": "Lexis/1.0"})
        with urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        links = data.get("linksets", [{}])[0].get("linksetdbs", [{}])[0].get("links", [])
        return [str(l) for l in links]
    except Exception as e:
        print(f"[lexis] elink failed for {pmid}: {e}")
        return []


# ─── Gap detection (standalone, for /redetect-gaps) ──────────────────────────

def run_gap_detection(
    pmid_to_rec: dict[str, dict],
    topic_index: dict[str, list[str]],
    threshold: int = 2,
) -> list[dict]:
    sparse = [(kw, pm) for kw, pm in topic_index.items() if len(pm) <= threshold]

    def _detect_one(kw: str, pmids_for_topic: list[str]) -> dict | None:
        nearby_abstracts = [
            pmid_to_rec[p]["abstract"][:600]
            for p in pmids_for_topic[:2]
            if p in pmid_to_rec and pmid_to_rec[p].get("abstract")
        ]
        if not nearby_abstracts:
            return None
        try:
            result = detect_gap(kw, nearby_abstracts)
        except Exception as e:
            print(f"[lexis] detect_gap failed for '{kw}': {e}")
            return None
        if result.get("is_gap") and float(result.get("confidence", 0)) > 0.6:
            return {"kw": kw, "result": result, "pmids": pmids_for_topic[:2]}
        return None

    # Run gap detection in parallel
    raw_gaps: list[dict] = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(_detect_one, kw, pm): kw for kw, pm in sparse}
        for fut in as_completed(futures):
            val = fut.result()
            if val:
                raw_gaps.append(val)

    # Assign stable IDs (sorted for determinism)
    raw_gaps.sort(key=lambda x: x["kw"])
    events: list[dict] = []
    for i, g in enumerate(raw_gaps, 1):
        gap_id = f"gap_{i}"
        events.append({
            "event": "node", "kind": "ResearchGap", "id": gap_id,
            "description":         g["result"]["description"],
            "confidence":          float(g["result"]["confidence"]),
            "suggested_direction": g["result"]["suggested_direction"],
            "adjacent_pmids":      g["pmids"],
        })
        for pmid in g["pmids"]:
            events.append({"event": "edge", "kind": "NearGap", "src": gap_id, "dst": pmid})

    return events


# ─── Main pipeline (streaming via queue) ──────────────────────────────────────

import queue as _queue_mod

def _pipeline(query: str, max_papers: int, session_id: str = "default",
              out_queue: "_queue_mod.Queue | None" = None) -> list[dict]:
    """
    Runs the full pipeline. If `out_queue` is provided, events are put() there
    as soon as they're produced (for live streaming). Always returns the full
    event list as well.
    """
    events: list[dict] = []

    def emit(ev: dict):
        events.append(ev)
        if out_queue is not None:
            out_queue.put(ev)

    pmids = fetch_papers(query, max_results=max_papers)
    if not pmids:
        emit({"event": "done", "papers": 0, "gaps": 0, "synthesis": ""})
        return events

    # ── Phase 1: fetch abstracts in batches, emit each paper immediately ───────
    print(f"[lexis] Fetching {len(pmids)} papers…")
    records: list[dict] = []
    for i in range(0, len(pmids), 20):
        chunk_pmids = pmids[i:i + 20]
        from lexis_pubmed import fetch_abstracts as _fetch
        chunk = _fetch(chunk_pmids)
        records.extend(chunk)
        for rec in chunk:
            emit({
                "event": "node", "kind": "Paper", "id": rec["pmid"],
                "title":    rec["title"],
                "year":     rec.get("year", 0),
                "authors":  rec.get("authors", []),
                "abstract": rec.get("abstract", ""),
                "journal":  rec.get("journal", ""),
                "citation_count": 0,   # filled in after Semantic Scholar pass
            })
        if i + 20 < len(pmids):
            time.sleep(0.35)

    pmid_to_rec = {r["pmid"]: r for r in records}

    # ── Phase 2: citation counts (bulk, then emit updated paper nodes) ─────────
    print(f"[lexis] Fetching citation counts for {len(records)} papers…")
    citation_counts = fetch_citation_counts([r["pmid"] for r in records])
    for pmid, count in citation_counts.items():
        emit({"event": "patch", "kind": "Paper", "id": pmid, "citation_count": count})

    # ── Phase 3: cites edges ───────────────────────────────────────────────────
    existing_cite_pairs: set[tuple] = set()
    for rec in records:
        for ref in rec.get("references", []):
            if ref in pmid_to_rec:
                existing_cite_pairs.add((rec["pmid"], ref))
                emit({"event": "edge", "kind": "Cites", "src": rec["pmid"], "dst": ref})

    # ── Phase 4: topic extraction — PARALLEL (8 workers → ~5× faster) ───────────
    topic_index: dict[str, list[str]] = {}
    eligible = [r for r in records if r.get("abstract")]
    print(f"[lexis] Extracting topics for {len(eligible)} papers in parallel…")

    def _extract_for(rec: dict) -> tuple[str, list[str]]:
        try:
            kws = extract_topics(rec["abstract"])
            return rec["pmid"], [k.lower().strip() for k in kws if k.strip()]
        except Exception as e:
            print(f"[lexis] extract_topics failed {rec['pmid']}: {e}")
            return rec["pmid"], []

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_extract_for, rec): rec for rec in eligible}
        for fut in as_completed(futures):
            pmid, kws = fut.result()
            print(f"[lexis] {pmid}: {kws}")
            for kw in kws:
                topic_index.setdefault(kw, []).append(pmid)

    # Emit Topic nodes + HasTopic edges (now that paper_count is final)
    for kw, pmids_for_topic in topic_index.items():
        emit({
            "event": "node", "kind": "Topic",
            "id":          "topic_" + kw,
            "keyword":     kw,
            "paper_count": len(pmids_for_topic),
        })
        for pmid in pmids_for_topic:
            emit({"event": "edge", "kind": "HasTopic", "src": pmid, "dst": "topic_" + kw})

    print(f"[lexis] Topics: {len(topic_index)}")

    # ── Phase 5: gap detection ─────────────────────────────────────────────────
    gap_events = run_gap_detection(pmid_to_rec, topic_index, threshold=1)
    gaps_found = 0
    for ev in gap_events:
        emit(ev)
        if ev.get("kind") == "ResearchGap":
            gaps_found += 1
    print(f"[lexis] Gaps: {gaps_found}")

    # ── Phase 6: semantic similarity edges ─────────────────────────────────────
    print("[lexis] Computing semantic edges…")
    try:
        sem_edges = compute_semantic_edges(records, existing_cite_pairs)
        for e in sem_edges:
            emit({"event": "edge", "kind": "Semantic", "src": e["src"], "dst": e["dst"]})
        print(f"[lexis] Semantic edges: {len(sem_edges)}")
    except Exception as e:
        print(f"[lexis] Semantic edge pass failed: {e}")

    # ── Phase 7: synthesis ─────────────────────────────────────────────────────
    all_titles = [r["title"] for r in records[:15] if r.get("title")]
    try:
        synthesis = synthesize_review(query, all_titles)
    except Exception as e:
        print(f"[lexis] synthesis failed: {e}")
        synthesis = "Synthesis unavailable."

    # Save session
    _sessions[session_id] = {
        "query":         query,
        "pmid_to_rec":   pmid_to_rec,
        "topic_index":   topic_index,
        "existing_pmids": set(pmid_to_rec.keys()),
    }

    emit({"event": "done", "gaps": gaps_found, "synthesis": synthesis})
    return events


# ─── WebSocket manager ────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict) -> None:
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


# ─── App ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        print("[lexis] WARNING: ANTHROPIC_API_KEY not set — LLM calls will fail.")
    else:
        print(f"[lexis] Ready. ANTHROPIC_API_KEY loaded ({key[:16]}…)")
    yield


app = FastAPI(title="Lexis API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/graph")
async def get_graph() -> dict:
    return {"nodes": [], "edges": [], "gaps": [], "synthesis": ""}


@app.post("/query")
async def run_query(body: dict) -> dict:
    query      = body.get("query", "").strip()
    max_papers = int(body.get("max_papers", 25))
    session_id = body.get("session_id", "default")
    if not query:
        return {"error": "query is required"}
    asyncio.create_task(_run_walker(query, max_papers, session_id))
    return {"status": "started", "query": query}


async def _run_walker(query: str, max_papers: int, session_id: str = "default") -> None:
    await manager.broadcast({"event": "started", "query": query})
    q: _queue_mod.Queue = _queue_mod.Queue()
    loop = asyncio.get_event_loop()

    # Run the blocking pipeline in a thread; it puts events into q as they're ready
    future = loop.run_in_executor(None, _pipeline, query, max_papers, session_id, q)

    _SENTINEL = object()

    async def drain():
        """Pull events from the queue and broadcast them until pipeline finishes."""
        while True:
            try:
                ev = q.get_nowait()
                await manager.broadcast(ev)
                await asyncio.sleep(0.015)   # slight pace to avoid flooding WS
            except _queue_mod.Empty:
                if future.done():
                    break
                await asyncio.sleep(0.05)   # nothing yet — yield then retry

    try:
        await drain()
        # Re-raise any exception from the pipeline thread
        future.result()
    except Exception as e:
        await manager.broadcast({"event": "error", "message": str(e)})


@app.post("/expand")
async def expand_node(body: dict) -> dict:
    """Fetch papers that cite or are cited by the given PMID, stream as events."""
    pmid       = body.get("pmid", "").strip()
    session_id = body.get("session_id", "default")
    if not pmid:
        return {"error": "pmid required"}

    session = _sessions.get(session_id, {})
    existing = session.get("existing_pmids", set())

    # Get citing PMIDs via elink
    citing = fetch_citing_pmids(pmid)
    new_pmids = [p for p in citing if p not in existing][:8]
    if not new_pmids:
        return {"events": [], "message": "No new papers found."}

    records = fetch_abstracts(new_pmids)
    citation_counts = fetch_citation_counts([r["pmid"] for r in records])
    events: list[dict] = []

    pmid_to_rec = session.get("pmid_to_rec", {})
    topic_index = session.get("topic_index", {})

    for rec in records:
        existing.add(rec["pmid"])
        pmid_to_rec[rec["pmid"]] = rec
        events.append({
            "event": "node", "kind": "Paper", "id": rec["pmid"],
            "title":           rec["title"],
            "year":            rec.get("year", 0),
            "authors":         rec.get("authors", []),
            "abstract":        rec.get("abstract", ""),
            "journal":         rec.get("journal", ""),
            "citation_count":  citation_counts.get(rec["pmid"], 0),
            "expanded_from":   pmid,
        })
        # Cites edge from original to new
        events.append({"event": "edge", "kind": "Cites", "src": pmid, "dst": rec["pmid"]})

        # Topic extraction for new papers
        if rec.get("abstract"):
            try:
                keywords = extract_topics(rec["abstract"])
            except Exception:
                keywords = []
            for kw in [k.lower().strip() for k in keywords if k.strip()]:
                topic_index.setdefault(kw, []).append(rec["pmid"])
                events.append({"event": "edge", "kind": "HasTopic", "src": rec["pmid"], "dst": "topic_" + kw})

    # Update session
    if session_id in _sessions:
        _sessions[session_id]["existing_pmids"] = existing
        _sessions[session_id]["pmid_to_rec"]    = pmid_to_rec
        _sessions[session_id]["topic_index"]     = topic_index

    return {"events": events}


@app.post("/redetect-gaps")
async def redetect_gaps(body: dict) -> dict:
    """Re-run gap detection with a new threshold on the current session data."""
    session_id = body.get("session_id", "default")
    threshold  = int(body.get("threshold", 2))
    session    = _sessions.get(session_id)

    if not session:
        return {"events": [], "error": "No session data — run a query first."}

    try:
        events = run_gap_detection(
            pmid_to_rec  = session["pmid_to_rec"],
            topic_index  = session["topic_index"],
            threshold    = threshold,
        )
        return {"events": events}
    except Exception as e:
        return {"events": [], "error": str(e)}


@app.post("/chat")
async def lexis_chat(body: dict):
    """Streaming conversational AI with full session context injected into system prompt."""
    messages    = body.get("messages", [])
    session_id  = body.get("session_id", "default")
    sel_node    = body.get("selected_node", None)   # currently selected graph node

    session     = _sessions.get(session_id, {})
    pmid_to_rec = session.get("pmid_to_rec", {})
    topic_index = session.get("topic_index", {})
    query       = session.get("query", "a biomedical topic")

    # Build a rich context block
    papers_text = ""
    if pmid_to_rec:
        for r in list(pmid_to_rec.values())[:20]:
            ab = (r.get("abstract") or "")[:180].replace("\n", " ")
            papers_text += f"  • PMID:{r['pmid']} ({r.get('year','?')}): \"{r['title']}\" — {ab}…\n"

    topics_sample = ", ".join(list(topic_index.keys())[:25]) or "none extracted yet"

    selected_ctx = ""
    if sel_node:
        kind = sel_node.get("kind", "")
        if kind == "Paper":
            rec = pmid_to_rec.get(sel_node.get("id"), {})
            if rec:
                selected_ctx = (
                    f"\n\nFOCUS — The user is looking at this paper:\n"
                    f"  Title: \"{rec.get('title','')}\"\n"
                    f"  PMID: {rec.get('pmid','')}, Year: {rec.get('year','')}\n"
                    f"  Abstract: {(rec.get('abstract',''))[:400]}"
                )
        elif kind == "ResearchGap":
            selected_ctx = (
                f"\n\nFOCUS — The user is looking at this research gap:\n"
                f"  Gap: {sel_node.get('description','')}\n"
                f"  Suggested direction: {sel_node.get('suggested_direction','')}\n"
                f"  Confidence: {sel_node.get('confidence', 0):.0%}"
            )
        elif kind == "Topic":
            selected_ctx = (
                f"\n\nFOCUS — The user is looking at the topic cluster: \"{sel_node.get('keyword','')}\"\n"
                f"  Papers in this cluster: {sel_node.get('paper_count', 0)}"
            )

    system = f"""You are Lexis, an expert AI research assistant embedded in an interactive biomedical literature analysis tool.

The user ran this query: "{query}"

Papers currently loaded ({len(pmid_to_rec)} total):
{papers_text}
Semantic topics extracted: {topics_sample}
{selected_ctx}

Your role:
- Discuss, synthesize, and challenge ideas about this specific literature
- Reference paper titles and PMIDs when relevant ("The 2022 paper by Zhang et al. (PMID:38123456)...")
- Help the user understand research gaps and what they mean scientifically
- Be direct, concise (≤120 words unless asked for more), and intellectually honest
- You CAN disagree with the user — push back if they misinterpret the evidence
- If the user asks about a specific paper, use its abstract to give a detailed answer
- If the user challenges a finding, engage with the argument critically

Do not start with "As an AI" or similar. Start with the substance."""

    async def stream_response():
        try:
            resp = _llm(
                model="claude-haiku-4-5",
                messages=[{"role": "system", "content": system}] + [
                    {"role": m["role"], "content": m["content"]} for m in messages
                ],
                max_tokens=350,
                temperature=0.45,
                api_key=os.environ.get("ANTHROPIC_API_KEY"),
                stream=True,
            )
            for chunk in resp:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
        except Exception as e:
            yield f"[Error: {str(e)[:80]}]"

    return StreamingResponse(stream_response(), media_type="text/plain; charset=utf-8",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/edge-summary")
async def edge_summary(body: dict) -> dict:
    """Return an AI explanation of why two papers are connected."""
    pmid_a     = body.get("pmid_a", "").strip()
    pmid_b     = body.get("pmid_b", "").strip()
    session_id = body.get("session_id", "default")

    if not pmid_a or not pmid_b:
        return {"summary": "Missing paper IDs.", "pmid_a": pmid_a, "pmid_b": pmid_b}

    session    = _sessions.get(session_id, {})
    pmid_to_rec = session.get("pmid_to_rec", {})
    rec_a      = pmid_to_rec.get(pmid_a)
    rec_b      = pmid_to_rec.get(pmid_b)

    if not rec_a or not rec_b:
        return {
            "summary": "Papers not found in current session.",
            "pmid_a": pmid_a, "pmid_b": pmid_b,
        }

    loop = asyncio.get_event_loop()
    try:
        summ = await loop.run_in_executor(
            None,
            connection_summary,
            rec_a["title"],
            rec_a.get("abstract", ""),
            rec_b["title"],
            rec_b.get("abstract", ""),
        )
    except Exception as e:
        summ = "These papers share related biomedical themes."
        print(f"[lexis] edge-summary failed: {e}")

    return {"summary": summ, "pmid_a": pmid_a, "pmid_b": pmid_b}


@app.post("/voice")
async def voice_command(body: dict) -> dict:
    """Parse a voice transcript and return a structured action + speech response."""
    transcript = body.get("transcript", "").strip()
    context    = body.get("context", {})
    if not transcript:
        return {"action": "none", "speech": ""}

    system_prompt = (
        "You are the voice interface for Lexis, a biomedical research gap detection tool. "
        "The user has spoken a command or question. Given their transcript and app context, "
        "respond with a JSON object: "
        '{"action": "search"|"read_gaps"|"read_paper"|"expand"|"zoom"|"filter"|"reset"|"narrate"|"none", '
        '"query": "...", "speech": "...", "filter_year": 2020}. '
        "Keep speech under 25 words. No markdown. Be precise and scientific."
    )
    user_msg = (
        f"Transcript: {transcript}\n"
        f"Context: papers={context.get('paper_count', 0)}, "
        f"gaps={context.get('gap_count', 0)}, "
        f"selected={context.get('selected_node', {}).get('kind', 'none') if context.get('selected_node') else 'none'}"
    )
    try:
        raw  = _chat([{"role": "system", "content": system_prompt}, {"role": "user", "content": user_msg}])
        data = _parse_json(raw)
        return data
    except Exception as e:
        return {"action": "none", "speech": f"Couldn't parse that. {str(e)[:40]}"}


# ─── WebSocket endpoint ───────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        while True:
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_json({"event": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(ws)
