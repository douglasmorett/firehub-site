"use client";
import { useState, useEffect, useRef, useCallback } from "react";

const WAKE_WORDS = ["firehub", "fire hub", "jarvis", "ei firehub", "hey firehub"];
const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_KEY || "";

const SYSTEM_CONTEXT = `Você é o assistente de voz pessoal do Douglas, fundador do FireHub e Hakim Portal.
Você é como o JARVIS do Homem de Ferro — inteligente, direto, eficiente e levemente com personalidade.
Responda SEMPRE em português brasileiro.
Mantenha respostas curtas e diretas (máximo 3 frases) pois serão lidas em voz alta.
Contexto dos projetos:
- FireHub: plataforma SaaS para restaurantes (cardápio digital, pedidos, financeiro, IA). Site: firehubfood.com.br
- Hakim Portal: sistema interno para a rede de franquias Hakim Congelados
- Banco: Neon PostgreSQL com Prisma ORM
- Deploy: Vercel (GitHub auto-deploy)
- Stack: Next.js, TypeScript, Prisma
Quando perguntarem sobre status dos sistemas, diga que estão operacionais a menos que o Douglas informe o contrário.
Trate o Douglas com familiaridade mas com respeito profissional.`;

export default function AssistentePage() {
  const [phase, setPhase] = useState<"idle" | "listening-wake" | "listening-command" | "thinking" | "speaking">("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [history, setHistory] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [wakeDetected, setWakeDetected] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState("");

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const commandTimeoutRef = useRef<any>(null);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "pt-BR";
    utter.rate = 1.05;
    utter.pitch = 0.9;
    // Preferir voz masculina em PT-BR
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(v => v.lang.startsWith("pt") && v.name.toLowerCase().includes("male"))
      || voices.find(v => v.lang.startsWith("pt-BR"))
      || voices.find(v => v.lang.startsWith("pt"))
      || voices[0];
    if (ptVoice) utter.voice = ptVoice;
    utter.onend = () => onEnd?.();
    window.speechSynthesis.speak(utter);
  }, []);

  const askGemini = useCallback(async (userText: string) => {
    setPhase("thinking");
    setPulse(true);
    try {
      const messages = [
        ...history.slice(-6).map(h => ({
          role: h.role === "user" ? "user" : "model",
          parts: [{ text: h.text }]
        })),
        { role: "user", parts: [{ text: userText }] }
      ];

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_CONTEXT }] },
            contents: messages,
            generationConfig: { maxOutputTokens: 200, temperature: 0.7 }
          })
        }
      );
      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Desculpe, não consegui processar sua solicitação.";
      setResponse(reply);
      setHistory(h => [...h, { role: "user", text: userText }, { role: "assistant", text: reply }]);
      setPhase("speaking");
      speak(reply, () => {
        setPhase("listening-wake");
        setPulse(false);
      });
    } catch (e) {
      const err = "Erro de conexão. Verifique sua internet.";
      setResponse(err);
      speak(err, () => setPhase("listening-wake"));
      setPulse(false);
    }
  }, [history, speak]);

  const startCommandListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setPhase("listening-command");
    setTranscript("");
    setWakeDetected(true);
    speak("Sim, Douglas. Te escutando.", () => {});

    // Timeout: se não falar em 8s, volta ao idle de wake
    commandTimeoutRef.current = setTimeout(() => {
      setPhase("listening-wake");
      setWakeDetected(false);
    }, 8000);
  }, [speak]);

  const initRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Seu navegador não suporta reconhecimento de voz. Use Chrome.");
      return;
    }

    const recog = new SpeechRecognition();
    recog.lang = "pt-BR";
    recog.continuous = true;
    recog.interimResults = true;

    recog.onresult = (event: any) => {
      const results = Array.from(event.results as any[]);
      const latest = results[results.length - 1];
      const text = (latest as any)[0].transcript.toLowerCase().trim();

      if (phase === "listening-wake" || phase === "idle") {
        // Detecta wake word
        const detected = WAKE_WORDS.some(w => text.includes(w));
        if (detected) {
          clearTimeout(commandTimeoutRef.current);
          startCommandListening();
        }
      } else if (phase === "listening-command") {
        setTranscript((latest as any)[0].transcript);
        // Se é resultado final, processa comando
        if ((latest as any).isFinal) {
          clearTimeout(commandTimeoutRef.current);
          const cmd = (latest as any)[0].transcript.trim();
          if (cmd.length > 2) {
            setWakeDetected(false);
            askGemini(cmd);
          }
        }
      }
    };

    recog.onend = () => {
      // Reinicia automaticamente se não estiver falando
      if (phase !== "speaking" && phase !== "thinking") {
        setTimeout(() => { try { recog.start(); } catch {} }, 300);
      }
    };

    recog.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        console.error("Speech error:", e.error);
      }
    };

    recognitionRef.current = recog;
    try { recog.start(); } catch {}
    setPermissionGranted(true);
    setPhase("listening-wake");
  }, [phase, startCommandListening, askGemini]);

  useEffect(() => {
    synthRef.current = window.speechSynthesis;
    // Preload voices
    window.speechSynthesis?.getVoices();
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
      clearTimeout(commandTimeoutRef.current);
    };
  }, []);

  // Reinicia recognition quando phase muda
  useEffect(() => {
    if (!recognitionRef.current) return;
    if (phase === "listening-wake" || phase === "listening-command") {
      try { recognitionRef.current.start(); } catch {}
    }
  }, [phase]);

  const phaseLabel = {
    idle: "Clique para ativar",
    "listening-wake": `Aguardando... fale "FireHub"`,
    "listening-command": "Te escutando...",
    thinking: "Processando...",
    speaking: "Respondendo...",
  }[phase];

  const ringColor = {
    idle: "#1E3A5F",
    "listening-wake": "#1E3A5F",
    "listening-command": "#EF4444",
    thinking: "#A78BFA",
    speaking: "#10B981",
  }[phase];

  return (
    <div style={{
      minHeight: "100vh", background: "#050A14",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif", overflow: "hidden", position: "relative",
      userSelect: "none",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Orbitron:wght@400;700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #050A14; }

        @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes rotateReverse { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes pulseRing { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.05); } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scanLine { 0% { top: -2px; } 100% { top: 100%; } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes waveBar { 0%, 100% { height: 4px; } 50% { height: 24px; } }
        @keyframes glowPulse { 0%, 100% { box-shadow: 0 0 20px rgba(59,130,246,0.3); } 50% { box-shadow: 0 0 60px rgba(59,130,246,0.7), 0 0 100px rgba(59,130,246,0.3); } }

        .orb-container { position: relative; width: 200px; height: 200px; cursor: pointer; }
        .orb-ring { position: absolute; border-radius: 50%; border: 1.5px solid; }
        .orb-ring-1 { inset: 0; animation: rotate 8s linear infinite; border-color: rgba(59,130,246,0.4) transparent rgba(59,130,246,0.4) transparent; }
        .orb-ring-2 { inset: 12px; animation: rotateReverse 6s linear infinite; border-color: transparent rgba(139,92,246,0.5) transparent rgba(139,92,246,0.5); }
        .orb-ring-3 { inset: 24px; animation: rotate 10s linear infinite; border-color: rgba(16,185,129,0.3) transparent; }
        .orb-core {
          position: absolute; inset: 36px; border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #1E40AF, #0F172A);
          display: flex; align-items: center; justify-content: center;
          transition: all 0.3s;
        }
        .orb-core.active { background: radial-gradient(circle at 35% 35%, #EF4444, #7C3AED 60%, #0F172A); }
        .orb-core.thinking { background: radial-gradient(circle at 35% 35%, #7C3AED, #1E1B4B 60%, #0F172A); animation: glowPulse 1s ease-in-out infinite; }
        .orb-core.speaking { background: radial-gradient(circle at 35% 35%, #10B981, #065F46 60%, #0F172A); }

        .wave-bar { width: 3px; background: #3B82F6; border-radius: 2px; animation: waveBar 0.5s ease-in-out infinite; }

        .grid-line { position: absolute; background: rgba(59,130,246,0.04); }

        .history-item { animation: fadeSlideUp 0.3s ease-out; }

        @media (max-width: 600px) {
          .orb-container { width: 160px; height: 160px; }
          .orb-core { inset: 28px; }
          .orb-ring-2 { inset: 9px; }
          .orb-ring-3 { inset: 18px; }
        }
      `}</style>

      {/* Grid background */}
      {Array.from({ length: 20 }).map((_, i) => (
        <div key={`h${i}`} className="grid-line" style={{ top: `${i * 5}%`, left: 0, right: 0, height: 1 }} />
      ))}
      {Array.from({ length: 20 }).map((_, i) => (
        <div key={`v${i}`} className="grid-line" style={{ left: `${i * 5}%`, top: 0, bottom: 0, width: 1 }} />
      ))}

      {/* Top bar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(59,130,246,0.1)", background: "rgba(5,10,20,0.8)", backdropFilter: "blur(10px)", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: permissionGranted ? "#10B981" : "#EF4444", boxShadow: `0 0 8px ${permissionGranted ? "#10B981" : "#EF4444"}`, animation: "blink 2s ease-in-out infinite" }} />
          <span style={{ fontFamily: "Orbitron, monospace", color: "#60A5FA", fontSize: "0.8rem", letterSpacing: 2 }}>FIREHUB AI</span>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ color: "#334155", fontSize: "0.7rem", fontFamily: "monospace" }}>{new Date().toLocaleTimeString("pt-BR")}</span>
          <a href="/admin" style={{ color: "#334155", fontSize: "0.7rem", textDecoration: "none" }}>← Admin</a>
        </div>
      </div>

      {/* Main */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40, padding: "100px 20px 80px", width: "100%", maxWidth: 600 }}>

        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontFamily: "Orbitron, monospace", color: "#F1F5F9", fontSize: "clamp(1.2rem, 4vw, 1.8rem)", fontWeight: 900, letterSpacing: 4, marginBottom: 6 }}>
            ASSISTENTE <span style={{ color: "#EF4444" }}>F.H.</span>
          </h1>
          <p style={{ color: "#334155", fontSize: "0.7rem", letterSpacing: 3, textTransform: "uppercase" }}>Sistema de Interface por Voz</p>
        </div>

        {/* ORB */}
        <div
          className="orb-container"
          style={{ animation: "float 4s ease-in-out infinite" }}
          onClick={() => !permissionGranted && initRecognition()}
        >
          <div className="orb-ring orb-ring-1" />
          <div className="orb-ring orb-ring-2" />
          <div className="orb-ring orb-ring-3" />
          <div className={`orb-core ${phase === "listening-command" ? "active" : phase === "thinking" ? "thinking" : phase === "speaking" ? "speaking" : ""}`}>
            {phase === "listening-command" ? (
              <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                {[0.3, 0.6, 0.9, 0.6, 0.3].map((d, i) => (
                  <div key={i} className="wave-bar" style={{ animationDelay: `${d}s` }} />
                ))}
              </div>
            ) : phase === "thinking" ? (
              <span style={{ color: "#A78BFA", fontSize: "1.5rem" }}>◈</span>
            ) : phase === "speaking" ? (
              <span style={{ color: "#10B981", fontSize: "1.5rem" }}>◉</span>
            ) : (
              <span style={{ color: "#3B82F6", fontSize: "1.5rem", opacity: permissionGranted ? 1 : 0.5 }}>
                {permissionGranted ? "◎" : "▶"}
              </span>
            )}
          </div>
        </div>

        {/* Status */}
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#60A5FA", fontSize: "0.85rem", fontWeight: 600, letterSpacing: 1, marginBottom: 8, fontFamily: "monospace" }}>
            {error || phaseLabel}
          </p>
          {phase === "listening-command" && transcript && (
            <p style={{ color: "#94A3B8", fontSize: "0.8rem", fontStyle: "italic", animation: "fadeSlideUp 0.2s ease-out" }}>
              "{transcript}"
            </p>
          )}
        </div>

        {/* Activate button (se não ativado) */}
        {!permissionGranted && (
          <button
            onClick={initRecognition}
            style={{
              background: "linear-gradient(135deg, #1D4ED8, #7C3AED)",
              border: "none", borderRadius: 12, padding: "14px 36px",
              color: "#fff", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer",
              fontFamily: "Inter, sans-serif", letterSpacing: 1,
              boxShadow: "0 0 30px rgba(59,130,246,0.4)",
            }}
          >
            🎤 Ativar Sistema de Voz
          </button>
        )}

        {/* Wake word chips */}
        {permissionGranted && phase === "listening-wake" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {WAKE_WORDS.slice(0, 3).map(w => (
              <span key={w} style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 20, padding: "4px 12px", color: "#60A5FA", fontSize: "0.72rem", fontFamily: "monospace" }}>
                "{w}"
              </span>
            ))}
          </div>
        )}

        {/* Conversation history */}
        {history.length > 0 && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, maxHeight: 280, overflowY: "auto" }}>
            {history.slice(-6).map((h, i) => (
              <div key={i} className="history-item" style={{ display: "flex", justifyContent: h.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "80%", padding: "10px 14px", borderRadius: 12,
                  background: h.role === "user"
                    ? "rgba(29,78,216,0.2)"
                    : "rgba(124,58,237,0.15)",
                  border: `1px solid ${h.role === "user" ? "rgba(59,130,246,0.3)" : "rgba(139,92,246,0.3)"}`,
                  color: h.role === "user" ? "#93C5FD" : "#C4B5FD",
                  fontSize: "0.82rem", lineHeight: 1.5,
                }}>
                  <div style={{ fontSize: "0.6rem", marginBottom: 4, opacity: 0.6, fontFamily: "monospace", letterSpacing: 1 }}>
                    {h.role === "user" ? "DOUGLAS" : "F.H. AI"}
                  </div>
                  {h.text}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Latest response highlight */}
        {response && phase === "speaking" && (
          <div style={{
            width: "100%", padding: "16px 20px", borderRadius: 14,
            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)",
            color: "#6EE7B7", fontSize: "0.88rem", lineHeight: 1.6,
            animation: "fadeSlideUp 0.3s ease-out",
          }}>
            <div style={{ fontSize: "0.6rem", color: "#10B981", marginBottom: 6, fontFamily: "monospace", letterSpacing: 2 }}>▶ RESPONDENDO</div>
            {response}
          </div>
        )}

        {/* Manual input fallback */}
        {permissionGranted && (
          <div style={{ width: "100%", display: "flex", gap: 8 }}>
            <input
              id="manual-input"
              placeholder="Ou digite sua pergunta aqui..."
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) { askGemini(val); (e.target as HTMLInputElement).value = ""; }
                }
              }}
              style={{
                flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 10, padding: "10px 14px", color: "#F1F5F9", fontSize: "0.85rem",
                fontFamily: "inherit", outline: "none",
              }}
            />
            <button
              onClick={() => {
                const inp = document.getElementById("manual-input") as HTMLInputElement;
                if (inp?.value.trim()) { askGemini(inp.value.trim()); inp.value = ""; }
              }}
              style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 10, padding: "10px 16px", color: "#60A5FA", cursor: "pointer", fontSize: "0.85rem" }}
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
