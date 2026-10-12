"use client";

/**
 * A TROCA SOZINHA entre a nuvem e o computador da loja (Modo Contingência).
 * Obsidian: Projetos/FireHub - Modo Contingência.md, item 4.
 *
 * NA NUVEM (https://firehubfood.com.br), loja com contingência ativada:
 *   - guarda o bilhete desta tela (GET /api/contingencia/bilhete) e o
 *     endereço do computador da loja, renovados a cada 30 min;
 *   - confere a nuvem a cada 5 s (/api/contingencia/sinal). Três falhas
 *     seguidas (~15 s) e a tela vai para o computador da loja, levando o
 *     bilhete — a NAVEGAÇÃO de https para http da rede local é permitida; o
 *     que o navegador bloqueia é o fetch misto, por isso não dá para "testar"
 *     o endereço antes. No próprio computador do caixa, quem diz o endereço
 *     é o Assistente (127.0.0.1:7899), que já é alcançável daqui.
 *
 * NO COMPUTADOR DA LOJA (http://<ip>:7890, a porta da loja):
 *   - mostra a faixa "Sem conexão — trabalhando no computador da loja";
 *   - pergunta à porta da loja (/__contingencia/estado) a cada 5 s. Quando a
 *     nuvem voltou e tudo subiu (modo "normal"), volta para a mesma tela na
 *     nuvem — o cookie de lá continua, não pede senha.
 *
 * Loja sem contingência: não guarda bilhete e não confere nada — custo zero.
 */
import { useEffect, useRef, useState } from "react";

const CHAVE = "firehub_contingencia";
const VOLTOU_EM = "firehub_contingencia_voltou_em";
const PORTA_DA_LOJA = "7890";
const PORTAS_DO_ASSISTENTE = [7899, 7900, 7901, 7891];

type Guardado = { bilhete: string; enderecos: string[]; porta: number; loja: string; validoAte: string };

function lerGuardado(): Guardado | null {
  try {
    const g = JSON.parse(localStorage.getItem(CHAVE) || "null") as Guardado | null;
    if (!g?.bilhete || new Date(g.validoAte).getTime() < Date.now()) return null;
    return g;
  } catch {
    return null;
  }
}

function aqui(): string {
  return `${window.location.pathname}${window.location.search}`;
}

async function comPrazo(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

/** No computador do caixa, o Assistente sabe se a contingência está pronta e em que porta. */
async function enderecoPeloAssistente(): Promise<string | null> {
  for (const porta of PORTAS_DO_ASSISTENTE) {
    try {
      const r = await comPrazo(`http://127.0.0.1:${porta}/contingencia/estado`, 1500, { targetAddressSpace: "loopback" } as any);
      if (!r.ok) continue;
      const e = await r.json();
      if (e?.pronta && e?.porta) return `http://127.0.0.1:${e.porta}`;
      return null;
    } catch {
      /* próxima porta */
    }
  }
  return null;
}

function naPortaDaLoja(): boolean {
  return window.location.protocol === "http:" && window.location.port === PORTA_DA_LOJA;
}

export default function TrocaDeContingencia({ tipo }: { tipo: "painel" | "garcom" }) {
  const [naLoja, setNaLoja] = useState(false);
  const [voltando, setVoltando] = useState(false);
  const falhas = useRef(0);
  const indo = useRef(false);

  // ── Na nuvem: guardar o bilhete e vigiar a conexão ─────────────────────────
  useEffect(() => {
    if (naPortaDaLoja()) {
      setNaLoja(true);
      return;
    }
    let vivo = true;
    const renovar = () => {
      fetch("/api/contingencia/bilhete", { cache: "no-store", headers: tipo === "garcom" ? { "x-operador": "garcom" } : {} })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!vivo || !d) return;
          if (d.ativo) localStorage.setItem(CHAVE, JSON.stringify(d));
          else localStorage.removeItem(CHAVE);
        })
        .catch(() => { /* sem conexão: fica o bilhete que já estava guardado */ });
    };
    renovar();
    const relogioDoBilhete = setInterval(renovar, 30 * 60_000);

    const conferir = async () => {
      const guardado = lerGuardado();
      if (!guardado || indo.current) return;
      const voltouEm = Number(sessionStorage.getItem(VOLTOU_EM) || 0);
      if (Date.now() - voltouEm < 60_000) return; // acabou de voltar: não pular de novo
      try {
        const r = await comPrazo("/api/contingencia/sinal", 4000);
        falhas.current = r.ok ? 0 : falhas.current + 1;
      } catch {
        falhas.current += 1;
      }
      if (falhas.current < 3) return;
      indo.current = true;
      const destino = (await enderecoPeloAssistente()) || guardado.enderecos[0];
      if (!destino) { indo.current = false; return; }
      const fragmento = new URLSearchParams({ bilhete: guardado.bilhete, volta: aqui(), tipo }).toString();
      window.location.href = `${destino}/contingencia/entrar#${fragmento}`;
    };
    const relogio = setInterval(conferir, 5000);
    return () => {
      vivo = false;
      clearInterval(relogioDoBilhete);
      clearInterval(relogio);
    };
  }, [tipo]);

  // ── No computador da loja: a faixa e a volta ───────────────────────────────
  useEffect(() => {
    if (!naLoja) return;
    let vivo = true;
    const conferir = async () => {
      try {
        const r = await comPrazo("/__contingencia/estado", 3000);
        const e = await r.json();
        if (!vivo) return;
        if (e?.modo === "normal" && e?.nuvem) {
          setVoltando(true);
          sessionStorage.setItem(VOLTOU_EM, String(Date.now()));
          setTimeout(() => { window.location.href = `${e.nuvem}${aqui()}`; }, 1500);
        }
      } catch {
        /* a porta da loja reiniciando: tenta de novo */
      }
    };
    conferir();
    const relogio = setInterval(conferir, 5000);
    return () => { vivo = false; clearInterval(relogio); };
  }, [naLoja]);

  if (!naLoja) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 2147483000,
        background: voltando ? "#166534" : "#92400e", color: "#fff",
        fontFamily: "system-ui, sans-serif", fontSize: 13, fontWeight: 700,
        textAlign: "center", padding: "4px 12px", pointerEvents: "none",
        boxShadow: "0 1px 6px rgba(0,0,0,.25)",
      }}
    >
      {voltando
        ? "✅ Conexão voltou — tudo foi enviado. Voltando ao FireHub…"
        : "🛟 Sem conexão com o FireHub — trabalhando no computador da loja. Tudo será enviado quando voltar."}
    </div>
  );
}
