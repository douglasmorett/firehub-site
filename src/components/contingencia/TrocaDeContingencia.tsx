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
import { fetchAssistente } from "@/lib/print";
import { destinoDaTroca } from "@/lib/contingencia/troca";

const CHAVE = "firehub_contingencia";
const VOLTOU_EM = "firehub_contingencia_voltou_em";
/** "1"/"0": o computador da loja estava vivo no último sinal (lib/contingencia/troca.ts). */
const CHAVE_DO_PC = "firehub_contingencia_pc";
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

/**
 * A rede de segurança (public/sw-contingencia.js): só na loja com
 * contingência ativada. No painel cobre o site inteiro ("/"), para quem abre a
 * página inicial ou o login já sem internet; no garçom, o /garcom. Desativou, sai.
 */
function cuidarDaRedeDeSeguranca(ativa: boolean, tipo: "painel" | "garcom"): void {
  if (!("serviceWorker" in navigator)) return;
  // Sem a barra no fim: o escopo "/store/" deixava de fora o próprio /store (o
  // painel principal) — visto na prova de 12/10, a página caía no erro do Chrome.
  const escopo = tipo === "garcom" ? "/garcom" : "/";
  if (ativa) {
    navigator.serviceWorker.register("/sw-contingencia.js", { scope: escopo }).catch(() => {});
    return;
  }
  navigator.serviceWorker.getRegistrations().then((lista) => {
    for (const r of lista) if ((r.active?.scriptURL || "").endsWith("/sw-contingencia.js")) r.unregister();
  }).catch(() => {});
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

type EstadoNoAssistente = { endereco: string | null; testando: boolean; ativa: boolean };

/**
 * No computador do caixa, o Assistente sabe se a contingência está pronta, em
 * que porta, e se há um "Testar agora" em andamento (a nuvem está de pé, mas
 * este computador age como se tivesse caído).
 */
let semAssistenteAte = 0;

async function perguntarAoAssistente(): Promise<EstadoNoAssistente | null> {
  // Aparelho sem Assistente (a maioria das abas que não são o caixa): não
  // pergunta de novo por 1 minuto.
  if (Date.now() < semAssistenteAte) return null;
  for (const porta of PORTAS_DO_ASSISTENTE) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 1500);
      const r = await fetchAssistente(`http://127.0.0.1:${porta}/contingencia/estado`, { cache: "no-store", signal: c.signal }).finally(() => clearTimeout(t));
      if (!r.ok) continue;
      const e = await r.json();
      return {
        endereco: e?.pronta && e?.porta ? `http://127.0.0.1:${e.porta}` : null,
        testando: e?.testando === true,
        ativa: e?.ativa === true,
      };
    } catch {
      /* próxima porta */
    }
  }
  semAssistenteAte = Date.now() + 60_000;
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
  /** O último sinal da nuvem disse que o computador da loja está vivo (lib/contingencia/troca.ts). */
  const pcVivo = useRef(true);

  // ── Na nuvem: guardar o bilhete e vigiar a conexão ─────────────────────────
  useEffect(() => {
    if (naPortaDaLoja()) {
      setNaLoja(true);
      return;
    }
    let vivo = true;
    // O que o último sinal disse do computador da loja, de antes de esta tela abrir.
    try { pcVivo.current = localStorage.getItem(CHAVE_DO_PC) !== "0"; } catch { /* sem armazenamento */ }
    const renovar = () => {
      fetch("/api/contingencia/bilhete", { cache: "no-store", headers: tipo === "garcom" ? { "x-operador": "garcom" } : {} })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!vivo || !d) return;
          if (d.ativo) {
            localStorage.setItem(CHAVE, JSON.stringify(d));
            cuidarDaRedeDeSeguranca(true, tipo);
            return;
          }
          // Esta conta não tem a contingência. Só desarma (apaga o bilhete e a
          // rede de segurança) se o bilhete guardado for DESTA loja — ela
          // desativou. De outra loja, fica: o dono de duas lojas que troca de
          // loja no computador do caixa, ou o suporte que volta ao admin, não
          // pode desarmar a contingência da loja deste computador (visto em
          // 14/10/2026: o "Voltar ao admin" apagava tudo).
          let lojaGuardada: string | null = null;
          try { lojaGuardada = JSON.parse(localStorage.getItem(CHAVE) || "null")?.loja || null; } catch { /* guardado ilegível */ }
          if (!lojaGuardada || !d.loja || lojaGuardada === d.loja) {
            localStorage.removeItem(CHAVE);
            cuidarDaRedeDeSeguranca(false, tipo);
          }
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
      // "Testar agora" neste computador: pula sem esperar a nuvem cair. O
      // celular do garçom nunca é o computador do caixa: nem pergunta (o
      // Chrome do celular pediria permissão de rede local à toa).
      const noAssistente = tipo === "painel" ? await perguntarAoAssistente() : null;
      if (noAssistente?.testando && noAssistente.endereco) {
        falhas.current = 3;
      } else {
        try {
          const r = await comPrazo(`/api/contingencia/sinal?loja=${encodeURIComponent(guardado.loja)}`, 4000);
          if (r.ok) {
            falhas.current = 0;
            const d = await r.json().catch(() => null);
            const pcDisse = d?.pc !== false; // nuvem que não conta (versão antiga): como antes
            if (pcDisse !== pcVivo.current) {
              pcVivo.current = pcDisse;
              // Para a rede de segurança (public/sw-contingencia.js), que roda sem este componente.
              try { localStorage.setItem(CHAVE_DO_PC, pcDisse ? "1" : "0"); } catch { /* sem armazenamento */ }
            }
          } else {
            falhas.current += 1;
          }
        } catch {
          falhas.current += 1;
        }
      }
      if (falhas.current < 3) return;
      const destino = destinoDaTroca({
        contingenciaAqui: !!noAssistente?.ativa,
        enderecoNoAssistente: noAssistente?.endereco ?? null,
        pcVivo: pcVivo.current,
        enderecos: guardado.enderecos,
      });
      if (!destino) return; // o computador da loja não está pronto: fica e confere de novo
      indo.current = true;
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
      // Embaixo, no meio, sem pegar clique: em cima ela cobria a barra do
      // painel (caixa, site aberto, impressora) — visto na prova de 12/10.
      style={{
        position: "fixed", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 2147483000,
        maxWidth: "calc(100vw - 24px)", background: voltando ? "#166534" : "#92400e", color: "#fff",
        fontFamily: "system-ui, sans-serif", fontSize: 13, fontWeight: 700, lineHeight: 1.35,
        textAlign: "center", padding: "8px 14px", borderRadius: 999, pointerEvents: "none",
        boxShadow: "0 4px 16px rgba(0,0,0,.3)",
      }}
    >
      {voltando
        ? "✅ Conexão voltou — tudo foi enviado. Voltando ao FireHub…"
        : "⚠️ Sem conexão com o FireHub — trabalhando no computador da loja. Tudo será enviado quando voltar."}
    </div>
  );
}
