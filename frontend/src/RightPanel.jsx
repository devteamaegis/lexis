import { useState, useRef, useEffect } from "react";

// ─── Shared styles ────────────────────────────────────────────────────────────
const S = {
  panel: {
    background: "var(--space-deep)",
    borderLeft: "1px solid var(--star-faint)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    width: 320,
    flexShrink: 0,
  },
  tabs: {
    display: "flex",
    gap: 4,
    padding: "8px 12px",
    borderBottom: "1px solid var(--star-faint)",
    background: "var(--space-nebula)",
  },
  tab: (active) => ({
    flex: 1,
    padding: "5px 0",
    borderRadius: 6,
    border: "none",
    background: active ? "var(--star-faint)" : "transparent",
    color: active ? "var(--star-white)" : "var(--star-dim)",
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    letterSpacing: "0.05em",
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
    transition: "all 0.15s",
  }),
  scrollArea: {
    flex: 1,
    overflowY: "auto",
    padding: "12px",
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--star-dim)",
    marginBottom: 8,
    marginTop: 14,
  },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    background: "var(--space-nebula)",
    border: "1px solid var(--star-faint)",
    borderRadius: 8,
    padding: "10px 12px",
  },
  statNum: {
    fontSize: 22,
    fontFamily: "'Space Mono', monospace",
    color: "var(--star-white)",
    lineHeight: 1,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--star-dim)",
  },
  synthesis: {
    fontSize: 12,
    color: "var(--star-dim)",
    lineHeight: 1.7,
    borderLeft: "2px solid var(--accent-pulse)",
    paddingLeft: 10,
    marginBottom: 12,
  },
  logLine: (type) => ({
    fontSize: 10,
    fontFamily: "'Space Mono', monospace",
    lineHeight: 1.8,
    color: type === "success" ? "#4caf88" : type === "error" ? "#e57373" : "var(--star-dim)",
  }),
  gapCard: {
    background: "var(--space-nebula)",
    border: "1px solid var(--star-faint)",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 8,
    cursor: "pointer",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  confBar: (pct) => ({
    height: 3,
    background: "var(--star-faint)",
    borderRadius: 2,
    marginBottom: 8,
    overflow: "hidden",
    position: "relative",
  }),
  confFill: (pct) => ({
    position: "absolute",
    inset: 0,
    width: `${pct}%`,
    background: "linear-gradient(90deg, #7c4dff, #4fc3f7)",
    borderRadius: 2,
  }),
  gapDesc: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--star-white)",
    lineHeight: 1.4,
    marginBottom: 5,
  },
  gapDir: {
    fontSize: 11,
    color: "var(--star-dim)",
    lineHeight: 1.4,
    marginBottom: 6,
  },
  adjPaper: {
    fontSize: 10,
    color: "var(--accent-teal)",
    marginBottom: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  searchInput: {
    width: "100%",
    background: "var(--space-nebula)",
    border: "1px solid var(--star-faint)",
    borderRadius: 7,
    padding: "7px 10px",
    color: "var(--star-white)",
    fontSize: 12,
    outline: "none",
    marginBottom: 10,
  },
  paperRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 0",
    borderBottom: "1px solid rgba(42,58,92,0.5)",
    cursor: "pointer",
  },
  paperCount: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 11,
    color: "var(--accent-amber)",
    flexShrink: 0,
    minWidth: 32,
    textAlign: "right",
    paddingTop: 1,
  },
  paperTitle: {
    fontSize: 11,
    color: "var(--star-white)",
    lineHeight: 1.4,
    flex: 1,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  paperYear: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    color: "var(--star-dim)",
    flexShrink: 0,
    paddingTop: 2,
  },
};

