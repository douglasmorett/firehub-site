"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CHAVE_DO_CODIGO, TAMANHO_DO_CODIGO, normalizarCodigo } from "@/lib/painel-de-senhas";

export default function DigitarCodigo({ erro }: { erro: string | null }) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [lembrado, setLembrado] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(5);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (erro) {
      try { localStorage.removeItem(CHAVE_DO_CODIGO); } catch {}
      return;
    }
    try {
      const c = normalizarCodigo(localStorage.getItem(CHAVE_DO_CODIGO));
      if (c) setLembrado(c);
    } catch {}
  }, [erro]);

  // A TV que religou volta sozinha ao painel — ninguém precisa pegar o controle.
  useEffect(() => {
    if (!lembrado) return;
    if (segundos <= 0) { router.replace(`/tv/${lembrado}`); return; }
    const t = setTimeout(() => setSegundos((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [lembrado, segundos, router]);

  const valido = normalizarCodigo(codigo);
  const abrir = () => { if (valido) router.push(`/tv/${valido}`); };

  return (
    <main style={S.fundo}>
      <div style={S.caixa}>
        <img src="/firehub-flame.png" alt="" style={{ width: 72, height: 72 }} />
        <h1 style={S.titulo}>Painel de senhas</h1>

        {lembrado ? (
          <>
            <p style={S.texto}>Abrindo o painel <b style={{ letterSpacing: 4 }}>{lembrado}</b> em {segundos}s…</p>
            <button style={S.botao} onClick={() => router.replace(`/tv/${lembrado}`)}>Abrir agora</button>
            <button
              style={S.link}
              onClick={() => { try { localStorage.removeItem(CHAVE_DO_CODIGO); } catch {} setLembrado(null); setTimeout(() => campo.current?.focus(), 50); }}
            >
              Usar outro código
            </button>
          </>
        ) : (
          <>
            <p style={S.texto}>Digite o código que aparece no painel da loja, em <b>Painel de senhas</b>.</p>
            {erro && <p style={S.erro}>{erro}</p>}
            <input
              ref={campo}
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, TAMANHO_DO_CODIGO))}
              onKeyDown={(e) => { if (e.key === "Enter") abrir(); }}
              placeholder="ABC234"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              style={S.campo}
              aria-label="Código do painel"
            />
            <button style={{ ...S.botao, opacity: valido ? 1 : 0.4 }} disabled={!valido} onClick={abrir}>Abrir painel</button>
          </>
        )}
      </div>
      <p style={S.rodape}>FireHub · sistema para restaurantes · firehubfood.com.br</p>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  fundo: {
    minHeight: "100vh", background: "radial-gradient(circle at 50% 20%, #1f2937 0%, #0b0f17 70%)", color: "#fff",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: 24,
    fontFamily: "Inter, system-ui, sans-serif",
  },
  caixa: {
    width: "100%", maxWidth: 520, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 24, padding: "40px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center",
  },
  titulo: { margin: 0, fontSize: 32, fontWeight: 800 },
  texto: { margin: 0, fontSize: 18, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 },
  erro: { margin: 0, fontSize: 16, color: "#FCA5A5", fontWeight: 600 },
  campo: {
    width: "100%", fontSize: 44, fontWeight: 800, letterSpacing: 12, textAlign: "center", padding: "14px 12px",
    borderRadius: 16, border: "2px solid rgba(255,255,255,0.2)", background: "#0b0f17", color: "#fff", outline: "none",
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  },
  botao: {
    width: "100%", fontSize: 20, fontWeight: 800, padding: "16px", borderRadius: 14, border: "none",
    background: "#DC2626", color: "#fff", cursor: "pointer",
  },
  link: { background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 16, cursor: "pointer", textDecoration: "underline" },
  rodape: { margin: 0, fontSize: 14, color: "rgba(255,255,255,0.4)" },
};
