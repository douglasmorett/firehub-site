"use client";

/**
 * A TROCA SOZINHA entre a nuvem e o computador da loja (Modo Contingência).
 * Obsidian: Projetos/FireHub - Modo Contingência.md, item 4.
 *
 * NA NUVEM (https://firehubfood.com.br), loja com contingência ativada:
 *   - guarda o bilhete desta tela (GET /api/contingencia/bilhete) e o
 *     endereço do computador da loja, renovados a cada 30 min;
 *   - confere a nuvem a cada 5 s (/api/contingencia/sinal), uma conferência
 *     por vez (a próxima só começa 5 s depois de a anterior acabar: com o
 *     setInterval, duas rodadas somavam falha juntas). Com ~45 s de queda
 *     seguida (QUEDA_ANTES_DE_PULAR_MS — decisão do Douglas depois da noite
 *     de 14/10) a tela vai para o computador da loja, levando o bilhete — a
 *     NAVEGAÇÃO de https para http da rede local é permitida; o que o
 *     navegador bloqueia é o fetch misto, por isso não dá para "testar" o
 *     endereço antes. No próprio computador do caixa, quem diz o endereço e a
 *     hora é o Assistente (127.0.0.1:7899), que já é alcançável daqui — e
 *     esse computador nunca vira "outro aparelho" (lib/contingencia/troca.ts);
 *   - ao voltar do computador da loja, lê a marca do fragmento
 *     (#fh-voltou=<ms>&n=<pulos>), guarda no localStorage DESTA origem e não
 *     pula de novo por 1, 3, 10 min (a nuvem firme por 2 min zera a conta).
 *
 * NO COMPUTADOR DA LOJA (http://<ip>:7890, a porta da loja):
 *   - mostra a faixa "Sem conexão — trabalhando no computador da loja";
 *   - pergunta à porta da loja (/__contingencia/estado) a cada 5 s. Quando a
 *     nuvem voltou e tudo subiu (modo "normal") e ESTE aparelho alcança a
 *     nuvem, volta para a mesma tela, no mesmo endereço (com ou sem www) de
 *     onde saiu, com a marca de volta — o cookie de lá continua, não pede senha.
 *
 * Loja sem contingência: não guarda bilhete e não confere nada — custo zero.
 */
import { useEffect, useRef, useState } from "react";
import { fetchAssistente } from "@/lib/print";
import {
  CHAVE_DA_ORIGEM, CHAVE_DA_VOLTA, CHAVE_DOS_PULOS, CHAVE_SOU_O_PC, NUVEM_FIRME_MS, armazenamentoLocal, destinoDaTroca, esperaDepoisDaVolta,
  gravarPreferencias, lerMarcaDeVolta, lerPreferencias, lerVoltaGuardada, origemValida, urlDeVolta, type MarcaDeVolta,
} from "@/lib/contingencia/troca";

const CHAVE = "firehub_contingencia";
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

type EstadoNoAssistente = { endereco: string | null; testando: boolean; ativa: boolean; modo: string | null };

/**
 * No computador do caixa, o Assistente sabe se a contingência está pronta, em
 * que porta, e se há um "Testar agora" em andamento (a nuvem está de pé, mas
 * este computador age como se tivesse caído).
 */
let semAssistenteAte = 0;

function souOPc(): boolean {
  try { return !!localStorage.getItem(CHAVE_SOU_O_PC); } catch { return false; }
}

async function perguntarAoAssistente(): Promise<EstadoNoAssistente | null> {
  // Aparelho sem Assistente (a maioria das abas que não são o caixa): não
  // pergunta de novo por 1 minuto. O computador do caixa (já viu o Assistente
  // com a contingência) pergunta sempre: o Assistente lento numa troca de
  // versão não pode transformá-lo em "outro aparelho" por 1 minuto.
  const doCaixa = souOPc();
  if (!doCaixa && Date.now() < semAssistenteAte) return null;
  for (const porta of PORTAS_DO_ASSISTENTE) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 1500);
      const r = await fetchAssistente(`http://127.0.0.1:${porta}/contingencia/estado`, { cache: "no-store", signal: c.signal }).finally(() => clearTimeout(t));
      if (!r.ok) continue;
      const e = await r.json();
      const ativa = e?.ativa === true;
      // Este navegador é (ou deixou de ser) o do computador do caixa.
      try {
        if (ativa) localStorage.setItem(CHAVE_SOU_O_PC, String(porta));
        else localStorage.removeItem(CHAVE_SOU_O_PC);
      } catch { /* sem armazenamento */ }
      return {
        endereco: e?.pronta && e?.porta ? `http://127.0.0.1:${e.porta}` : null,
        testando: e?.testando === true,
        ativa,
        modo: typeof e?.modo === "string" ? e.modo : null,
      };
    } catch {
      /* próxima porta */
    }
  }
  if (!doCaixa) semAssistenteAte = Date.now() + 60_000;
  return null;
}

