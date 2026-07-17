import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";

type Memory = { id: number; type: string; key: string; value: string; createdAt: number };
type Conversation = { id: number; role: "user" | "assistant"; content: string; createdAt: number };

function MicIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function StopIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function SpeakerIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function DuckMascot({ size = 88, active = false }: { size?: number; active?: boolean }) {
  return (
    <video
      src="/duck.mp4"
      poster="/favicon.png"
      autoPlay loop muted playsInline
      width={size} height={size}
      className={`select-none pointer-events-none ${active ? "animate-bounce" : ""}`}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

function memoryIcon(type: string) {
  if (type === "project") return "📦";
  if (type === "preferences") return "⚙️";
  if (type === "bug") return "🐞";
  if (type === "task") return "🎯";
  return "💡";
}

function formatTime(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ============================================================================
// Cursor Buddy — a duck that follows the cursor and explains what you point at.
// Marked with data-duck-ui so point-mode never targets the buddy's own chrome.
// ============================================================================
function CursorBuddy({ playQuack }: { playQuack: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [pointing, setPointing] = useState(false);
  const [bubble, setBubble] = useState<{ text: string; loading: boolean } | null>(null);
  const [highlight, setHighlight] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const duckRef = useRef<HTMLDivElement | null>(null);
  const target = useRef({ x: window.innerWidth - 120, y: window.innerHeight - 120 });
  const cur = useRef({ x: window.innerWidth - 120, y: window.innerHeight - 120 });
  const hoveredEl = useRef<Element | null>(null);
  const rafRef = useRef<number | null>(null);

  // Eased follow loop.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      cur.current.x += (target.current.x - cur.current.x) * 0.18;
      cur.current.y += (target.current.y - cur.current.y) * 0.18;
      if (duckRef.current) {
        duckRef.current.style.transform = `translate(${cur.current.x}px, ${cur.current.y}px)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [enabled]);

  const isBuddyUI = (el: Element | null) => !!el && !!el.closest("[data-duck-ui]");

  // Track cursor; offset the duck so it sits just below-right of the pointer.
  useEffect(() => {
    if (!enabled) return;
    const onMove = (e: MouseEvent) => {
      target.current = { x: e.clientX + 18, y: e.clientY + 18 };
      if (pointing) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && !isBuddyUI(el)) {
          hoveredEl.current = el;
          const r = el.getBoundingClientRect();
          setHighlight({ x: r.left, y: r.top, w: r.width, h: r.height });
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [enabled, pointing]);

  const explain = useCallback(async (content: string, hint?: string) => {
    setPointing(false);
    setHighlight(null);
    setBubble({ text: "", loading: true });
    playQuack();
    try {
      const r = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, hint, wantAudio: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? r.status);
      setBubble({ text: d.text, loading: false });
      if (d.audio) {
        const bin = atob(d.audio);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
        const a = new Audio(url);
        a.onended = () => URL.revokeObjectURL(url);
        a.play().catch(() => {});
      }
    } catch (e: any) {
      setBubble({ text: `Couldn't explain that: ${e?.message ?? e}`, loading: false });
    }
  }, [playQuack]);

  // Point-mode click capture: grab the pointed element's visible text.
  useEffect(() => {
    if (!pointing) return;
    const onClick = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (isBuddyUI(el)) return; // let buddy controls work normally
      e.preventDefault();
      e.stopPropagation();
      const targetEl = hoveredEl.current || el;
      const text = (targetEl instanceof HTMLElement ? targetEl.innerText : targetEl?.textContent) || "";
      const tag = targetEl?.tagName?.toLowerCase() ?? "element";
      const clean = text.replace(/\s+/g, " ").trim().slice(0, 4000);
      if (!clean) {
        setBubble({ text: "That element had no readable text to explain. Try pointing at some code or a message.", loading: false });
        setPointing(false);
        setHighlight(null);
        return;
      }
      explain(clean, `The user pointed at a <${tag}> element on the DuckTape page.`);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPointing(false); setHighlight(null); } };
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [pointing, explain]);

  return (
    <>
      {/* Toggle control (bottom-left) */}
      <div data-duck-ui className="fixed bottom-5 left-5 z-[60] flex flex-col gap-2 items-start">
        {enabled && (
          <button
            onClick={() => { setPointing((p) => !p); setBubble(null); }}
            className={`text-sm font-semibold rounded-full px-4 py-2 shadow-md transition ${pointing ? "bg-rose-500 text-white" : "bg-amber-400 text-slate-900 hover:bg-amber-300"}`}
          >
            {pointing ? "Pointing… click anything (Esc to cancel)" : "👉 Point at something"}
          </button>
        )}
        <button
          onClick={() => { setEnabled((v) => !v); setPointing(false); setBubble(null); setHighlight(null); }}
          className={`text-xs font-medium rounded-full px-3 py-1.5 shadow-sm border transition ${enabled ? "bg-white border-amber-300 text-amber-700" : "bg-white border-slate-200 text-slate-500 hover:border-amber-300"}`}
        >
          {enabled ? "🦆 Buddy on" : "🦆 Summon buddy"}
        </button>
      </div>

      {/* Highlight box while pointing */}
      {pointing && highlight && (
        <div
          className="fixed z-[55] pointer-events-none rounded-md"
          style={{
            left: highlight.x - 3, top: highlight.y - 3, width: highlight.w + 6, height: highlight.h + 6,
            border: "2px solid #f59e0b", background: "rgba(251,191,36,0.12)", boxShadow: "0 0 0 3px rgba(251,191,36,0.25)",
          }}
        />
      )}

      {/* The floating duck */}
      {enabled && (
        <div
          ref={duckRef}
          data-duck-ui
          className="fixed top-0 left-0 z-[58] pointer-events-none"
          style={{ transform: `translate(${cur.current.x}px, ${cur.current.y}px)` }}
        >
          <DuckMascot size={56} active={!!bubble?.loading} />
        </div>
      )}

      {/* Speech bubble anchored bottom-left above the toggle */}
      {enabled && bubble && (
        <div data-duck-ui className="fixed bottom-24 left-5 z-[60] max-w-sm bg-white border border-amber-200 rounded-2xl shadow-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-500 font-bold text-sm">DuckTape</span>
            <button onClick={() => setBubble(null)} className="ml-auto text-slate-400 hover:text-slate-600 text-xs">✕</button>
          </div>
          {bubble.loading
            ? <p className="text-sm text-slate-400 animate-pulse">Looking at what you pointed at…</p>
            : <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{bubble.text}</p>}
        </div>
      )}
    </>
  );
}

function App() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [recording, setRecording] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  const playQuack = useCallback(() => {
    try {
      const a = new Audio("/quack.mp3");
      a.volume = 0.5;
      a.play().catch(() => {});
    } catch { /* ignore */ }
  }, []);

  async function loadMemories() {
    try {
      const r = await fetch("/api/memories");
      const d = await r.json();
      if (r.ok) setMemories(d.memories ?? []);
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }

  async function loadConversations() {
    try {
      const r = await fetch("/api/conversations");
      const d = await r.json();
      if (r.ok) setConversations(d.conversations ?? []);
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }

  useEffect(() => { loadMemories(); loadConversations(); }, []);
  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations, thinking, speaking]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function sendMessage(message: string) {
    if (!message.trim()) return;
    setError(null);
    setThinking(true);
    const now = Math.floor(Date.now() / 1000);
    setConversations((prev) => [...prev, { id: -Date.now(), role: "user", content: message, createdAt: now }]);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? r.status);
      setConversations((prev) => [...prev, { id: -Date.now() + 1, role: "assistant", content: d.text, createdAt: now + 1 }]);
      if (d.audio) await playBase64Audio(d.audio);
      await loadMemories();
      if (d.savedMemories > 0) showToast(`🦆 remembered ${d.savedMemories} thing${d.savedMemories === 1 ? "" : "s"}`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setThinking(false);
    }
  }

  async function playBase64Audio(b64: string) {
    try {
      setSpeaking(true);
      playQuack();
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setSpeaking(false); };
      // Small delay so the quack reads as a lead-in, then DuckTape speaks.
      setTimeout(() => audio.play().catch(() => setSpeaking(false)), 280);
    } catch (e) {
      console.warn("audio playback failed", e);
      setSpeaking(false);
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setThinking(true);
        const placeholderId = -Date.now();
        setConversations((prev) => [...prev, { id: placeholderId, role: "user", content: "[voice message — transcribing…]", createdAt: Math.floor(Date.now() / 1000) }]);
        try {
          const form = new FormData();
          form.append("audio", blob, "message.webm");
          const r = await fetch("/api/chat", { method: "POST", body: form });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error ?? r.status);
          const transcript = d.transcript?.trim() || "[could not transcribe]";
          setConversations((prev) => prev.map((m) => m.id === placeholderId ? { ...m, content: transcript } : m));
          setConversations((prev) => [...prev, { id: -Date.now() + 1, role: "assistant", content: d.text, createdAt: Math.floor(Date.now() / 1000) + 1 }]);
          if (d.audio) await playBase64Audio(d.audio);
          await loadMemories();
          if (d.savedMemories > 0) showToast(`🦆 remembered ${d.savedMemories} thing${d.savedMemories === 1 ? "" : "s"}`);
        } catch (e: any) {
          setError(String(e?.message ?? e));
        } finally {
          setThinking(false);
        }
      };
      recorder.start();
      setRecording(true);
    } catch (e: any) {
      setError("Microphone access denied or unavailable: " + (e?.message ?? e));
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = textInput.trim();
    if (!t) return;
    setTextInput("");
    sendMessage(t);
  }

  async function resetMemory() {
    if (!confirm("Reset all DuckTape memory and conversation history?")) return;
    try {
      await fetch("/api/memories", { method: "DELETE" });
      setMemories([]);
      setConversations([]);
      showToast("🦆 memory cleared");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  const grouped = memories.reduce((acc, m) => {
    (acc[m.type] ??= []).push(m);
    return acc;
  }, {} as Record<string, Memory[]>);

  const busy = thinking || speaking;

  return (
    <div className="min-h-screen flex flex-col text-slate-800">
      <CursorBuddy playQuack={playQuack} />

      <header className="border-b border-amber-100 px-6 py-4 flex items-center gap-3 bg-white/80 backdrop-blur sticky top-0 z-40">
        <DuckMascot size={52} active={busy} />
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">DuckTape <span className="text-amber-500">🦆</span></h1>
          <p className="text-sm text-slate-500">The AI coding assistant that remembers.</p>
        </div>
        <button onClick={resetMemory} className="text-xs text-slate-500 hover:text-rose-500 border border-slate-200 hover:border-rose-300 bg-white rounded-full px-3 py-1.5 transition">Reset memory</button>
      </header>

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-amber-400 text-slate-900 text-sm font-semibold px-4 py-2 rounded-full shadow-lg shadow-amber-300/50 animate-bounce">{toast}</div>
      )}

      <main className="flex-1 flex flex-col lg:flex-row max-w-7xl mx-auto w-full px-4 py-6 gap-6">
        <section className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex-1 bg-white border border-amber-100 rounded-3xl p-5 overflow-y-auto min-h-[300px] max-h-[55vh] shadow-sm">
            {conversations.length === 0 && (
              <div className="text-center text-slate-500 py-10">
                <div className="flex justify-center">
                  <DuckMascot size={140} />
                </div>
                <p className="mt-4 text-lg font-medium text-slate-700">Press the mic and tell me what you're building.</p>
                <p className="text-sm mt-2 text-slate-400 max-w-md mx-auto">I'll remember your project, your stack, your bugs, and your coding style — across every conversation.</p>
                <p className="text-xs mt-3 text-amber-600">Tip: hit <b>Summon buddy</b> (bottom-left), then <b>Point at something</b> and click any code or message for an instant explanation.</p>
              </div>
            )}
            {conversations.map((m) => (
              <div key={m.id} className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${m.role === "user" ? "bg-amber-400 text-slate-900" : "bg-amber-50 border border-amber-100 text-slate-800"}`}>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  <p className={`text-[10px] mt-1 ${m.role === "user" ? "text-amber-800/70" : "text-slate-400"}`}>{formatTime(m.createdAt)}</p>
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start items-center gap-2">
                <DuckMascot size={40} active />
                <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-2.5 text-slate-500 text-sm">DuckTape is thinking…</div>
              </div>
            )}
            {speaking && !thinking && (
              <div className="flex justify-start">
                <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-2.5 text-slate-600 text-sm flex items-center gap-2">
                  <SpeakerIcon className="w-4 h-4 text-amber-500 animate-pulse" /> DuckTape is speaking…
                </div>
              </div>
            )}
            <div ref={conversationEndRef} />
          </div>

          {error && <p className="text-sm text-rose-500">⚠️ {error}</p>}

          <form onSubmit={handleTextSubmit} className="flex gap-2">
            <input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Or type a message…"
              className="flex-1 bg-white border border-amber-200 rounded-full px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              disabled={recording || thinking}
            />
            <button type="submit" disabled={!textInput.trim() || thinking} className="bg-white border border-amber-200 hover:bg-amber-50 disabled:opacity-40 text-slate-700 rounded-full px-5 py-2.5 text-sm font-medium transition">Send</button>
          </form>

          <div className="flex justify-center pt-1">
            {!recording ? (
              <button
                onClick={startRecording}
                disabled={thinking}
                className="group flex items-center gap-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-900 rounded-full px-7 py-3.5 font-bold shadow-lg shadow-amber-300/50 transition active:scale-95"
              >
                <MicIcon className="w-5 h-5" />
                Start Talking
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-3 bg-rose-500 hover:bg-rose-400 text-white rounded-full px-7 py-3.5 font-bold shadow-lg shadow-rose-300/50 animate-pulse active:scale-95"
              >
                <StopIcon className="w-5 h-5" />
                Stop & Send
              </button>
            )}
          </div>
        </section>

        <aside className="lg:w-80 bg-white border border-amber-100 rounded-3xl p-5 h-fit shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Memory</h2>
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">{memories.length} item{memories.length === 1 ? "" : "s"}</span>
          </div>
          {memories.length === 0 ? (
            <p className="text-sm text-slate-400">No memories yet. Tell me what you're working on and I'll remember it across sessions.</p>
          ) : (
            <div className="space-y-4">
              {(["project", "preferences", "task", "bug"] as const).map((type) => {
                const items = grouped[type];
                if (!items || items.length === 0) return null;
                return (
                  <div key={type}>
                    <h3 className="text-xs font-bold text-slate-500 mb-2 flex items-center gap-1.5 uppercase tracking-wide">
                      <span>{memoryIcon(type)}</span> {type.charAt(0).toUpperCase() + type.slice(1)}
                    </h3>
                    <ul className="space-y-1.5">
                      {items.map((m) => (
                        <li key={m.id} className="text-sm bg-amber-50/60 border border-amber-100 rounded-xl px-3 py-2">
                          <div className="text-[11px] text-slate-400">{m.key}</div>
                          <div className="text-slate-800 font-medium">{m.value}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
