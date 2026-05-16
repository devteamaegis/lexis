import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import StarfieldCanvas from "./StarfieldCanvas.jsx";
import NodePopup       from "./NodePopup.jsx";
import RightPanel      from "./RightPanel.jsx";
import VoiceAgent      from "./VoiceAgent.jsx";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const WS  = API.replace(/^http/, "ws") + "/ws";

// ─── Export helpers ───────────────────────────────────────────────────────────
function buildMarkdown({ query, stats, gaps, synthesis, allNodes }) {
  const papers = [...allNodes.filter(n => n.kind === "Paper")]
    .sort((a, b) => (b.citation_count ?? 0) - (a.citation_count ?? 0));
  const topics = allNodes.filter(n => n.kind === "Topic");
  const date   = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return [
    `# Lexis Research Report`,
    ``,
    `**Query:** ${query}  `,
    `**Date:** ${date}`,
    ``,
    `## Executive Summary`,
    ``,
    synthesis || "_Run a query to generate a synthesis._",
    ``,
    `## Research Gaps`,
    ``,
    ...(gaps.length ? gaps.map((g, i) => [
      `### Gap ${i + 1}`,
      `**Confidence:** ${((g.confidence ?? 0) * 100).toFixed(0)}%`,
      `**Finding:** ${g.description}`,
      `**Suggested direction:** ${g.suggested_direction}`,
      `**Adjacent papers:** ${(g.adjacent_pmids ?? []).map(p => `PMID:${p}`).join(", ")}`,
      ``,
    ].join("\n")) : ["_No research gaps detected._"]),
    ``,
    `## Literature Graph`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Papers | ${stats.papers} |`,
    `| Topics | ${stats.topics} |`,
    `| Gaps   | ${stats.gaps} |`,
    `| Connections | ${stats.connections ?? 0} |`,
    ``,
    `## Papers Analyzed`,
    ``,
    `| Rank | Title | Authors | Year | Journal | Citations | PMID | Link |`,
    `|------|-------|---------|------|---------|-----------|------|------|`,
    ...papers.map((p, i) =>
      `| ${i + 1} | ${p.title} | ${p.authors?.[0] ?? "—"} | ${p.year || "—"} | ${p.journal || "—"} | ${p.citation_count ?? 0} | ${p.id} | [PubMed](https://pubmed.ncbi.nlm.nih.gov/${p.id}) |`
    ),
    ``,
    `## Semantic Clusters`,
    ``,
    ...topics.map(t => `- **#${t.keyword}** — ${t.paper_count} paper${t.paper_count !== 1 ? "s" : ""}`),
  ].join("\n");
}

