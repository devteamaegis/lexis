import { useState, useRef, useCallback, useEffect } from "react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ─── TTS helper ───────────────────────────────────────────────────────────────
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate  = 0.95;
  utt.pitch = 0.9;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.name.includes("Daniel") || v.name.includes("Google UK English Male")
  );
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
}

// ─── Toast notification ───────────────────────────────────────────────────────
function Toast({ message }) {
  if (!message) return null;
  return (
    <div style={{
      position: "absolute",
      top: 16,
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(5,13,26,0.9)",
      border: "1px solid var(--star-faint)",
      borderRadius: 20,
      padding: "6px 16px",
      fontSize: 12,
      color: "var(--accent-aurora)",
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      pointerEvents: "none",
      zIndex: 200,
      whiteSpace: "nowrap",
      animation: "fadeInOut 3s ease forwards",
    }}>
      {message}
    </div>
  );
}

// ─── Mic button ───────────────────────────────────────────────────────────────
export default function VoiceAgent({
  onSearch,
  onReset,
  onZoom,
  onFilterYear,
  selectedNode,
  gapCount,
  paperCount,
  gaps,
}) {
  const [state, setState]   = useState("idle"); // idle | listening | processing | speaking
  const [toast, setToast]   = useState("");
  const recogRef            = useRef(null);
  const toastTimerRef       = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 3000);
  }, []);

  // Handle recognized speech
  const handleTranscript = useCallback(async (transcript) => {
    setState("processing");
    showToast(`Heard: "${transcript}"`);

    const lower = transcript.toLowerCase().trim();

    // Client-side fast-path intent matching
    if (/^(clear|reset)/.test(lower)) {
      onReset?.();
      showToast("Graph cleared.");
      setState("idle");
      return;
    }
    if (/^(zoom in)/.test(lower)) {
      onZoom?.(1.5);
      setState("idle");
      return;
    }
    if (/^(zoom out)/.test(lower)) {
      onZoom?.(0.67);
      setState("idle");
      return;
    }
    if (/^(what are the gaps|read gaps|tell me the gaps)/.test(lower)) {
      if (gaps.length === 0) {
        speak("No research gaps have been detected yet. Run a query first.");
        showToast("No gaps yet.");
      } else {
        const summary = gaps.slice(0, 3).map((g, i) => `Gap ${i + 1}: ${g.description}`).join(". ");
        speak(`Found ${gaps.length} research gaps. ${summary}`);
        showToast(`Reading ${gaps.length} gaps…`);
      }
      setState("speaking");
      setTimeout(() => setState("idle"), 4000);
      return;
    }
    if (/^(tell me about this paper|read abstract|read this)/.test(lower) && selectedNode?.kind === "Paper") {
      speak(selectedNode.abstract?.slice(0, 280) ?? "No abstract available.");
      showToast("Reading abstract…");
      setState("speaking");
      setTimeout(() => setState("idle"), 6000);
      return;
    }
    if (/^(find related)/.test(lower) && selectedNode?.kind === "Paper") {
      showToast(`Finding related papers…`);
      setState("idle");
      return;
    }
    const searchMatch = lower.match(/^search (?:for )?(.+)/);
    if (searchMatch) {
      const q = searchMatch[1].trim();
      onSearch?.(q);
      showToast(`Searching for "${q}"…`);
      setState("idle");
      return;
    }
    const filterMatch = lower.match(/^filter (\d{4})/);
    if (filterMatch) {
      onFilterYear?.(parseInt(filterMatch[1]));
      showToast(`Filtering from ${filterMatch[1]}`);
      setState("idle");
      return;
    }

    // Fall back to backend for complex queries
    try {
      const resp = await fetch(`${API}/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          context: {
            selected_node: selectedNode,
            gap_count: gapCount,
            paper_count: paperCount,
          },
        }),
      });
      const data = await resp.json();

      if (data.speech) {
        speak(data.speech);
        showToast(data.speech.slice(0, 60));
        setState("speaking");
        setTimeout(() => setState("idle"), 4000);
      }
      if (data.action === "search" && data.query) onSearch?.(data.query);
      if (data.action === "reset")  onReset?.();
      if (data.action === "zoom")   onZoom?.(1.5);
      if (data.action === "filter" && data.filter_year) onFilterYear?.(data.filter_year);
    } catch {
      setState("idle");
    }
  }, [gaps, gapCount, paperCount, selectedNode, onSearch, onReset, onZoom, onFilterYear, showToast]);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showToast("Speech not supported in this browser.");
      return;
    }
    const recog = new SR();
    recog.lang = "en-US";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recogRef.current = recog;

    recog.onstart  = () => { setState("listening"); showToast("Listening…"); };
    recog.onresult = (e) => {
      const t = e.results[0][0].transcript;
      handleTranscript(t);
    };
    recog.onerror  = () => { setState("idle"); showToast("Didn't catch that."); };
    recog.onend    = () => { setState("idle"); };
    recog.start();
  }, [handleTranscript, showToast]);

  const stopListening = useCallback(() => {
    recogRef.current?.stop();
    setState("idle");
  }, []);

  // Pulse animation CSS
  const pulseStyle = state === "listening" ? {
    boxShadow: "0 0 0 8px rgba(79,195,247,0.2), 0 0 0 16px rgba(79,195,247,0.1)",
    animation: "micPulse 1.2s ease-in-out infinite",
  } : {};

  const iconColor = {
    idle:       "var(--star-dim)",
    listening:  "var(--accent-aurora)",
    processing: "var(--accent-amber)",
    speaking:   "var(--accent-teal)",
  }[state];

  return (
    <>
      <style>{`
        @keyframes micPulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(79,195,247,0.2), 0 0 0 10px rgba(79,195,247,0.08); }
          50%       { box-shadow: 0 0 0 10px rgba(79,195,247,0.25), 0 0 0 20px rgba(79,195,247,0.1); }
        }
        @keyframes fadeInOut {
          0%   { opacity: 0; transform: translateX(-50%) translateY(-4px); }
          10%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <Toast message={toast} />

      <button
        onClick={state === "listening" ? stopListening : startListening}
        title={state === "idle" ? "Start voice command" : "Stop listening"}
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "1px solid var(--star-faint)",
          background: state === "listening" ? "rgba(79,195,247,0.1)" : "var(--space-nebula)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "all 0.2s",
          ...pulseStyle,
        }}
      >
        {state === "processing" ? (
          <div style={{
            width: 16, height: 16,
            border: "2px solid var(--star-faint)",
            borderTopColor: "var(--accent-amber)",
            borderRadius: "50%",
            animation: "spin 0.7s linear infinite",
          }} />
        ) : state === "speaking" ? (
          // Sound wave bars
          <div style={{ display: "flex", gap: 2, alignItems: "center", height: 16 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                width: 3,
                borderRadius: 2,
                background: "var(--accent-teal)",
                animation: `wave${i} 0.6s ease-in-out infinite alternate`,
                animationDelay: `${i * 0.1}s`,
                height: i === 2 ? 16 : 10,
              }} />
            ))}
            <style>{`
              @keyframes wave1 { to { height: 6px; } }
              @keyframes wave2 { to { height: 10px; } }
              @keyframes wave3 { to { height: 6px; } }
            `}</style>
          </div>
        ) : (
          // Mic icon (SVG)
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="2" width="6" height="11" rx="3" fill={iconColor} />
            <path d="M5 10a7 7 0 0014 0" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <line x1="12" y1="21" x2="12" y2="17" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="9" y1="21" x2="15" y2="21" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </>
  );
}
