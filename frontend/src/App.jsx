import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import StarfieldCanvas from "./StarfieldCanvas.jsx";
import NodePopup       from "./NodePopup.jsx";
import RightPanel      from "./RightPanel.jsx";
import VoiceAgent      from "./VoiceAgent.jsx";
import LexisChat       from "./LexisChat.jsx";
import TimelineView    from "./TimelineView.jsx";

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

// ─── Three.js node factory (3D) ───────────────────────────────────────────────
function makeGlowSprite(color, size) {
  const mat = new THREE.SpriteMaterial({
    color,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

function buildNodeObject(node, isSelected) {
  const { kind } = node;
  const group = new THREE.Group();

  if (kind === "Paper") {
    const r = 3.5 + Math.min(Math.sqrt(node.citation_count ?? 0) * 0.55, 7);
    const geo  = new THREE.SphereGeometry(r, 20, 20);
    const mat  = new THREE.MeshPhongMaterial({
      color:            0x7c4dff,
      emissive:         0x3d1aff,
      emissiveIntensity: isSelected ? 0.8 : 0.35,
      shininess:        140,
      transparent:      true,
      opacity:          0.95,
    });
    group.add(new THREE.Mesh(geo, mat));

    // Shimmering second layer
    const outerMat = new THREE.MeshPhongMaterial({
      color: 0xc9b8ff, emissive: 0x9c7aff,
      emissiveIntensity: 0.2, shininess: 60,
      transparent: true, opacity: 0.18, wireframe: true,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(r + 0.5, 10, 10), outerMat));

    group.add(makeGlowSprite(0x7c4dff, r * 9));

    if (isSelected) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r + 3.5, 0.9, 8, 36),
        new THREE.MeshBasicMaterial({ color: 0xc9b8ff, transparent: true, opacity: 0.75 })
      );
      ring.name = "sel-ring";
      group.add(ring);
    }

  } else if (kind === "Topic") {
    const geo = new THREE.OctahedronGeometry(5.5, 0);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x00bfa5, emissive: 0x004d40, emissiveIntensity: 0.55,
      shininess: 100, transparent: true, opacity: 0.92,
    });
    group.add(new THREE.Mesh(geo, mat));

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x80cbc4, wireframe: true, transparent: true, opacity: 0.25,
    });
    group.add(new THREE.Mesh(new THREE.OctahedronGeometry(6.2, 0), wireMat));
    group.add(makeGlowSprite(0x00bfa5, 40));

    // Floating label sprite
    const canvas = document.createElement("canvas");
    canvas.width  = 256; canvas.height = 64;
    const c = canvas.getContext("2d");
    c.font = "bold 22px 'Space Grotesk', system-ui, sans-serif";
    c.fillStyle = "rgba(128,203,196,0.95)";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText((node.keyword ?? "").slice(0, 22), 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const lblMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false });
    const lbl = new THREE.Sprite(lblMat);
    lbl.scale.set(28, 7, 1);
    lbl.position.set(0, 12, 0);
    lbl.name = "label";
    group.add(lbl);

  } else if (kind === "ResearchGap") {
    const geo  = new THREE.IcosahedronGeometry(6, 0);
    const mat  = new THREE.MeshPhongMaterial({
      color: 0xffffff, emissive: 0x9090ff, emissiveIntensity: 0.55,
      shininess: 220, transparent: true, opacity: 0.93,
    });
    group.add(new THREE.Mesh(geo, mat));

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22,
    });
    group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(8, 0), wireMat));
    group.add(makeGlowSprite(0xffffff, 60));
  }

  return group;
}