/**
 * No computador do caixa, conta ao supervisor em que endereço esta tela usa o
 * FireHub (com ou sem "www": cada um guarda a própria entrada). É o que o
 * atalho da área de trabalho passa a abrir (contingencia/supervisor/atalho.ts).
 * Fora do computador do caixa (sem Assistente com a contingência), não faz nada.
 */
async function avisarOEnderecoAoComputador(porta: number): Promise<void> {
  const pc = await perguntarAoAssistente();
  if (!pc?.ativa) return;
  try {
    await fetchAssistente(`http://127.0.0.1:${porta || 7890}/__contingencia/origem?de=${encodeURIComponent(window.location.origin)}`, { method: "POST" });
  } catch {
    /* supervisor de versão anterior ou desligado: na próxima renovação */
  }
}

function naPortaDaLoja(): boolean {
  return window.location.protocol === "http:" && window.location.port === PORTA_DA_LOJA;
}

export default function TrocaDeContingencia({ tipo }: { tipo: "painel" | "garcom" }) {
  const [naLoja, setNaLoja] = useState(false);
  const [voltando, setVoltando] = useState(false);
  /** A loja voltou ao normal, mas este aparelho não alcança a nuvem (Wi-Fi dele). */
  const [semNuvemAqui, setSemNuvemAqui] = useState(false);
  /** Desde quando a nuvem falha sem parar (null = respondeu na última). */
  const quedaDesde = useRef<number | null>(null);
  /** Desde quando a nuvem responde sem parar (zera a conta de pulos). */
  const firmeDesde = useRef<number | null>(null);
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
    // Voltou do computador da loja: a marca vem no fragmento (o armazenamento
    // de lá é de outra origem). Guarda aqui — a página do service worker
    // também lê — e limpa o fragmento sem tocar na query (?stage=… do KDS) nem
    // no estado do Next.
    const marca = lerMarcaDeVolta(window.location.hash);
    if (marca) {
      try {
        localStorage.setItem(CHAVE_DA_VOLTA, JSON.stringify({ em: marca.em, n: marca.n }));
        gravarPreferencias(armazenamentoLocal(), marca.preferencias);
      } catch { /* sem armazenamento */ }
      history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
    }
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
            if (tipo === "painel") void avisarOEnderecoAoComputador(Number(d.porta) || 7890);
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
      // "Testar agora" neste computador: pula sem esperar a nuvem cair. O
      // celular do garçom nunca é o computador do caixa: nem pergunta (o
      // Chrome do celular pediria permissão de rede local à toa).
      const noAssistente = tipo === "painel" ? await perguntarAoAssistente() : null;
      if (!vivo) return;
      if (!(noAssistente?.testando && noAssistente.endereco)) {
        let ok = false;
        try {
          const r = await comPrazo(`/api/contingencia/sinal?loja=${encodeURIComponent(guardado.loja)}`, 4000);
          if (r.ok) {
            ok = true;
            const d = await r.json().catch(() => null);
            const pcDisse = d?.pc !== false; // nuvem que não conta (versão antiga): como antes
            if (pcDisse !== pcVivo.current) {
              pcVivo.current = pcDisse;
              // Para a rede de segurança (public/sw-contingencia.js), que roda sem este componente.
              try { localStorage.setItem(CHAVE_DO_PC, pcDisse ? "1" : "0"); } catch { /* sem armazenamento */ }
            }
          }
        } catch {
          /* sem resposta no prazo: conta como falha */
        }
        const agora = Date.now();
        if (ok) {
          quedaDesde.current = null;
          firmeDesde.current ??= agora;
          // A nuvem firme por 2 min: a próxima queda recomeça a conta de pulos.
          if (agora - firmeDesde.current >= NUVEM_FIRME_MS) {
            try { localStorage.removeItem(CHAVE_DA_VOLTA); } catch { /* sem armazenamento */ }
          }
          return;
        }
        firmeDesde.current = null;
        quedaDesde.current ??= agora;
      }
      let ultimaVolta: MarcaDeVolta | null = null;
      try { ultimaVolta = lerVoltaGuardada(localStorage); } catch { /* sem armazenamento */ }
      const destino = destinoDaTroca({
        contingenciaAqui: !!noAssistente?.ativa,
        enderecoNoAssistente: noAssistente?.endereco ?? null,
        pcVivo: pcVivo.current,
        enderecos: guardado.enderecos,
        quedaHaMs: quedaDesde.current ? Date.now() - quedaDesde.current : 0,
        souOPc: souOPc(),
        online: navigator.onLine,
        modoNoAssistente: noAssistente?.modo ?? null,
        testando: !!noAssistente?.testando,
        esperaDaVoltaMs: esperaDepoisDaVolta(ultimaVolta),
      });
      if (!destino) return; // fica e confere de novo
      indo.current = true;
      const fragmento = new URLSearchParams({
        bilhete: guardado.bilhete,
        volta: aqui(),
        tipo,
        n: String((ultimaVolta?.n || 0) + 1),
        origem: window.location.origin,
      });
      // O som e a posição do KDS só existem nesta origem: vão junto.
      const prefs = lerPreferencias(armazenamentoLocal());
      if (Object.keys(prefs).length) fragmento.set("p", JSON.stringify(prefs));
      window.location.href = `${destino}/contingencia/entrar#${fragmento.toString()}`;
    };
    // Uma conferência por vez: a próxima começa 5 s depois de a anterior acabar.
    let relogio: ReturnType<typeof setTimeout> | null = null;
    const rodar = async () => {
      try { await conferir(); } catch { /* a próxima confere */ }
      if (vivo && !indo.current) relogio = setTimeout(rodar, 5000);
    };
    relogio = setTimeout(rodar, 5000);
    return () => {
      vivo = false;
      clearInterval(relogioDoBilhete);
      if (relogio) clearTimeout(relogio);
    };
  }, [tipo]);

  // ── No computador da loja: a faixa e a volta ───────────────────────────────
  useEffect(() => {
    if (!naLoja) return;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | null = null;
    let nuvemOk = 0;
    const conferir = async (): Promise<boolean> => {
      try {
        const r = await comPrazo("/__contingencia/estado", 3000);
        const e = await r.json();
        if (!vivo || e?.modo !== "normal" || !e?.nuvem) {
          nuvemOk = 0;
          if (vivo) setSemNuvemAqui(false);
          return false;
        }
        // De onde a tela saiu (com ou sem www), validado pela lista fixa e
        // pelas origens que o supervisor conhece; na falta, a do painel dele.
        let saiuDe: string | null = null;
        let pulos = 1;
        try {
          saiuDe = sessionStorage.getItem(CHAVE_DA_ORIGEM) || localStorage.getItem(CHAVE_DA_ORIGEM);
          pulos = Number(sessionStorage.getItem(CHAVE_DOS_PULOS) || localStorage.getItem(CHAVE_DOS_PULOS)) || 1;
        } catch { /* sem armazenamento */ }
        const extras: unknown[] = Array.isArray(e?.origensDaNuvem) ? e.origensDaNuvem : [e.nuvem];
        const origem = origemValida(saiuDe, extras) || origemValida(e?.origemDoPainel, extras) || origemValida(e.nuvem, [e.nuvem]);
        // Só volta se ESTE aparelho alcança a nuvem (duas respostas seguidas):
        // a TV com o Wi-Fi ruim voltaria para uma página que não abre.
        try {
          const s = await comPrazo(`${origem || String(e.nuvem).replace(/\/+$/, "")}/api/contingencia/sinal`, 4000);
          nuvemOk = s.ok ? nuvemOk + 1 : 0;
        } catch {
          nuvemOk = 0;
        }
        if (!vivo) return false;
        setSemNuvemAqui(nuvemOk === 0);
        if (nuvemOk < 2) return false;
        setVoltando(true);
        const destino = urlDeVolta({
          origem,
          volta: aqui(),
          em: Date.now(),
          n: pulos,
          reserva: e.nuvem,
          extras,
          preferencias: lerPreferencias(armazenamentoLocal()),
        });
        setTimeout(() => { window.location.href = destino; }, 1500);
        return true;
      } catch {
        /* a porta da loja reiniciando: tenta de novo */
        return false;
      }
    };
    // Uma conferência por vez (setTimeout encadeado).
    const rodar = async () => {
      const foi = await conferir();
      if (vivo && !foi) relogio = setTimeout(rodar, 5000);
    };
    void rodar();
    return () => { vivo = false; if (relogio) clearTimeout(relogio); };
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
        : semNuvemAqui
          ? "⚠️ Trabalhando no computador da loja. A loja já tem internet, mas este aparelho não alcança o FireHub — confira o Wi-Fi dele."
          : "⚠️ Sem conexão com o FireHub — trabalhando no computador da loja. Tudo será enviado quando voltar."}
    </div>
  );
}
