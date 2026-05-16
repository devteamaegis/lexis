/**
 * LexisChat — conversational AI widget that reasons about the current graph session.
 * Voice-in, streaming text + voice-out, context-aware of selected nodes.
 */
import { useState, useRef, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ─── Animated orb (pulsing/rippling per mode) ────────────────────────────────
function LexisOrb({ mode, size = 52 }) {
  const canvasRef = useRef();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = size;
    canvas.width = s; canvas.height = s;
    let frame = 0;
    let animId;

    const palette = {
      idle:      ["#7c4dff", "#b39ddb"],
      listening: ["#00bfa5", "#80cbc4"],
      thinking:  ["#ffab40", "#ffe082"],
      speaking:  ["#4fc3f7", "#b3e5fc"],
      error:     ["#ef5350", "#ef9a9a"],
    };

    function draw() {
      ctx.clearRect(0, 0, s, s);
      const [c1, c2] = palette[mode] ?? palette.idle;
      const cx = s / 2;
      const pulse = 1 + 0.1 * Math.sin(frame * 0.07);
      const r = (s / 2 - 6) * pulse;

      // Outer glow ring
      ctx.beginPath();
      ctx.arc(cx, cx, r + 7, 0, Math.PI * 2);
      ctx.fillStyle = c1 + "28";
      ctx.fill();

      // Ripple for listening
      if (mode === "listening") {
        const ripR = ((frame * 2.5) % (s / 2));
        ctx.beginPath();
        ctx.arc(cx, cx, ripR, 0, Math.PI * 2);
        ctx.strokeStyle = c2 + "55";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Core orb
      const grad = ctx.createRadialGradient(cx - r * 0.2, cx - r * 0.2, r * 0.05, cx, cx, r);
      grad.addColorStop(0, c2);
      grad.addColorStop(0.6, c1);
      grad.addColorStop(1, c1 + "cc");
      ctx.beginPath();
      ctx.arc(cx, cx, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.shadowBlur = 18;
      ctx.shadowColor = c1;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Thinking dots
      if (mode === "thinking") {
        for (let i = 0; i < 3; i++) {
          const a = (frame * 0.05 + (i * Math.PI * 2) / 3);
          const dx = cx + Math.cos(a) * (r * 0.55);
          const dy = cx + Math.sin(a) * (r * 0.55);
          ctx.beginPath();
          ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = "#fff8";
          ctx.fill();
        }
      }

      frame++;
      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [mode, size]);

  return <canvas ref={canvasRef} style={{ borderRadius: "50%", display: "block" }} />;
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────
function Chip({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "rgba(124,77,255,0.1)", border: "1px solid rgba(124,77,255,0.3)",
        borderRadius: 8, padding: "6px 10px", fontSize: 11, color: "#c9b8ff",
        cursor: "pointer", textAlign: "left", letterSpacing: "0.02em",
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        transition: "background 0.15s",
      }}
      onMouseEnter={e => e.target.style.background = "rgba(124,77,255,0.22)"}
      onMouseLeave={e => e.target.style.background = "rgba(124,77,255,0.1)"}
    >
      {label}
    </button>
  );
}

// ─── Extract PMIDs from text ──────────────────────────────────────────────────
function extractPmids(text) {
  // Match explicit "PMID:12345678" or bare 7-8 digit sequences
  const matches = [...text.matchAll(/(?:PMID:?|pmid:?)?\b(\d{7,8})\b/g)];
  return [...new Set(matches.map(m => m[1]))];
}

// ─── Main chat widget ─────────────────────────────────────────────────────────
export default function LexisChat({
  selectedNode,
  sessionId = "default",
  synthesis,
  gaps,
  initialMessage = null,
  onInitialMessageSent = null,
  onPulseNodes = null,
}) {
  const [open,       setOpen]      = useState(false);
  const [mode,       setMode]      = useState("idle");
  const [messages,   setMessages]  = useState([]);
  const [streaming,  setStreaming] = useState("");
  const [input,      setInput]     = useState("");
  const [listening,  setListening] = useState(false);
  const [transcript, setTranscript]= useState("");
  const [hasVoice,   setHasVoice]  = useState(false);

  const scrollRef = useRef();
  const recRef    = useRef();
  const synthRef  = useRef();
  const abortRef  = useRef();
  const sendRef   = useRef(() => {});

  // Detect voice support
  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setHasVoice(!!SR);
    synthRef.current = window.speechSynthesis ?? null;
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  // Greet with synthesis snippet when first opened
  useEffect(() => {
    if (open && messages.length === 0 && synthesis) {
      const snippet = synthesis.replace(/^#.*\n/, "").trim().slice(0, 180);
      setMessages([{
        role: "assistant",
        content: `${snippet}… What would you like to explore or challenge?`,
      }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-open + auto-send when App triggers a message (e.g. "Surprise me")
  useEffect(() => {
    if (!initialMessage) return;
    setOpen(true);
    // Small delay so the panel animates open first
    const t = setTimeout(() => {
      sendRef.current(initialMessage);
      onInitialMessageSent?.();
    }, 180);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  // Voice output
  const speak = useCallback((text) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    const utt = new SpeechSynthesisUtterance(text.slice(0, 280));
    utt.rate = 1.0; utt.pitch = 1.05;
    const voices = synthRef.current.getVoices();
    const preferred = voices.find(v =>
      v.name.includes("Samantha") || v.name.includes("Google US English") ||
      v.name.includes("Karen") || v.name.includes("Daniel"));
    if (preferred) utt.voice = preferred;
    utt.onstart = () => setMode("speaking");
    utt.onend   = () => setMode("idle");
    utt.onerror = () => setMode("idle");
    synthRef.current.speak(utt);
  }, []);

  // Send message → stream response
  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;
    setMode("thinking");
    setTranscript("");
    const userMsg = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setStreaming("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          session_id: sessionId,
          selected_node: selectedNode ?? null,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setStreaming(full);
      }

      setMessages(prev => [...prev, { role: "assistant", content: full }]);
      setStreaming("");
      // Pulse any graph nodes whose PMIDs the AI mentioned
      const pmids = extractPmids(full);
      if (pmids.length > 0) onPulseNodes?.(pmids);
      if (synthRef.current) {
        speak(full);
      } else {
        setMode("idle");
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setMode("error");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Connection error. Make sure the backend is running.",
        }]);
      }
    }
  }, [messages, speak, selectedNode, sessionId]);

  useEffect(() => { sendRef.current = sendMessage; }, [sendMessage]);

  // Voice input
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    recRef.current = rec;

    rec.onstart  = () => { setListening(true); setMode("listening"); };
    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join("");
      setTranscript(t);
      rec._last = t;
    };
    rec.onend   = () => {
      setListening(false);
      setMode("idle");
      if (rec._last) sendRef.current(rec._last);
    };
    rec.onerror = () => { setListening(false); setMode("idle"); };
    rec.start();
  }, []);

  const stopListening = useCallback(() => recRef.current?.stop(), []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
  };

  // Context-aware suggestion chips
  const suggestions = selectedNode
    ? selectedNode.kind === "Paper"
      ? ["Summarize this paper's key contribution", "How does this connect to the gaps?", "What would a follow-up study look like?"]
      : selectedNode.kind === "ResearchGap"
        ? ["Why is this gap scientifically important?", "How would I design a study to fill this?", "Is this gap actually worth pursuing?"]
        : ["Which papers belong to this topic?", "Is this topic overcrowded or sparse?"]
    : gaps?.length
      ? ["Which gap should I prioritize?", "What's the most surprising finding?", "Summarize the field in one paragraph"]
      : ["What's the most surprising finding?", "Summarize the field", "Where should a new researcher start?"];

  const modeLabel = {
    idle: "Ask Lexis anything", listening: "Listening…",
    thinking: "Thinking…", speaking: "Speaking…", error: "Try again",
  };

  return (
    <>
      {/* ── Floating orb button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Talk to Lexis AI"
        style={{
          position: "fixed", bottom: 76, right: 18, zIndex: 200,
          background: "none", border: "none", cursor: "pointer", padding: 0,
          filter: open ? "brightness(1.4) drop-shadow(0 0 12px #7c4dff)" : "brightness(1)",
          transition: "filter 0.25s",
        }}
      >
        <LexisOrb mode={open ? (mode === "idle" ? "idle" : mode) : "idle"} size={52} />
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div style={{
          position: "fixed", bottom: 140, right: 14, zIndex: 199,
          width: 370, maxHeight: 520,
          background: "rgba(5,13,26,0.97)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(124,77,255,0.35)",
          borderRadius: 18, display: "flex", flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.05)",
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          overflow: "hidden",
        }}>

          {/* Header */}
          <div style={{
            padding: "11px 16px", borderBottom: "1px solid rgba(124,77,255,0.2)",
            display: "flex", alignItems: "center", gap: 10,
            background: "linear-gradient(135deg, rgba(124,77,255,0.12), rgba(0,191,165,0.05))",
          }}>
            <LexisOrb mode={mode} size={32} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e0ff", letterSpacing: "0.06em" }}>LEXIS AI</div>
              <div style={{ fontSize: 10, color: "#00bfa5", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {modeLabel[mode]}
              </div>
            </div>
            <button
              onClick={() => { setMessages([]); setStreaming(""); setMode("idle"); }}
              style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, border: "1px solid rgba(107,127,163,0.25)", background: "transparent", color: "rgba(107,127,163,0.6)", cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase" }}
            >Clear</button>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", color: "rgba(107,127,163,0.6)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 2px" }}
            >×</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{
            flex: 1, overflowY: "auto", padding: "14px",
            display: "flex", flexDirection: "column", gap: 10,
            scrollbarWidth: "thin", scrollbarColor: "rgba(124,77,255,0.25) transparent",
          }}>
            {messages.length === 0 && !streaming && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                <p style={{ fontSize: 12, color: "rgba(107,127,163,0.7)", margin: 0, textAlign: "center", lineHeight: 1.6 }}>
                  I know every paper in this graph.<br />Challenge me, ask anything, or pick a prompt:
                </p>
                {suggestions.map((s, i) => <Chip key={i} label={s} onClick={() => sendMessage(s)} />)}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{
                padding: "9px 13px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.65,
                maxWidth: "90%",
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background: m.role === "user"
                  ? "linear-gradient(135deg, rgba(124,77,255,0.3), rgba(124,77,255,0.2))"
                  : "rgba(255,255,255,0.04)",
                border: m.role === "user"
                  ? "1px solid rgba(124,77,255,0.45)"
                  : "1px solid rgba(255,255,255,0.07)",
                color: m.role === "user" ? "#e8e0ff" : "#ccd8e8",
              }}>
                {m.content}
              </div>
            ))}

            {/* Streaming response */}
            {streaming && (
              <div style={{
                padding: "9px 13px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.65,
                maxWidth: "90%", alignSelf: "flex-start",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(79,195,247,0.2)",
                color: "#ccd8e8",
              }}>
                {streaming}
                <span style={{ display: "inline-block", width: "0.6em", marginLeft: 2, animation: "none", opacity: 0.6 }}>▋</span>
              </div>
            )}

            {/* Live transcript preview */}
            {transcript && (
              <div style={{ fontSize: 11, color: "rgba(0,191,165,0.6)", fontStyle: "italic", textAlign: "right" }}>
                {transcript}
              </div>
            )}
          </div>

          {/* Context badge */}
          {selectedNode && (
            <div style={{
              padding: "5px 16px", fontSize: 10, letterSpacing: "0.07em",
              borderTop: "1px solid rgba(124,77,255,0.12)",
              background: "rgba(124,77,255,0.06)",
              color: "rgba(124,77,255,0.75)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              ◉ {selectedNode.kind}: {(selectedNode.title ?? selectedNode.keyword ?? selectedNode.description ?? "")?.slice(0, 55)}
            </div>
          )}

          {/* Input row */}
          <form onSubmit={handleSubmit} style={{
            padding: "10px 12px", borderTop: "1px solid rgba(124,77,255,0.2)",
            display: "flex", gap: 7,
            background: "rgba(0,0,0,0.35)",
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={selectedNode
                ? `Ask about ${(selectedNode.title ?? selectedNode.keyword ?? selectedNode.kind)?.slice(0, 28)}…`
                : "Ask about the papers or gaps…"}
              style={{
                flex: 1, padding: "8px 12px",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(124,77,255,0.25)",
                borderRadius: 9, color: "#e8e0ff", fontSize: 12.5,
                outline: "none", fontFamily: "inherit",
              }}
              onFocus={e  => e.target.style.borderColor = "rgba(124,77,255,0.55)"}
              onBlur={e   => e.target.style.borderColor = "rgba(124,77,255,0.25)"}
            />
            {hasVoice && (
              <button
                type="button"
                onClick={listening ? stopListening : startListening}
                title={listening ? "Stop" : "Speak"}
                style={{
                  width: 35, height: 35, borderRadius: 9, border: "none", cursor: "pointer", flexShrink: 0,
                  background: listening ? "rgba(0,191,165,0.3)" : "rgba(255,255,255,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 0.2s",
                  boxShadow: listening ? "0 0 0 2px rgba(0,191,165,0.5)" : "none",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke={listening ? "#00bfa5" : "rgba(200,220,255,0.7)"} strokeWidth="2">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                  <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                </svg>
              </button>
            )}
            <button
              type="submit"
              style={{
                width: 35, height: 35, borderRadius: 9, border: "none", cursor: "pointer", flexShrink: 0,
                background: "rgba(124,77,255,0.35)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c9b8ff" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
