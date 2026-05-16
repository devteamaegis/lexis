"""
lexis_pubmed.py
Pure Python PubMed API helpers. Imported by lexis.jac via standard Jac import.
Uses only the NCBI E-utilities — no API key required for small queries.
"""

import time
import xml.etree.ElementTree as ET
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import URLError

ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
EFETCH  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
TOOL    = "lexis-hackathon"
EMAIL   = "lexis@example.com"   # swap for your real email


def _get(url: str, params: dict) -> str:
    params.update({"tool": TOOL, "email": EMAIL})
    full = url + "?" + urlencode(params)
    req = Request(full, headers={"User-Agent": "Lexis/1.0"})
    with urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8")


def fetch_papers(query: str, max_results: int = 30) -> list[str]:
    """
    Run an esearch for `query` in PubMed and return a list of PMIDs.
    """
    params = {
        "db": "pubmed",
        "term": query,
        "retmax": str(max_results),
        "retmode": "json",
        "sort": "relevance",
    }
    try:
        raw = _get(ESEARCH, params)
        import json
        data = json.loads(raw)
        return data["esearchresult"]["idlist"]
    except Exception as e:
        print(f"[lexis_pubmed] esearch failed: {e}")
        return []


def fetch_abstracts(pmids: list[str]) -> list[dict]:
    """
    Fetch full PubMed records for the given PMIDs via efetch.
    Returns a list of dicts with keys:
        pmid, title, abstract, year, authors, journal, references
    """
    if not pmids:
        return []

    # NCBI rate limit: 3 requests/sec without API key
    # Batch in chunks of 20
    results = []
    for i in range(0, len(pmids), 20):
        chunk = pmids[i:i+20]
        params = {
            "db": "pubmed",
            "id": ",".join(chunk),
            "rettype": "xml",
            "retmode": "xml",
        }
        try:
            raw = _get(EFETCH, params)
            results.extend(_parse_efetch_xml(raw))
        except Exception as e:
            print(f"[lexis_pubmed] efetch chunk {i} failed: {e}")
        if i + 20 < len(pmids):
            time.sleep(0.35)   # respect NCBI rate limit

    return results


def _parse_efetch_xml(xml_str: str) -> list[dict]:
    """Parse PubMed efetch XML into a list of paper dicts."""
    root = ET.fromstring(xml_str)
    papers = []

    for article in root.findall(".//PubmedArticle"):
        try:
            pmid_el = article.find(".//PMID")
            pmid = pmid_el.text if pmid_el is not None else ""

            # Title
            title_el = article.find(".//ArticleTitle")
            title = "".join(title_el.itertext()) if title_el is not None else ""

            # Abstract (can have multiple AbstractText sections)
            abstract_parts = article.findall(".//AbstractText")
            abstract = " ".join(
                "".join(p.itertext()) for p in abstract_parts
            ).strip()

            # Year — prefer PubDate/Year, fall back to MedlineDate
            year = 0
            year_el = article.find(".//PubDate/Year")
            if year_el is not None:
                try:
                    year = int(year_el.text)
                except ValueError:
                    pass

            # Authors
            authors = []
            for au in article.findall(".//Author"):
                last = au.findtext("LastName", "")
                fore = au.findtext("ForeName", "")
                if last:
                    authors.append(f"{last} {fore}".strip())

            # Journal
            journal = article.findtext(".//Journal/Title", "")

            # Reference PMIDs (not always present)
            references = []
            for ref in article.findall(".//Reference"):
                ref_pmid_el = ref.find(".//ArticleId[@IdType='pubmed']")
                if ref_pmid_el is not None:
                    references.append(ref_pmid_el.text)

            if pmid and (title or abstract):
                papers.append({
                    "pmid": pmid,
                    "title": title,
                    "abstract": abstract,
                    "year": year,
                    "authors": authors,
                    "journal": journal,
                    "references": references,
                })
        except Exception:
            continue

    return papers


# ─── AMD seed data (used for demo; avoids cold-start latency) ─────────────────
AMD_SEED_PMIDS = [
    "37578220",   # LipidUNet (Ishaan's paper)
    "36543840",
    "35901288",
    "34856614",
    "34192765",
    "33692371",
    "32958824",
    "32540438",
    "31904800",
    "31567218",
    "30867029",
    "30224623",
    "29704619",
    "28974420",
    "28196373",
]


def fetch_amd_seed() -> list[dict]:
    """Pre-fetch the AMD seed set. Call this on server startup for instant demo."""
    return fetch_abstracts(AMD_SEED_PMIDS)
