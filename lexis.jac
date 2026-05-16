"""
Lexis — Literature EXploration Intelligence System
A Jac-native research gap detection engine.
Graph: Paper --[Cites]--> Paper --[HasTopic]--> Topic <--[NearGap]-- ResearchGap

Run standalone:  jac start lexis.jac --port 8001
"""

import from byllm.llm { Model }
import from lexis_pubmed { fetch_papers, fetch_abstracts }
import from json { loads }
import from datetime { datetime }

glob llm = Model(model_name="anthropic/claude-haiku-4-5");


# ─── Node definitions ─────────────────────────────────────────────────────────

node Session {
    has query: str;
    has created_at: str;
    has status: str = "running";
}

node Paper {
    has pmid: str;
    has title: str;
    has abstract: str = "";
    has year: int = 0;
    has authors: list[str] = [];
    has citation_count: int = 0;
    has journal: str = "";
}

node Topic {
    has keyword: str;
    has paper_count: int = 0;
}

node ResearchGap {
    has description: str;
    has confidence: float;
    has suggested_direction: str;
    has adjacent_pmids: list[str] = [];
}


# ─── Edge definitions ─────────────────────────────────────────────────────────

edge Cites {}
edge HasTopic {}
edge NearGap {}


# ─── LLM-powered abilities (byLLM / Meaning Typed Programming) ────────────────

"""Extract 3–5 concise topic keywords from a biomedical abstract.
Return ONLY a JSON array of lowercase strings, e.g. ["gene therapy", "retinal degeneration"].
No explanation, no markdown."""
def extract_topics(abstract: str) -> list[str] by llm();

"""
Given a sparsely-covered topic keyword and abstracts of the two nearby papers,
identify whether a genuine research gap exists.
Return ONLY valid JSON: {"is_gap": bool, "description": str, "confidence": float, "suggested_direction": str}
No markdown, no preamble.
"""
def detect_gap(topic: str, nearby_abstracts: list[str]) -> str by llm();

"""
Given a list of paper titles and a research question,
write a 3–4 sentence structured literature synthesis. Be specific. Do not pad.
"""
def synthesize_review(question: str, titles: list[str]) -> str by llm();

"""
Given two biomedical paper titles and abstracts, explain in exactly 1–2 sentences
the scientific connection between them. Be specific, no preamble.
"""
def connection_summary(title_a: str, abstract_a: str, title_b: str, abstract_b: str) -> str by llm();


# ─── Walker: full pipeline ────────────────────────────────────────────────────

