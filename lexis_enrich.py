"""
lexis_enrich.py
Semantic similarity enrichment pass.
Uses OpenAI text-embedding-3-small to find thematically similar papers
that don't already cite each other.
"""

import json
import math
import os
from urllib.request import urlopen, Request


def _get_embeddings(texts: list[str], api_key: str) -> list[list[float]]:
    """Call OpenAI embeddings API — batch all texts in one request."""
    truncated = [t[:1500] for t in texts]   # ~500 tokens each, safe batch
    body = json.dumps({
        "model": "text-embedding-3-small",
        "input": truncated,
    }).encode()
    req = Request(
        "https://api.openai.com/v1/embeddings",
        data=body,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    with urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    # data["data"] is sorted by index
    return [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]


def _cosine(a: list[float], b: list[float]) -> float:
    dot  = sum(x * y for x, y in zip(a, b))
    na   = math.sqrt(sum(x * x for x in a))
    nb   = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def compute_semantic_edges(
    papers: list[dict],
    existing_cite_pairs: set[tuple],
    threshold: float = 0.82,
    max_edges: int = 50,
) -> list[dict]:
    """
    Given a list of paper dicts (must have 'pmid' and 'abstract'),
    compute pairwise cosine similarity on embeddings and return semantic
    similarity edges above `threshold` that don't already have a Cites edge.

    Returns list of dicts: {"src": pmid1, "dst": pmid2, "kind": "Semantic", "similarity": float}
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        return []

    eligible = [p for p in papers if p.get("abstract")]
    if len(eligible) < 2:
        return []

    try:
        embeddings = _get_embeddings([p["abstract"] for p in eligible], api_key)
    except Exception as e:
        print(f"[lexis_enrich] Embedding API failed: {e}")
        return []

    # Pairwise cosine similarity
    candidates: list[tuple[float, str, str]] = []
    for i in range(len(eligible)):
        for j in range(i + 1, len(eligible)):
            pi, pj = eligible[i], eligible[j]
            pair_ab = (pi["pmid"], pj["pmid"])
            pair_ba = (pj["pmid"], pi["pmid"])
            # Skip if already connected by citation
            if pair_ab in existing_cite_pairs or pair_ba in existing_cite_pairs:
                continue
            sim = _cosine(embeddings[i], embeddings[j])
            if sim >= threshold:
                candidates.append((sim, pi["pmid"], pj["pmid"]))

    # Take top max_edges by similarity
    candidates.sort(reverse=True)
    return [
        {"src": src, "dst": dst, "kind": "Semantic", "similarity": round(sim, 4)}
        for sim, src, dst in candidates[:max_edges]
    ]