function downloadBlob(content, filename, mime = "text/markdown") {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Canvas draw functions ────────────────────────────────────────────────────
function makeDrawNode(selectedId) {
  return function drawNode(node, ctx, globalScale) {
    const { x, y, kind } = node;
    const isSelected = node.id === selectedId;
    const t = Date.now();

    ctx.save();

    if (kind === "Paper") {
      const r = 6 + Math.min(Math.sqrt((node.citation_count ?? 0)) * 0.9, 12);
      // Glow
      ctx.shadowBlur  = isSelected ? 40 : 20;
      ctx.shadowColor = "#7c4dff";
      // Radial gradient fill
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "#c9b8ff");
      grad.addColorStop(1, "#7c4dff");
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 4-point star spike
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = "#e8e0ff";
      ctx.lineWidth   = 0.8 / globalScale;
      const sp = r * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y - sp); ctx.lineTo(x, y + sp);
      ctx.moveTo(x - sp, y); ctx.lineTo(x + sp, y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Selected ring
      if (isSelected) {
        const pulse = 1 + 0.15 * Math.sin(t * 0.004);
        ctx.beginPath();
        ctx.arc(x, y, r * pulse + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(124,77,255,0.6)";
        ctx.lineWidth   = 1.5 / globalScale;
        ctx.stroke();
      }

    } else if (kind === "Topic") {
      const r = 9;
      ctx.shadowBlur  = 25;
      ctx.shadowColor = "#00bfa5";
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "#80cbc4");
      grad.addColorStop(1, "#00796b");
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Orbiting dots representing connected papers
      ctx.fillStyle = "rgba(178,223,219,0.6)";
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const ox = x + Math.cos(angle) * 14;
        const oy = y + Math.sin(angle) * 14;
        ctx.beginPath();
        ctx.arc(ox, oy, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      // Label when zoomed in
      if (globalScale > 0.6) {
        ctx.shadowBlur = 0;
        ctx.font = `${10 / globalScale}px 'Space Grotesk', system-ui`;
        ctx.fillStyle   = "var(--accent-teal, #00bfa5)";
        ctx.textAlign   = "center";
        ctx.fillText(node.keyword ?? "", x, y + r + 10 / globalScale);
      }

    } else if (kind === "ResearchGap") {
      const pulse = 7 + 3 * Math.sin(t * 0.003);
      // Outer dashed exclusion zone
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth   = 0.5 / globalScale;
      ctx.stroke();
      ctx.setLineDash([]);

      // Rotating ring of dots
      const ringR = 18;
      const dotAngle = (t * 0.001) % (Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < 8; i++) {
        const a = dotAngle + (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * ringR, y + Math.sin(a) * ringR, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Glow + fill
      ctx.shadowBlur  = 35;
      ctx.shadowColor = "rgba(255,255,255,0.9)";
      const grad = ctx.createRadialGradient(x, y, 0, x, y, pulse);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, "rgba(200,220,255,0.8)");
      ctx.beginPath();
      ctx.arc(x, y, pulse, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 8-point star (two overlapping 4-point crosses at 45° offset)
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth   = 0.8 / globalScale;
      for (const offset of [0, Math.PI / 4]) {
        const sp = pulse * 1.7;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(offset) * sp, y + Math.sin(offset) * sp);
        ctx.lineTo(x - Math.cos(offset) * sp, y - Math.sin(offset) * sp);
        ctx.moveTo(x + Math.cos(offset + Math.PI / 2) * sp, y + Math.sin(offset + Math.PI / 2) * sp);
        ctx.lineTo(x - Math.cos(offset + Math.PI / 2) * sp, y - Math.sin(offset + Math.PI / 2) * sp);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  };
}

function drawLink(link, ctx, globalScale, hoveredRef) {
  const src = typeof link.source === "object" ? link.source : { x: 0, y: 0 };
  const dst = typeof link.target === "object" ? link.target : { x: 0, y: 0 };
  const isHovered = hoveredRef?.current === link;

  ctx.save();

  if (link.kind === "Cites") {
    // Bold amber line with a flowing particle
    ctx.globalAlpha = isHovered ? 1 : 0.85;
    ctx.strokeStyle = isHovered ? "#ffd080" : "#ffab40";
    ctx.lineWidth   = isHovered ? 2.5 : 1.5;
    ctx.setLineDash([]);
    if (isHovered) { ctx.shadowBlur = 12; ctx.shadowColor = "#ffab40"; }
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(dst.x, dst.y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Arrowhead at destination
    const angle = Math.atan2(dst.y - src.y, dst.x - src.x);
    const aLen  = 6;
    ctx.fillStyle = "#ffab40";
    ctx.beginPath();
    ctx.moveTo(dst.x, dst.y);
    ctx.lineTo(dst.x - aLen * Math.cos(angle - 0.4), dst.y - aLen * Math.sin(angle - 0.4));
    ctx.lineTo(dst.x - aLen * Math.cos(angle + 0.4), dst.y - aLen * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();

    // Flowing particle
    const offset = link.__particleOffset ?? 0;
    const t = ((Date.now() / 3000) + offset) % 1;
    const px = src.x + (dst.x - src.x) * t;
    const py = src.y + (dst.y - src.y) * t;
    ctx.shadowBlur  = 8;
    ctx.shadowColor = "#ffab40";
    ctx.fillStyle   = "rgba(255,171,64,0.9)";
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

  } else if (link.kind === "HasTopic") {
    // Teal connection from paper to topic — clearly visible
    ctx.globalAlpha = isHovered ? 1 : 0.55;
    ctx.strokeStyle = isHovered ? "rgba(0,230,200,0.9)" : "rgba(0,191,165,0.75)";
    ctx.lineWidth   = isHovered ? 2 : 1.2;
    ctx.setLineDash([4, 4]);
    if (isHovered) { ctx.shadowBlur = 10; ctx.shadowColor = "#00bfa5"; }
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(dst.x, dst.y);
    ctx.stroke();
    ctx.shadowBlur = 0;

  } else if (link.kind === "NearGap") {
    // White dashed gap connection
    ctx.globalAlpha = isHovered ? 0.8 : 0.45;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth   = isHovered ? 1.5 : 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(dst.x, dst.y);
    ctx.stroke();

  } else if (link.kind === "Semantic") {
    // Cyan semantic similarity edge
    ctx.globalAlpha = isHovered ? 1 : 0.5;
    ctx.strokeStyle = isHovered ? "rgba(100,220,255,0.9)" : "rgba(79,195,247,0.65)";
    ctx.lineWidth   = isHovered ? 2 : 1;
    ctx.setLineDash([5, 3]);
    if (isHovered) { ctx.shadowBlur = 10; ctx.shadowColor = "#4fc3f7"; }
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(dst.x, dst.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.setLineDash([]);
  ctx.restore();
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [query,        setQuery]        = useState("AMD early detection retinal imaging");
  const [status,       setStatus]       = useState("idle");
  const [gaps,         setGaps]         = useState([]);
  const [log,          setLog]          = useState([]);
  const [synthesis,    setSynthesis]    = useState("");
  const [stats,        setStats]        = useState({ papers: 0, topics: 0, gaps: 0, connections: 0 });
  const [yearRange,    setYearRange]    = useState([1990, new Date().getFullYear()]);
  const [dataYears,    setDataYears]    = useState([1990, new Date().getFullYear()]);
  const [showSemantic, setShowSemantic] = useState(true);
  const [sensitivity,  setSensitivity]  = useState(1); // 0=loose, 1=balanced, 2=strict
  const [popup,        setPopup]        = useState(null); // { node, screenPos }
  const [graphVersion, setGraphVersion] = useState(0);
  const [edgeTip,      setEdgeTip]      = useState(null); // { x, y, summary, loading, kind }
  const edgeTipTimer   = useRef(null);

  const graphRef      = useRef();
  const wsRef         = useRef(null);
  const graphWrap     = useRef();
  const hoveredLinkRef = useRef(null);
  const allNodesRef   = useRef([]);
  const allLinksRef   = useRef([]);
  const nodeIds       = useRef(new Set());
  const edgeIds       = useRef(new Set());
  const [graphDims,   setGraphDims]   = useState({ w: 800, h: 600 });
  const firstNodeRef   = useRef(false);   // track whether we've zoomed to fit yet
  const forcesSet      = useRef(false);   // ensure we configure d3 forces once per simulation

  const sensitivityLabels  = ["Loose", "Balanced", "Strict"];
  const sensitivityThresh  = [4, 2, 1];

  // ─── Track container size for ForceGraph2D ────────────────────────────────
  useEffect(() => {
    if (!graphWrap.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setGraphDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(graphWrap.current);
    return () => ro.disconnect();
  }, []);

  // ─── Filtered graph ────────────────────────────────────────────────────────
  const graphData = useMemo(() => {
    const [minY, maxY] = yearRange;
    const visibleIds = new Set(
      allNodesRef.current
        .filter(n => n.kind !== "Paper" || !n.year || (n.year >= minY && n.year <= maxY))
        .map(n => n.id)
    );
    const links = allLinksRef.current.filter(l => {
      if (!showSemantic && l.kind === "Semantic") return false;
      const src = typeof l.source === "object" ? l.source.id : l.source;
      const dst = typeof l.target === "object" ? l.target.id : l.target;
      return visibleIds.has(src) && visibleIds.has(dst);
    });
    return {
      nodes: allNodesRef.current.filter(n => visibleIds.has(n.id)),
      links,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearRange, graphVersion, showSemantic]);

  const addNode = useCallback((node) => {
    if (nodeIds.current.has(node.id)) return;
    nodeIds.current.add(node.id);

    // Pre-assign spread positions so nodes don't collapse at origin.
    // Papers: inner ring, Topics: mid ring, Gaps: outer ring.
    const idx   = allNodesRef.current.length;
    const angle  = (idx * 2.399963) % (Math.PI * 2);   // golden-angle spiral
    const radii  = { Paper: 180, Topic: 340, ResearchGap: 500 };
    const base   = radii[node.kind] ?? 250;
    const jitter = (Math.random() - 0.5) * 80;
    const nodeWithPos = {
      ...node,
      x: Math.cos(angle) * (base + jitter),
      y: Math.sin(angle) * (base + jitter),
    };

    allNodesRef.current = [...allNodesRef.current, nodeWithPos];

    if (node.kind === "Paper" && node.year > 0) {
      setDataYears(([mn, mx]) => [Math.min(mn, node.year), Math.max(mx, node.year)]);
      setYearRange(([mn, mx]) => [Math.min(mn, node.year), Math.max(mx, node.year)]);
    }
    setStats(prev => ({
      ...prev,
      papers: node.kind === "Paper"       ? prev.papers + 1 : prev.papers,
      topics: node.kind === "Topic"       ? prev.topics + 1 : prev.topics,
      gaps:   node.kind === "ResearchGap" ? prev.gaps + 1   : prev.gaps,
    }));
    setGraphVersion(v => v + 1);

    // Zoom to fit after the first few papers land
    if (!firstNodeRef.current && node.kind === "Paper") {
      firstNodeRef.current = true;
      setTimeout(() => graphRef.current?.zoomToFit(800, 80), 1200);
    }
  }, []);

  const addEdge = useCallback((edge) => {
    const id = `${edge.src}→${edge.dst}`;
    if (edgeIds.current.has(id)) return;
    edgeIds.current.add(id);
    const link = {
      source: edge.src,
      target: edge.dst,
      kind:   edge.kind,
      __particleOffset: Math.random(),
    };
    allLinksRef.current = [...allLinksRef.current, link];
    setStats(prev => ({ ...prev, connections: prev.connections + 1 }));
    setGraphVersion(v => v + 1);
  }, []);

  // ─── WebSocket ─────────────────────────────────────────────────────────────
  const reconnectTimer = useRef(null);

  const connectWS = useCallback(() => {
    // Don't open a second connection if one is already open/connecting
    if (wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
         wsRef.current.readyState === WebSocket.CONNECTING)) return;

    const ws = new WebSocket(WS);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.event === "node") {
        addNode({ ...msg });
        setLog(prev => [`+ ${msg.kind}: ${msg.title ?? msg.keyword ?? msg.description ?? msg.id}`, ...prev.slice(0, 50)]);
      }
      if (msg.event === "patch" && msg.kind === "Paper") {
        const node = allNodesRef.current.find(n => n.id === msg.id);
        if (node) {
          node.citation_count = msg.citation_count;
          setGraphVersion(v => v + 1);
        }
      }
      if (msg.event === "edge") addEdge(msg);
      if (msg.event === "node" && msg.kind === "ResearchGap") setGaps(prev => [...prev, msg]);
      if (msg.event === "done") {
        setStatus("done");
        if (msg.synthesis) setSynthesis(msg.synthesis);
        setLog(prev => [`✓ Complete — ${msg.gaps} gaps found`, ...prev]);
        // Re-apply forces + reheat once all data is in, then fit view
        setTimeout(() => {
          configureForces(true);
          setTimeout(() => graphRef.current?.zoomToFit(700, 80), 1500);
        }, 200);
      }
      if (msg.event === "started") {
        setStatus("running");
        setLog(prev => [`▶ Query: ${msg.query}`, ...prev]);
      }
      if (msg.event === "error") {
        setStatus("error");
        setLog(prev => [`✗ ${msg.message}`, ...prev]);
      }
    };

    ws.onclose = () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connectWS, 2000);
    };
  }, [addNode, addEdge]);

  useEffect(() => {
    connectWS();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Run query ─────────────────────────────────────────────────────────────
  const runQuery = useCallback(async (q) => {
    const queryToRun = q ?? query;
    if (q) setQuery(q);
    allNodesRef.current = [];
    allLinksRef.current = [];
    nodeIds.current.clear();
    edgeIds.current.clear();
    setGaps([]);
    setSynthesis("");
    setStats({ papers: 0, topics: 0, gaps: 0, connections: 0 });
    setDataYears([1990, new Date().getFullYear()]);
    setYearRange([1990, new Date().getFullYear()]);
    setPopup(null);
    setStatus("running");
    firstNodeRef.current = false;
    setGraphVersion(v => v + 1);
    await fetch(`${API}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: queryToRun, max_papers: 25 }),
    });
  }, [query]);

  const resetGraph = useCallback(() => {
    allNodesRef.current = [];
    allLinksRef.current = [];
    nodeIds.current.clear();
    edgeIds.current.clear();
    setGaps([]); setSynthesis(""); setPopup(null);
    setStats({ papers: 0, topics: 0, gaps: 0, connections: 0 });
    setStatus("idle");
    setGraphVersion(v => v + 1);
  }, []);

  // ─── Node expansion ────────────────────────────────────────────────────────
  const expandNode = useCallback(async (pmid) => {
    setLog(prev => [`↗ Expanding PMID:${pmid}…`, ...prev]);
    const resp = await fetch(`${API}/expand`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pmid, session_id: "default" }),
    });
    const data = await resp.json();
    (data.events ?? []).forEach(ev => {
      if (ev.event === "node") addNode({ ...ev });
      if (ev.event === "edge") addEdge(ev);
    });
  }, [addNode, addEdge]);

  // ─── Re-detect gaps with new sensitivity ──────────────────────────────────
  const redetectGaps = useCallback(async (idx) => {
    const threshold = sensitivityThresh[idx];
    setLog(prev => [`⟳ Re-detecting gaps (threshold=${threshold})…`, ...prev]);
    // Remove old gap nodes/edges from allNodesRef
    allNodesRef.current = allNodesRef.current.filter(n => n.kind !== "ResearchGap");
    allLinksRef.current = allLinksRef.current.filter(l => l.kind !== "NearGap");
    edgeIds.current = new Set([...edgeIds.current].filter(id => !id.startsWith("gap_")));
    const gapIds = new Set([...nodeIds.current].filter(id => id.startsWith("gap_")));
    gapIds.forEach(id => nodeIds.current.delete(id));
    setGaps([]);
    setStats(prev => ({ ...prev, gaps: 0 }));
    setGraphVersion(v => v + 1);

    const resp = await fetch(`${API}/redetect-gaps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "default", threshold }),
    });
    const data = await resp.json();
    (data.events ?? []).forEach(ev => {
      if (ev.event === "node" && ev.kind === "ResearchGap") {
        addNode({ ...ev });
        setGaps(prev => [...prev, ev]);
      }
      if (ev.event === "edge") addEdge(ev);
    });
  }, [addNode, addEdge, sensitivityThresh]);

  // ─── Node click — show popup ───────────────────────────────────────────────
  const handleNodeClick = useCallback((node) => {
    if (!graphRef.current) return;
    const screenPos = graphRef.current.graph2ScreenCoords(node.x, node.y);
    const wrapRect  = graphWrap.current?.getBoundingClientRect();
    setPopup({
      node,
      screenPos: {
        x: screenPos.x + (wrapRect?.left ?? 0),
        y: screenPos.y + (wrapRect?.top  ?? 0),
      },
    });
  }, []);

  // ─── Gap click → fly camera ────────────────────────────────────────────────
  const handleGapClick = useCallback((gap, i) => {
    const gapNode = allNodesRef.current.find(n => n.id === `gap_${i + 1}`);
    if (gapNode && graphRef.current) {
      graphRef.current.centerAt(gapNode.x, gapNode.y, 600);
      graphRef.current.zoom(2.5, 600);
    }
  }, []);

  // ─── Paper click → fly camera ─────────────────────────────────────────────
  const handlePaperClick = useCallback((paper) => {
    const node = allNodesRef.current.find(n => n.id === paper.id);
    if (node && graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 600);
      graphRef.current.zoom(3, 600);
      handleNodeClick(node);
    }
  }, [handleNodeClick]);

  // ─── Edge hover — AI connection summary ───────────────────────────────────
  const handleLinkHover = useCallback((link, prevLink) => {
    // Clear any pending fetch timer
    if (edgeTipTimer.current) clearTimeout(edgeTipTimer.current);
    hoveredLinkRef.current = link;

    if (!link) {
      setEdgeTip(null);
      return;
    }

    // Only show for Paper–Paper links (Cites / Semantic)
    const srcId = typeof link.source === "object" ? link.source.id : link.source;
    const dstId = typeof link.target === "object" ? link.target.id : link.target;
    const srcNode = allNodesRef.current.find(n => n.id === srcId);
    const dstNode = allNodesRef.current.find(n => n.id === dstId);
    if (!srcNode || srcNode.kind !== "Paper" || !dstNode || dstNode.kind !== "Paper") {
      setEdgeTip(null);
      return;
    }

    // Place tooltip at midpoint of edge in screen coords
    const midX = ((srcNode.x ?? 0) + (dstNode.x ?? 0)) / 2;
    const midY = ((srcNode.y ?? 0) + (dstNode.y ?? 0)) / 2;
    const screen = graphRef.current?.graph2ScreenCoords(midX, midY);
    const wrapRect = graphWrap.current?.getBoundingClientRect();
    const tx = (screen?.x ?? 0) + (wrapRect?.left ?? 0);
    const ty = (screen?.y ?? 0) + (wrapRect?.top  ?? 0);

    // Show loading state immediately
    setEdgeTip({ x: tx, y: ty, summary: null, loading: true, kind: link.kind });

    // Debounce — wait 300 ms before firing the request (avoids flicker on fast traversal)
    edgeTipTimer.current = setTimeout(async () => {
      try {
        const resp = await fetch(`${API}/edge-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pmid_a: srcId, pmid_b: dstId, session_id: "default" }),
        });
        const data = await resp.json();
        setEdgeTip(prev => prev ? { ...prev, summary: data.summary, loading: false } : null);
      } catch {
        setEdgeTip(prev => prev ? { ...prev, summary: "Connection summary unavailable.", loading: false } : null);
      }
    }, 300);
  }, []);

  // ─── Export ────────────────────────────────────────────────────────────────
  const exportMarkdown = useCallback(() => {
    const md = buildMarkdown({ query, stats, gaps, synthesis, allNodes: allNodesRef.current });
    downloadBlob(md, `lexis-report-${Date.now()}.md`);
  }, [query, stats, gaps, synthesis]);

  const exportJSON = useCallback(() => {
    const data = {
      query, stats, synthesis,
      nodes: allNodesRef.current,
      edges: allLinksRef.current.map(l => ({
        src: typeof l.source === "object" ? l.source.id : l.source,
        dst: typeof l.target === "object" ? l.target.id : l.target,
        kind: l.kind,
      })),
      gaps,
    };
    downloadBlob(JSON.stringify(data, null, 2), `lexis-graph-${Date.now()}.json`, "application/json");
  }, [query, stats, synthesis, gaps]);

  // ─── d3 force configuration ───────────────────────────────────────────────
  const configureForces = useCallback((andReheat = false) => {
    const fg = graphRef.current;
    if (!fg) return;
    try {
      fg.d3Force('charge')?.strength(-260);
      fg.d3Force('link')
        ?.distance(link => link.kind === 'HasTopic' ? 90 : link.kind === 'Cites' ? 130 : 110)
        .strength(link => link.kind === 'HasTopic' ? 0.2 : 0.35);
      if (andReheat) fg.d3ReheatSimulation?.();
    } catch (e) { /* ignore if forces not ready */ }
  }, []);

  // Apply forces shortly after mount so ForceGraph2D is initialised
  useEffect(() => {
    const t = setTimeout(() => configureForces(false), 300);
    return () => clearTimeout(t);
  }, [configureForces]);

  // ─── Canvas draw (memoized on selected node) ───────────────────────────────
  const selectedId   = popup?.node?.id ?? null;
  const drawNode     = useMemo(() => makeDrawNode(selectedId), [selectedId]);
  const drawLinkCb   = useCallback((link, ctx, scale) => drawLink(link, ctx, scale, hoveredLinkRef), []);

  const papers = allNodesRef.current.filter(n => n.kind === "Paper");
  const [minY, maxY]     = yearRange;
  const [dataMin, dataMax] = dataYears;

  // ─── Status chip style ────────────────────────────────────────────────────
  const statusStyle = {
    idle:    { bg: "rgba(42,58,92,0.5)",   color: "var(--star-dim)" },
    running: { bg: "rgba(255,171,64,0.15)", color: "var(--accent-amber)" },
    done:    { bg: "rgba(0,191,165,0.15)",  color: "var(--accent-teal)" },
    error:   { bg: "rgba(229,115,115,0.15)", color: "#e57373" },
  }[status] ?? { bg: "transparent", color: "var(--star-dim)" };

  return (
    <div style={{ display: "grid", gridTemplateRows: "56px 1fr 64px", height: "100vh", background: "var(--space-void)", fontFamily: "'Space Grotesk', system-ui, sans-serif", color: "var(--star-white)", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 20px", background: "rgba(2,4,8,0.9)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--star-faint)", zIndex: 10 }}>

        {/* Logo */}
        <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: "0.3em", color: "var(--accent-aurora)", flexShrink: 0 }}>LEXIS</span>

        {/* Query badge */}
        <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: "rgba(79,195,247,0.1)", color: "var(--accent-aurora)", border: "1px solid rgba(79,195,247,0.25)", flexShrink: 0 }}>
          {query.length > 38 ? query.slice(0, 38) + "…" : query}
        </span>

        {/* Year filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--star-dim)" }}>
          <span>Year</span>
          {[{ val: minY, onChange: v => setYearRange([+v, maxY]), min: dataMin, max: maxY - 1 },
            { val: maxY, onChange: v => setYearRange([minY, +v]), min: minY + 1, max: dataMax }
          ].map((p, i) => (
            <input key={i} type="number" value={p.val} min={p.min} max={p.max}
              onChange={e => p.onChange(e.target.value)}
              style={{ width: 54, height: 24, background: "var(--space-nebula)", border: "1px solid var(--star-faint)", borderRadius: 6, padding: "0 4px", fontSize: 11, color: "var(--star-white)", textAlign: "center", outline: "none" }}
            />
          ))}
        </div>

        {/* Sensitivity slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--star-dim)" }}>
          <span style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>Sensitivity</span>
          <input type="range" min={0} max={2} value={sensitivity}
            onChange={e => {
              const v = +e.target.value;
              setSensitivity(v);
              if (status === "done") redetectGaps(v);
            }}
            style={{ width: 60, accentColor: "var(--accent-aurora)", cursor: "pointer" }}
          />
          <span style={{ color: "var(--accent-aurora)", minWidth: 44 }}>{sensitivityLabels[sensitivity]}</span>
        </div>

        {/* Semantic toggle */}
        <button
          onClick={() => setShowSemantic(v => !v)}
          style={{ fontSize: 10, padding: "3px 10px", borderRadius: 20, border: `1px solid ${showSemantic ? "rgba(79,195,247,0.4)" : "var(--star-faint)"}`, background: showSemantic ? "rgba(79,195,247,0.1)" : "transparent", color: showSemantic ? "var(--accent-aurora)" : "var(--star-dim)", cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase" }}
        >
          Semantic {showSemantic ? "ON" : "OFF"}
        </button>

        {/* Stats */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
          {[
            { n: stats.papers,  label: "papers",  color: "#7c4dff" },
            { n: stats.topics,  label: "topics",  color: "#00bfa5" },
            { n: stats.gaps,    label: "gaps",    color: "#ffffff" },
          ].map(({ n, label, color }) => (
            <span key={label} style={{ color: "var(--star-dim)" }}>
              <strong style={{ color, fontFamily: "'Space Mono', monospace" }}>{n}</strong> {label}
            </span>
          ))}
        </div>

        {/* Export dropdown */}
        {status === "done" && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={exportMarkdown} style={btnStyle}>Export MD ↓</button>
            <button onClick={exportJSON}     style={btnStyle}>Export JSON ↓</button>
          </div>
        )}

        {/* Status chip */}
        <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: statusStyle.bg, color: statusStyle.color, fontFamily: "'Space Mono', monospace", letterSpacing: "0.04em" }}>
          {status}
        </span>
      </div>

      {/* ── Body ── */}
      <div style={{ display: "flex", overflow: "hidden", position: "relative" }}>

        {/* Graph area */}
        <div ref={graphWrap} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <StarfieldCanvas />

          <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={graphDims.w}
              height={graphDims.h}
              nodeCanvasObject={drawNode}
              nodeCanvasObjectMode={() => "replace"}
              linkCanvasObject={drawLinkCb}
              linkCanvasObjectMode={() => "replace"}
              onNodeClick={handleNodeClick}
              onLinkHover={handleLinkHover}
              backgroundColor="transparent"
              cooldownTicks={300}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              nodeLabel={() => ""}
              nodePointerAreaPaint={(node, color, ctx) => {
                const r = 6 + Math.min(Math.sqrt((node.citation_count ?? 0)) * 0.9, 12) + 6;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
                ctx.fill();
              }}
              onEngineStop={() => graphRef.current?.zoomToFit(500, 60)}
            />
          </div>

          {/* Popup */}
          {popup && (
            <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 50 }}>
              <div style={{ pointerEvents: "auto" }}>
                <NodePopup
                  node={popup.node}
                  screenPos={popup.screenPos}
                  onClose={() => setPopup(null)}
                  onExpand={expandNode}
                  allNodes={allNodesRef.current}
                />
              </div>
            </div>
          )}

          {/* Edge tooltip */}
          {edgeTip && (
            <div style={{
              position: "fixed",
              left: edgeTip.x,
              top: edgeTip.y,
              transform: "translate(-50%, calc(-100% - 10px))",
              zIndex: 60,
              pointerEvents: "none",
              maxWidth: 320,
              background: "rgba(5,13,26,0.92)",
              backdropFilter: "blur(12px)",
              border: `1px solid ${edgeTip.kind === "Cites" ? "rgba(255,171,64,0.35)" : edgeTip.kind === "Semantic" ? "rgba(79,195,247,0.3)" : "rgba(0,191,165,0.3)"}`,
              borderRadius: 10,
              padding: "10px 14px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{
                  fontSize: 9,
                  fontFamily: "'Space Mono', monospace",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  padding: "2px 7px",
                  borderRadius: 20,
                  background: edgeTip.kind === "Cites" ? "rgba(255,171,64,0.15)" : edgeTip.kind === "Semantic" ? "rgba(79,195,247,0.12)" : "rgba(0,191,165,0.12)",
                  color: edgeTip.kind === "Cites" ? "#ffab40" : edgeTip.kind === "Semantic" ? "var(--accent-aurora)" : "var(--accent-teal)",
                }}>{edgeTip.kind}</span>
                <span style={{ fontSize: 10, color: "var(--star-dim)" }}>connection</span>
              </div>
              {edgeTip.loading ? (
                <div style={{ fontSize: 11, color: "var(--star-dim)", fontStyle: "italic" }}>Analyzing connection…</div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--star-white)", lineHeight: 1.55 }}>{edgeTip.summary}</div>
              )}
            </div>
          )}

          {/* Legend + node count debug */}
          <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 5, display: "flex", gap: 14, fontSize: 10, color: "var(--star-dim)", background: "rgba(5,13,26,0.8)", backdropFilter: "blur(8px)", padding: "7px 12px", borderRadius: 20, border: "1px solid var(--star-faint)", alignItems: "center" }}>
            {[["Paper", "#7c4dff"], ["Topic", "#00bfa5"], ["Gap", "#ffffff"]].map(([label, color]) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}`, display: "inline-block" }} />
                {label}
              </span>
            ))}
            <span style={{ color: "rgba(107,127,163,0.6)" }}>· size = citations</span>
            <span style={{ color: "rgba(107,127,163,0.5)", fontFamily: "'Space Mono', monospace", fontSize: 9 }}>
              {graphData.nodes.length}n / {graphData.links.length}e
            </span>
            <button
              onClick={() => {
                configureForces(true);
                setTimeout(() => graphRef.current?.zoomToFit(700, 80), 1200);
              }}
              style={{ fontSize: 9, padding: "2px 8px", borderRadius: 12, border: "1px solid rgba(79,195,247,0.3)", background: "rgba(79,195,247,0.08)", color: "var(--accent-aurora)", cursor: "pointer", letterSpacing: "0.06em" }}
            >
              ⊕ Fit
            </button>
          </div>
        </div>

        {/* Right panel */}
        <RightPanel
          stats={stats}
          synthesis={synthesis}
          log={log}
          gaps={gaps}
          papers={papers}
          onGapClick={handleGapClick}
          onPaperClick={handlePaperClick}
        />
      </div>

      {/* ── Footer ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 20px", background: "rgba(2,4,8,0.95)", backdropFilter: "blur(12px)", borderTop: "1px solid var(--star-faint)", zIndex: 10 }}>

        {/* Voice agent */}
        <VoiceAgent
          onSearch={runQuery}
          onReset={resetGraph}
          onZoom={factor => graphRef.current?.zoom(factor)}
          onFilterYear={year => setYearRange([year, dataMax])}
          selectedNode={popup?.node ?? null}
          gapCount={stats.gaps}
          paperCount={stats.papers}
          gaps={gaps}
        />

        {/* Query input */}
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && runQuery()}
          placeholder="Enter a research question or speak using the mic…"
          style={{ flex: 1, height: 36, background: "var(--space-nebula)", border: "1px solid var(--star-faint)", borderRadius: 10, padding: "0 14px", fontSize: 13, color: "var(--star-white)", outline: "none", transition: "border-color 0.2s" }}
          onFocus={e  => e.target.style.borderColor = "rgba(79,195,247,0.4)"}
          onBlur={e   => e.target.style.borderColor = "var(--star-faint)"}
        />

        {/* Run button */}
        <button
          onClick={() => runQuery()}
          disabled={status === "running"}
          style={{ height: 36, padding: "0 20px", borderRadius: 10, background: status === "running" ? "rgba(42,58,92,0.4)" : "rgba(79,195,247,0.15)", color: status === "running" ? "var(--star-dim)" : "var(--accent-aurora)", border: `1px solid ${status === "running" ? "var(--star-faint)" : "rgba(79,195,247,0.4)"}`, cursor: status === "running" ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13, letterSpacing: "0.04em", fontFamily: "'Space Grotesk', system-ui, sans-serif", transition: "all 0.2s" }}
        >
          {status === "running" ? "Running…" : "Run walker ↗"}
        </button>
      </div>
    </div>
  );
}

const btnStyle = {
  height: 28,
  padding: "0 12px",
  borderRadius: 7,
  background: "rgba(79,195,247,0.08)",
  color: "var(--accent-aurora)",
  border: "1px solid rgba(79,195,247,0.25)",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
};