walker ResearchWalker {
    has query: str;
    has max_papers: int = 25;

    can start with entry {
        sess = Session(
            query=self.query,
            created_at=str(datetime.now().isoformat())
        );
        here ++> sess;

        pmids = fetch_papers(self.query, max_results=self.max_papers);
        if not pmids {
            sess.status = "no_results";
            report {"event": "done", "papers": 0, "gaps": 0, "synthesis": ""};
            disengage;
        }

        records = fetch_abstracts(pmids);

        # Build Paper nodes and index
        pmid_to_node: dict[str, Paper] = {};
        for rec in records {
            p = Paper(
                pmid=rec["pmid"],
                title=rec["title"],
                abstract=rec.get("abstract", ""),
                year=rec.get("year", 0),
                authors=rec.get("authors", []),
                journal=rec.get("journal", "")
            );
            sess ++> p;
            pmid_to_node[rec["pmid"]] = p;
            report {
                "event": "node", "kind": "Paper",
                "id":       rec["pmid"],
                "title":    rec["title"],
                "year":     rec.get("year", 0),
                "authors":  rec.get("authors", []),
                "abstract": rec.get("abstract", ""),
                "journal":  rec.get("journal", ""),
                "citation_count": 0
            };
        }

        # Cites edges
        for rec in records {
            refs: list[str] = rec.get("references", []);
            for ref_pmid in refs {
                if ref_pmid in pmid_to_node and rec["pmid"] in pmid_to_node {
                    src_p = pmid_to_node[rec["pmid"]];
                    dst_p = pmid_to_node[ref_pmid];
                    src_p +>:Cites:+> dst_p;
                    report {"event": "edge", "kind": "Cites", "src": rec["pmid"], "dst": ref_pmid};
                }
            }
        }

        # Topic extraction — collect full index first so paper_count is accurate
        topic_index: dict[str, list[str]] = {};
        for rec in records {
            if not rec.get("abstract") { continue; }
            try {
                kws = extract_topics(rec["abstract"][:800]);
            } except Exception {
                kws = [];
            }
            for kw in kws {
                kw_clean = kw.lower().strip();
                if kw_clean {
                    if kw_clean not in topic_index {
                        topic_index[kw_clean] = [];
                    }
                    topic_index[kw_clean].append(rec["pmid"]);
                }
            }
        }

        # Emit Topic nodes and HasTopic edges
        for kw in topic_index {
            pmids_for_topic: list[str] = topic_index[kw];
            t = Topic(keyword=kw, paper_count=len(pmids_for_topic));
            sess ++> t;
            for pmid in pmids_for_topic {
                p = pmid_to_node.get(pmid);
                if p { p +>:HasTopic:+> t; }
            }
            report {
                "event": "node", "kind": "Topic",
                "id": "topic_" + kw,
                "keyword": kw,
                "paper_count": len(pmids_for_topic)
            };
            for pmid in pmids_for_topic {
                report {"event": "edge", "kind": "HasTopic", "src": pmid, "dst": "topic_" + kw};
            }
        }

        # Gap detection — only topics with <= 2 papers are sparse
        gaps_found = 0;
        for kw in topic_index {
            pmids_for_topic: list[str] = topic_index[kw];
            if len(pmids_for_topic) > 2 { continue; }

            nearby_abstracts: list[str] = [];
            nearby_pmids: list[str] = [];
            for pmid in pmids_for_topic[:2] {
                p = pmid_to_node.get(pmid);
                if p and p.abstract {
                    nearby_abstracts.append(p.abstract[:600]);
                    nearby_pmids.append(pmid);
                }
            }
            if not nearby_abstracts { continue; }

            try {
                raw = detect_gap(kw, nearby_abstracts);
                result: dict = loads(raw);
            } except Exception {
                continue;
            }

            if result.get("is_gap", False) and float(result.get("confidence", 0)) > 0.6 {
                gaps_found += 1;
                gap_id = "gap_" + str(gaps_found);
                gap = ResearchGap(
                    description=result["description"],
                    confidence=float(result["confidence"]),
                    suggested_direction=result["suggested_direction"],
                    adjacent_pmids=nearby_pmids
                );
                sess ++> gap;
                report {
                    "event": "node", "kind": "ResearchGap",
                    "id": gap_id,
                    "description":         result["description"],
                    "confidence":          float(result["confidence"]),
                    "suggested_direction": result["suggested_direction"],
                    "adjacent_pmids":      nearby_pmids
                };
                for pmid in nearby_pmids {
                    report {"event": "edge", "kind": "NearGap", "src": gap_id, "dst": pmid};
                }
            }
        }

        # Synthesis
        all_titles: list[str] = [rec["title"] for rec in records[:15] if rec.get("title")];
        try {
            synthesis = synthesize_review(self.query, all_titles);
        } except Exception {
            synthesis = "Synthesis unavailable.";
        }

        sess.status = "complete";
        report {"event": "done", "gaps": gaps_found, "synthesis": synthesis};
    }
}


# ─── Public REST endpoints (jac start exposes these) ──────────────────────────

walker:pub RunQuery {
    """Start a research pipeline. Returns all events synchronously."""
    has query: str;
    has max_papers: int = 25;

    can run with entry {
        w = ResearchWalker(query=self.query, max_papers=self.max_papers);
        here spawn w;
    }
}


walker:pub GetGraph {
    """Return all nodes from the most recent session."""
    can run with entry {
        sessions = [here --> ][?:Session];
        if not sessions {
            report {"nodes": [], "gaps": []};
            disengage;
        }
        sess = sessions[-1];
        papers  = [sess --> ][?:Paper];
        topics  = [sess --> ][?:Topic];
        gaps    = [sess --> ][?:ResearchGap];

        for p in papers {
            report {"kind": "Paper", "id": p.pmid, "title": p.title, "year": p.year};
        }
        for t in topics {
            report {"kind": "Topic", "id": "topic_" + t.keyword, "keyword": t.keyword};
        }
        for g in gaps {
            report {
                "kind": "ResearchGap",
                "description": g.description,
                "confidence": g.confidence,
                "suggested_direction": g.suggested_direction
            };
        }
    }
}


walker:pub ConnectionSummary {
    """Return an AI explanation of why two papers are connected."""
    has pmid_a: str;
    has pmid_b: str;

    can run with entry {
        sessions = [here --> ][?:Session];
        if not sessions {
            report {"summary": "No session active."};
            disengage;
        }
        sess = sessions[-1];
        papers = [sess --> ][?:Paper];

        pa: Paper | None = None;
        pb: Paper | None = None;
        for p in papers {
            if p.pmid == self.pmid_a { pa = p; }
            if p.pmid == self.pmid_b { pb = p; }
        }

        if not pa or not pb {
            report {"summary": "Papers not found in current session.", "pmid_a": self.pmid_a, "pmid_b": self.pmid_b};
            disengage;
        }

        try {
            summ = connection_summary(
                pa.title, pa.abstract[:400],
                pb.title, pb.abstract[:400]
            );
        } except Exception {
            summ = "These papers share related biomedical themes.";
        }
        report {"summary": summ, "pmid_a": self.pmid_a, "pmid_b": self.pmid_b};
    }
}
