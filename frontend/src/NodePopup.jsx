import { useEffect, useRef } from "react";

const S = {
  overlay: {
    position: "absolute",
    zIndex: 100,
    width: 300,
    background: "rgba(5,13,26,0.96)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(124,77,255,0.4)",
    borderRadius: 12,
    boxShadow: "0 0 40px rgba(124,77,255,0.2), 0 8px 32px rgba(0,0,0,0.6)",
    animation: "popupIn 180ms ease-out forwards",
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
    color: "var(--star-white)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px 8px",
    borderBottom: "1px solid var(--star-faint)",
  },
  label: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    display: "flex",
    alignItems: "center",
    gap: 7,
  },
  dot: (color) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    boxShadow: `0 0 8px ${color}`,
    flexShrink: 0,
  }),
  closeBtn: {
    cursor: "pointer",
    color: "var(--star-dim)",
    fontSize: 16,
    lineHeight: 1,
    padding: "2px 4px",
    borderRadius: 4,
    border: "none",
    background: "transparent",
  },
  body: {
    padding: "12px 14px",
  },
  title: {
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.4,
    marginBottom: 6,
    color: "var(--star-white)",
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  meta: {
    fontSize: 11,
    color: "var(--star-dim)",
    marginBottom: 8,
    fontFamily: "'Space Mono', monospace",
  },
  abstract: {
    fontSize: 12,
    color: "var(--star-dim)",
    lineHeight: 1.7,
    marginBottom: 10,
  },
  citations: {
    fontSize: 12,
    color: "var(--accent-amber)",
    fontFamily: "'Space Mono', monospace",
    marginBottom: 12,
  },
  actions: {
    display: "flex",
    gap: 8,
  },
  btn: (primary) => ({
    flex: 1,
    padding: "6px 10px",
    borderRadius: 7,
    border: primary ? "1px solid rgba(124,77,255,0.6)" : "1px solid var(--star-faint)",
    background: primary ? "rgba(124,77,255,0.15)" : "transparent",
    color: primary ? "var(--accent-aurora)" : "var(--star-dim)",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    textDecoration: "none",
    textAlign: "center",
    display: "block",
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
  }),
  confidenceBar: {
    height: 3,
    background: "var(--star-faint)",
    borderRadius: 2,
    marginBottom: 6,
    overflow: "hidden",
  },
  gapDesc: {
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.5,
    marginBottom: 8,
    color: "var(--star-white)",
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--star-dim)",
    marginBottom: 5,
    marginTop: 10,
  },
  adjPaper: {
    fontSize: 11,
    color: "var(--accent-teal)",
    lineHeight: 1.5,
    marginBottom: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

function useClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (e) => {
      if (!ref.current || ref.current.contains(e.target)) return;
      handler();
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref, handler]);
}

