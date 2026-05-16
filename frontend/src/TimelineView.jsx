/**
 * TimelineView — horizontal year-based timeline of papers, topics, and gaps.
 * Papers hang as purple bubbles on a glowing axis; click to open the node popup.
 */
import { useMemo, useState } from "react";

const AXIS_Y    = 200;
const HEIGHT    = 420;
const PAD_X     = 72;
const YEAR_W    = 90;   // px per year step

export default function TimelineView({ nodes, onNodeClick }) {
  const [hovered, setHovered] = useState(null);

  const papers = useMemo(
    () => nodes.filter(n => n.kind === "Paper" && n.year > 0)
             .sort((a, b) => a.year - b.year),
    [nodes]
  );
  const gaps = useMemo(() => nodes.filter(n => n.kind === "ResearchGap"), [nodes]);

  if (papers.length === 0) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", flexDirection: "column", gap: 12,
        color: "rgba(107,127,163,0.6)", fontFamily: "'Space Grotesk', system-ui, sans-serif",
      }}>
        <div style={{ fontSize: 32, opacity: 0.25 }}>📅</div>
        <div style={{ fontSize: 13 }}>No year data yet — run a query first.</div>
      </div>
    );
  }

  // Year range
  const years = [...new Set(papers.map(p => p.year))].sort((a, b) => a - b);
  const minYear = years[0];
  const maxYear = years[years.length - 1];
  const span    = maxYear - minYear || 1;

  const SVG_W = PAD_X * 2 + span * YEAR_W;

  const xFor = (year) => PAD_X + ((year - minYear) / span) * (span * YEAR_W);

  // Layout: alternate above / below axis per year group
  const byYear = {};
  for (const p of papers) {
    if (!byYear[p.year]) byYear[p.year] = [];
    byYear[p.year].push(p);
  }

  // Node positions
  const positions = [];
  for (const [yr, ps] of Object.entries(byYear)) {
    const cx = xFor(+yr);
    ps.forEach((p, i) => {
      const side   = i % 2 === 0 ? -1 : 1;             // above / below
      const step   = Math.floor(i / 2);
      const offset = (50 + step * 45) * side;
      const r      = 7 + Math.min(Math.sqrt(p.citation_count ?? 0) * 0.7, 10);
      positions.push({ paper: p, cx, cy: AXIS_Y + offset, r });
    });
  }

  return (
    <div style={{
      width: "100%", height: "100%",
      overflowX: "auto", overflowY: "hidden",
      background: "transparent",
      position: "relative",
    }}>
      {/* Gap badge strip at top */}
      {gaps.length > 0 && (
        <div style={{
          position: "sticky", top: 0, left: 0, zIndex: 5,
          display: "flex", gap: 8, padding: "8px 16px",
          flexWrap: "nowrap", overflowX: "auto",
          background: "rgba(5,13,26,0.9)", borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap", alignSelf: "center", letterSpacing: "0.08em" }}>
            GAPS:
          </span>
          {gaps.map((g, i) => (
            <span key={i} style={{
              fontSize: 10, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap",
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(200,220,255,0.7)", cursor: "pointer",
              flexShrink: 0,
            }}
              onClick={() => onNodeClick(g)}
              title={g.suggested_direction}
            >
              ✦ {(g.description ?? "").slice(0, 40)}{(g.description ?? "").length > 40 ? "…" : ""}
            </span>
          ))}
        </div>
      )}

      <svg
        width={SVG_W}
        height={HEIGHT}
        style={{ display: "block", minWidth: "100%", cursor: "default" }}
      >
        <defs>
          <radialGradient id="tl-paper-grad" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#c9b8ff" />
            <stop offset="100%" stopColor="#7c4dff" />
          </radialGradient>
          <filter id="tl-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Glowing axis line */}
        <line
          x1={PAD_X - 20} y1={AXIS_Y}
          x2={SVG_W - PAD_X + 20} y2={AXIS_Y}
          stroke="rgba(124,77,255,0.25)"
          strokeWidth={2}
        />
        {/* Axis glow */}
        <line
          x1={PAD_X - 20} y1={AXIS_Y}
          x2={SVG_W - PAD_X + 20} y2={AXIS_Y}
          stroke="rgba(124,77,255,0.08)"
          strokeWidth={8}
        />

        {/* Year tick marks & labels */}
        {years.map(yr => {
          const cx = xFor(yr);
          return (
            <g key={yr}>
              <line x1={cx} y1={AXIS_Y - 6} x2={cx} y2={AXIS_Y + 6}
                stroke="rgba(107,127,163,0.5)" strokeWidth={1} />
              <text
                x={cx} y={AXIS_Y + 22}
                textAnchor="middle"
                fill="rgba(107,127,163,0.7)"
                fontSize={10}
                fontFamily="'Space Mono', monospace"
              >{yr}</text>
            </g>
          );
        })}

        {/* Stem lines */}
        {positions.map(({ paper, cx, cy }) => (
          <line
            key={"stem-" + paper.id}
            x1={cx} y1={AXIS_Y}
            x2={cx} y2={cy}
            stroke="rgba(124,77,255,0.18)"
            strokeWidth={1}
            strokeDasharray="3,4"
          />
        ))}

        {/* Paper nodes */}
        {positions.map(({ paper, cx, cy, r }) => {
          const isHov = hovered === paper.id;
          return (
            <g
              key={paper.id}
              onClick={() => onNodeClick(paper)}
              onMouseEnter={() => setHovered(paper.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Glow ring on hover */}
              {isHov && (
                <circle cx={cx} cy={cy} r={r + 8}
                  fill="rgba(124,77,255,0.12)"
                  stroke="rgba(124,77,255,0.4)"
                  strokeWidth={1}
                />
              )}
              <circle
                cx={cx} cy={cy} r={r}
                fill="url(#tl-paper-grad)"
                stroke={isHov ? "rgba(200,180,255,0.8)" : "rgba(124,77,255,0.4)"}
                strokeWidth={isHov ? 1.5 : 0.8}
                filter={isHov ? "url(#tl-glow)" : undefined}
              />
              {/* Citation count inside */}
              {(paper.citation_count ?? 0) > 0 && (
                <text
                  x={cx} y={cy + 3.5}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.8)"
                  fontSize={r > 10 ? 8 : 6}
                  fontFamily="'Space Mono', monospace"
                >{paper.citation_count}</text>
              )}
              {/* Title label above/below */}
              <foreignObject
                x={cx - 55} y={cy < AXIS_Y ? cy - r - 42 : cy + r + 4}
                width={110} height={38}
              >
                <div xmlns="http://www.w3.org/1999/xhtml" style={{
                  fontSize: 9, color: isHov ? "rgba(200,180,255,1)" : "rgba(180,200,230,0.7)",
                  textAlign: "center", lineHeight: 1.35, fontFamily: "'Space Grotesk', system-ui",
                  overflow: "hidden", display: "-webkit-box",
                  WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                }}>
                  {paper.title}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 12, left: 16, zIndex: 5,
        display: "flex", gap: 14, fontSize: 10, color: "rgba(107,127,163,0.7)",
        fontFamily: "'Space Grotesk', system-ui",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#7c4dff", display: "inline-block" }} />
          Paper — circle size = citations
        </span>
        <span style={{ opacity: 0.5 }}>Click any paper to inspect</span>
      </div>
    </div>
  );
}