// ─── Tab: Overview ────────────────────────────────────────────────────────────
function OverviewTab({ stats, synthesis, log }) {
  const logRef = useRef();
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [log]);

  return (
    <div style={S.scrollArea}>
      <div style={{ ...S.sectionLabel, marginTop: 2 }}>Stats</div>
      <div style={S.statGrid}>
        {[
          { label: "Papers",      value: stats.papers,      color: "#7c4dff" },
          { label: "Topics",      value: stats.topics,      color: "#00bfa5" },
          { label: "Gaps",        value: stats.gaps,        color: "#ffffff" },
          { label: "Connections", value: stats.connections, color: "#ffab40" },
        ].map(({ label, value, color }) => (
          <div key={label} style={S.statCard}>
            <div style={{ ...S.statNum, color }}>{value ?? 0}</div>
            <div style={S.statLabel}>{label}</div>
          </div>
        ))}
      </div>

      {synthesis && (
        <>
          <div style={S.sectionLabel}>Synthesis</div>
          <div style={S.synthesis}>{synthesis}</div>
        </>
      )}

      <div style={S.sectionLabel}>Walker Log</div>
      <div ref={logRef} style={{ maxHeight: 200, overflowY: "auto" }}>
        {log.map((line, i) => {
          const type = line.startsWith("✓") || line.startsWith("+") ? "success"
                     : line.startsWith("✗") ? "error" : "default";
          return <div key={i} style={S.logLine(type)}>{line}</div>;
        })}
      </div>
    </div>
  );
}

// ─── Tab: Gaps ────────────────────────────────────────────────────────────────
function GapsTab({ gaps, onGapClick }) {
  const sorted = [...gaps].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  if (sorted.length === 0) {
    return (
      <div style={{ ...S.scrollArea, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--star-dim)" }}>
        <div style={{ fontSize: 28, opacity: 0.3 }}>✦</div>
        <div style={{ fontSize: 12, textAlign: "center" }}>
          No gaps detected yet.<br />Run a query to explore the literature.
        </div>
      </div>
    );
  }

  return (
    <div style={S.scrollArea}>
      {sorted.map((g, i) => {
        const pct = ((g.confidence ?? 0) * 100).toFixed(0);
        return (
          <div
            key={i}
            style={S.gapCard}
            onClick={() => onGapClick(g, i)}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
              e.currentTarget.style.boxShadow = "0 0 16px rgba(255,255,255,0.05)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "var(--star-faint)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={S.confBar(pct)}>
              <div style={S.confFill(pct)} />
            </div>
            <div style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: "var(--accent-aurora)", marginBottom: 5 }}>
              {pct}% confidence
            </div>
            <div style={S.gapDesc}>{g.description}</div>
            <div style={S.gapDir}>{g.suggested_direction}</div>
            {g.adjacent_pmids?.slice(0, 2).map((pmid, j) => (
              <div key={j} style={S.adjPaper}>PMID:{pmid}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Papers ─────────────────────────────────────────────────────────────
function PapersTab({ papers, onPaperClick }) {
  const [search, setSearch] = useState("");
  const filtered = papers
    .filter(p => !search || p.title?.toLowerCase().includes(search.toLowerCase()) || p.authors?.[0]?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.citation_count ?? 0) - (a.citation_count ?? 0));

  return (
    <div style={S.scrollArea}>
      <input
        style={S.searchInput}
        placeholder="Search by title or author…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {filtered.map((p, i) => (
        <div key={p.id || i} style={S.paperRow} onClick={() => onPaperClick(p)}>
          <div style={S.paperCount}>{p.citation_count ?? 0}</div>
          <div style={S.paperTitle}>{p.title}</div>
          <div style={S.paperYear}>{p.year || "—"}</div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div style={{ color: "var(--star-dim)", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
          No papers match your search.
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function RightPanel({ stats, synthesis, log, gaps, papers, onGapClick, onPaperClick }) {
  const [tab, setTab] = useState("overview");

  return (
    <div style={S.panel}>
      <div style={S.tabs}>
        {[["overview", "Overview"], ["gaps", "Gaps"], ["papers", "Papers"]].map(([key, label]) => (
          <button key={key} style={S.tab(tab === key)} onClick={() => setTab(key)}>
            {label}
            {key === "gaps" && gaps.length > 0 && (
              <span style={{ marginLeft: 4, color: "var(--accent-aurora)" }}>({gaps.length})</span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab stats={stats} synthesis={synthesis} log={log} />}
      {tab === "gaps"     && <GapsTab gaps={gaps} onGapClick={onGapClick} />}
      {tab === "papers"   && <PapersTab papers={papers} onPaperClick={onPaperClick} />}
    </div>
  );
}