export default function NodePopup({ node, screenPos, onClose, onExpand, allNodes }) {
  const ref = useRef();
  useClickOutside(ref, onClose);

  if (!node || !screenPos) return null;

  // Clamp position to stay within viewport
  const W = 300, H = 380;
  let left = screenPos.x + 20;
  let top  = screenPos.y - 40;
  if (left + W > window.innerWidth - 20)  left = screenPos.x - W - 20;
  if (top + H  > window.innerHeight - 20) top  = window.innerHeight - H - 20;
  if (top < 60) top = 60;

  const style = { ...S.overlay, left, top };

  if (node.kind === "Paper") {
    const meta = [
      node.authors?.[0],
      node.year || null,
      node.journal || null,
    ].filter(Boolean).join(" · ");

    return (
      <>
        <style>{`
          @keyframes popupIn {
            from { opacity: 0; transform: scale(0.85); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>
        <div ref={ref} style={style}>
          <div style={S.header}>
            <span style={S.label}>
              <span style={S.dot("#7c4dff")} />
              Paper
            </span>
            <button style={S.closeBtn} onClick={onClose}>✕</button>
          </div>
          <div style={S.body}>
            <div style={S.title}>{node.title}</div>
            {meta && <div style={S.meta}>{meta}</div>}
            {node.abstract && (
              <div style={S.abstract}>
                {node.abstract.slice(0, 220)}…
              </div>
            )}
            {(node.citation_count ?? 0) > 0 && (
              <div style={S.citations}>★ {node.citation_count} citations</div>
            )}
            <div style={S.actions}>
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${node.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={S.btn(true)}
              >
                Open in PubMed ↗
              </a>
              <button style={S.btn(false)} onClick={() => onExpand(node.id)}>
                Find related →
              </button>
            </div>
            {node.abstract && (
              <button
                style={{
                  ...S.btn(false),
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  width: "100%",
                  borderColor: "rgba(0,191,165,0.35)",
                  color: "var(--accent-teal, #00bfa5)",
                }}
                onClick={() => {
                  if (!window.speechSynthesis) return;
                  window.speechSynthesis.cancel();
                  const utt = new SpeechSynthesisUtterance(node.abstract.slice(0, 400));
                  utt.rate = 0.92; utt.pitch = 1.0;
                  const voices = window.speechSynthesis.getVoices();
                  const preferred = voices.find(v =>
                    v.name.includes("Samantha") || v.name.includes("Google US English") || v.name.includes("Karen")
                  );
                  if (preferred) utt.voice = preferred;
                  window.speechSynthesis.speak(utt);
                }}
              >
                🔊 Read abstract aloud
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  if (node.kind === "Topic") {
    const connectedPapers = allNodes
      .filter(n => n.kind === "Paper")
      .slice(0, 5);

    return (
      <>
        <style>{`@keyframes popupIn { from { opacity:0; transform:scale(0.85); } to { opacity:1; transform:scale(1); } }`}</style>
        <div ref={ref} style={style}>
          <div style={S.header}>
            <span style={S.label}>
              <span style={S.dot("#00bfa5")} />
              Topic Cluster
            </span>
            <button style={S.closeBtn} onClick={onClose}>✕</button>
          </div>
          <div style={S.body}>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--accent-teal)", marginBottom: 6 }}>
              #{node.keyword}
            </div>
            <div style={{ fontSize: 12, color: "var(--star-dim)", marginBottom: 12 }}>
              {node.paper_count} paper{node.paper_count !== 1 ? "s" : ""} in this cluster
            </div>
            {connectedPapers.length > 0 && (
              <>
                <div style={S.sectionLabel}>Papers</div>
                {connectedPapers.map((p, i) => (
                  <div key={i} style={S.adjPaper}>
                    {p.title?.slice(0, 48)}{p.title?.length > 48 ? "…" : ""}
                  </div>
                ))}
              </>
            )}
            <div style={{ marginTop: 12 }}>
              <button style={{ ...S.btn(false), flex: "none", width: "100%" }}>
                Explore this topic →
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (node.kind === "ResearchGap") {
    const conf = node.confidence ?? 0;
    const confPct = (conf * 100).toFixed(0);

    return (
      <>
        <style>{`@keyframes popupIn { from { opacity:0; transform:scale(0.85); } to { opacity:1; transform:scale(1); } }`}</style>
        <div ref={ref} style={{ ...style, border: "1px solid rgba(255,255,255,0.25)" }}>
          <div style={{ ...S.header, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <span style={{ ...S.label, color: "var(--star-white)" }}>
              <span style={{ fontSize: 14 }}>✦</span>
              Research Gap
            </span>
            <button style={S.closeBtn} onClick={onClose}>✕</button>
          </div>
          <div style={S.body}>
            {/* Confidence bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ ...S.confidenceBar, flex: 1 }}>
                <div style={{
                  height: "100%",
                  width: `${confPct}%`,
                  background: "linear-gradient(90deg, #7c4dff, #4fc3f7)",
                  borderRadius: 2,
                }} />
              </div>
              <span style={{ fontSize: 11, color: "var(--accent-aurora)", fontFamily: "'Space Mono', monospace", flexShrink: 0 }}>
                {confPct}% confidence
              </span>
            </div>

            <div style={S.gapDesc}>{node.description}</div>

            <div style={S.sectionLabel}>Suggested Direction</div>
            <div style={{ fontSize: 12, color: "var(--star-dim)", lineHeight: 1.6, marginBottom: 10 }}>
              {node.suggested_direction}
            </div>

            {node.adjacent_pmids?.length > 0 && (
              <>
                <div style={S.sectionLabel}>Adjacent Papers</div>
                {node.adjacent_pmids.slice(0, 3).map((pmid, i) => (
                  <a
                    key={i}
                    href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...S.adjPaper, display: "block", textDecoration: "none" }}
                  >
                    PMID:{pmid} ↗
                  </a>
                ))}
              </>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                style={{ ...S.btn(true), flex: "none", width: "100%", borderColor: "rgba(255,255,255,0.3)", color: "var(--star-white)" }}
                onClick={() => {
                  const md = `## Research Gap\n\n**Finding:** ${node.description}\n\n**Confidence:** ${confPct}%\n\n**Suggested direction:** ${node.suggested_direction}\n`;
                  const blob = new Blob([md], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `gap-${Date.now()}.md`; a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export this gap ↓
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return null;
}