function makeNodeThreeObject(selectedId) {
  return function (node) {
    const obj = buildNodeObject(node, node.id === selectedId);
    node.__threeObj = obj;   // store ref for direct pulse manipulation
    return obj;
  };
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
  const [viewMode,     setViewMode]     = useState("graph"); // "graph" | "timeline"
  const [chatTrigger,  setChatTrigger]  = useState(null);   // message to auto-send in LexisChat
  const pulsingNodesRef = useRef(new Set());
  const pulseIntervalRef = useRef(null);

  const graphRef      = useRef();
  const wsRef         = useRef(null);
  const graphWrap     = useRef();
  const allNodesRef   = useRef([]);
  const allLinksRef   = useRef([]);
  const nodeIds       = useRef(new Set());
  const edgeIds       = useRef(new Set());
  const firstNodeRef   = useRef(false);

  const sensitivityLabels  = ["Loose", "Balanced", "Strict"];
  const sensitivityThresh  = [3, 1, 0];

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
    const zSpread = { Paper: 60, Topic: 100, ResearchGap: 140 }[node.kind] ?? 80;
    const nodeWithPos = {
      ...node,
      x: Math.cos(angle) * (base + jitter),
      y: Math.sin(angle) * (base + jitter),
      z: (Math.random() - 0.5) * zSpread,
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

  // ─── Pulse nodes (gold torus ring for 3 s) — called by LexisChat ─────────────
  const pulseNodes = useCallback((ids) => {
    if (!ids?.length) return;
    ids.forEach(id => {
      pulsingNodesRef.current.add(id);
      const node = allNodesRef.current.find(n => n.id === id);
      if (node?.__threeObj) {
        const r = node.kind === "Paper"
          ? 3.5 + Math.min(Math.sqrt(node.citation_count ?? 0) * 0.55, 7)
          : 6;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(r + 9, 1.4, 8, 36),
          new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.9 })
        );
        ring.name = "pulse-ring";
        node.__threeObj.add(ring);
      }
    });

    setTimeout(() => {
      ids.forEach(id => {
        pulsingNodesRef.current.delete(id);
        const node = allNodesRef.current.find(n => n.id === id);
        if (node?.__threeObj) {
          const ring = node.__threeObj.getObjectByName("pulse-ring");
          if (ring) node.__threeObj.remove(ring);
        }
      });
    }, 3000);
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
    const screenPos = graphRef.current.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
    const wrapRect  = graphWrap.current?.getBoundingClientRect();
    setPopup({
      node,
      screenPos: {
        x: (screenPos?.x ?? 0) + (wrapRect?.left ?? 0),
        y: (screenPos?.y ?? 0) + (wrapRect?.top  ?? 0),
      },
    });
  }, []);

  // ─── Gap click → fly camera ────────────────────────────────────────────────
  const handleGapClick = useCallback((gap, i) => {
    const gapNode = allNodesRef.current.find(n => n.id === `gap_${i + 1}`);
    if (gapNode && graphRef.current) {
      graphRef.current.cameraPosition(
        { x: gapNode.x, y: gapNode.y, z: (gapNode.z ?? 0) + 120 },
        { x: gapNode.x, y: gapNode.y, z: gapNode.z ?? 0 },
        600
      );
    }
  }, []);

  // ─── Paper click → fly camera ─────────────────────────────────────────────
  const handlePaperClick = useCallback((paper) => {
    const node = allNodesRef.current.find(n => n.id === paper.id);
    if (node && graphRef.current) {
      graphRef.current.cameraPosition(
        { x: node.x, y: node.y, z: (node.z ?? 0) + 100 },
        { x: node.x, y: node.y, z: node.z ?? 0 },
        600
      );
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
    const midZ = ((srcNode.z ?? 0) + (dstNode.z ?? 0)) / 2;
    const screen = graphRef.current?.graph2ScreenCoords(midX, midY, midZ);
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
      fg.d3Force('charge')?.strength(-280);
      fg.d3Force('link')
        ?.distance(link => link.kind === 'HasTopic' ? 80 : link.kind === 'Cites' ? 120 : 100)
        .strength(link => link.kind === 'HasTopic' ? 0.18 : 0.32);
      // z-axis spread so graph uses full 3D depth
      const zbody = fg.d3Force('z');
      if (!zbody) {
        const sim = fg.d3Force('charge');
        // add a mild z-centering force via the simulation directly
        try {
          fg.d3Force('z', null); // no-op if unsupported
        } catch (_) {}
      }
      if (andReheat) fg.d3ReheatSimulation?.();
    } catch (e) { /* ignore if forces not ready */ }
  }, []);

  // Apply forces + scene lighting shortly after mount
  useEffect(() => {
    const t = setTimeout(() => {
      configureForces(false);
      // Add richer lighting to the Three.js scene
      const scene = graphRef.current?.scene?.();
      if (scene) {
        // Remove default lights if any, then add our own
        const toRemove = [];
        scene.traverse(obj => { if (obj.isLight) toRemove.push(obj); });
        toRemove.forEach(l => scene.remove(l));

        const ambient = new THREE.AmbientLight(0x1a1040, 2.2);
        scene.add(ambient);

        const key = new THREE.DirectionalLight(0xc9b8ff, 3.5);
        key.position.set(200, 300, 200);
        scene.add(key);

        const fill = new THREE.DirectionalLight(0x00bfa5, 1.8);
        fill.position.set(-200, -100, 100);
        scene.add(fill);

        const rim = new THREE.DirectionalLight(0xffffff, 1.2);
        rim.position.set(0, -300, -200);
        scene.add(rim);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [configureForces]);

  // ─── Canvas draw (memoized on selected node) ───────────────────────────────
  const selectedId      = popup?.node?.id ?? null;
  const nodeThreeObject = useMemo(() => makeNodeThreeObject(selectedId), [selectedId]);

  const linkColor   = useCallback(l =>
    l.kind === "Cites" ? "#ffab40" : l.kind === "HasTopic" ? "#00bfa5" :
    l.kind === "NearGap" ? "#ffffff" : "#4fc3f7", []);
  const linkWidth   = useCallback(l => l.kind === "Cites" ? 1.5 : 0.5, []);
  const linkOpacity = useCallback(l =>
    l.kind === "Cites" ? 0.8 : l.kind === "HasTopic" ? 0.25 :
    l.kind === "NearGap" ? 0.2 : 0.35, []);

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
            <button
              onClick={() => setChatTrigger(
                "What is the most counterintuitive or surprising research gap in this graph? Pick exactly one gap, name it clearly, and explain in 2–3 sentences why it would surprise a scientist."
              )}
              style={{ ...btnStyle, background: "rgba(255,171,64,0.12)", borderColor: "rgba(255,171,64,0.4)", color: "#ffab40" }}
              title="AI picks the most surprising gap"
            >✦ Surprise me</button>
            <button
              onClick={() => setViewMode(v => v === "graph" ? "timeline" : "graph")}
              style={{ ...btnStyle, background: viewMode === "timeline" ? "rgba(0,191,165,0.15)" : "transparent", borderColor: viewMode === "timeline" ? "rgba(0,191,165,0.5)" : "var(--star-faint)", color: viewMode === "timeline" ? "var(--accent-teal)" : "var(--star-dim)" }}
              title="Switch between graph and timeline view"
            >{viewMode === "graph" ? "📅 Timeline" : "⬡ Graph"}</button>
          </div>
        )}

        {/* Status chip */}
        <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: statusStyle.bg, color: statusStyle.color, fontFamily: "'Space Mono', monospace", letterSpacing: "0.04em" }}>
          {status}
        </span>
      </div>

      {/* ── Body ── */}
      <div style={{ display: "flex", overflow: "hidden", position: "relative" }}>

        {/* Graph / Timeline area */}
        <div ref={graphWrap} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <StarfieldCanvas />

          {/* ── Timeline view ── */}
          {viewMode === "timeline" && (
            <div style={{ position: "absolute", inset: 0, zIndex: 2 }}>
              <TimelineView
                nodes={allNodesRef.current}
                onNodeClick={handleNodeClick}
              />
            </div>
          )}

          <div style={{ position: "absolute", inset: 0, zIndex: 1, display: viewMode === "timeline" ? "none" : "block" }}>
            <ForceGraph3D
              ref={graphRef}
              graphData={graphData}
              nodeThreeObject={nodeThreeObject}
              nodeThreeObjectExtend={false}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkOpacity={linkOpacity}
              linkDirectionalParticles={l => l.kind === "Cites" ? 3 : 0}
              linkDirectionalParticleColor={() => "#ffab40"}
              linkDirectionalParticleWidth={1.8}
              linkDirectionalParticleSpeed={0.004}
              onNodeClick={handleNodeClick}
              onLinkHover={handleLinkHover}
              backgroundColor="#00000000"
              cooldownTicks={220}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.28}
              nodeLabel={node => node.title ?? node.keyword ?? node.description ?? ""}
              onEngineStop={() => { if (status === "done") graphRef.current?.zoomToFit(500, 80); }}
              enableNodeDrag={true}
              showNavInfo={false}
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
                setTimeout(() => graphRef.current?.zoomToFit(700, 100), 1200);
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

      {/* ── Lexis AI chat ── */}
      <LexisChat
        selectedNode={popup?.node ?? null}
        sessionId="default"
        synthesis={synthesis}
        gaps={gaps}
        initialMessage={chatTrigger}
        onInitialMessageSent={() => setChatTrigger(null)}
        onPulseNodes={pulseNodes}
      />

      {/* ── Footer ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 20px", background: "rgba(2,4,8,0.95)", backdropFilter: "blur(12px)", borderTop: "1px solid var(--star-faint)", zIndex: 10 }}>

        {/* Voice agent */}
        <VoiceAgent
          onSearch={runQuery}
          onReset={resetGraph}
          onZoom={factor => {
              const cam = graphRef.current?.cameraPosition();
              if (cam) graphRef.current?.cameraPosition({ ...cam, z: cam.z / factor }, undefined, 300);
            }}
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
