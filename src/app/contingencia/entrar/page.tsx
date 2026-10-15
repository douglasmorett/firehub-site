"use client";

/**
 * /contingencia/entrar — a porta de entrada no computador da loja durante uma
 * queda (Modo Contingência).
 *
 * A tela que estava na nuvem chega aqui com o bilhete DELA no fragmento do
 * endereço (#bilhete=...&volta=/store/...): o bilhete que a própria sessão
 * desta tela pediu à nuvem enquanto havia internet. Só reabre a mesma conta,
 * com as mesmas permissões. Fragmento porque não vai para servidor nenhum
 * nem fica em log: só este JavaScript lê, entrega ao FireHub local e apaga.
 *
 * A tela pode chegar uns segundos ANTES de o computador declarar a
 * contingência (cada lado conta as falhas no seu relógio): espera a porta da
 * loja confirmar; se ela disser que a nuvem está de pé, volta para a nuvem.
 *
 * Sem bilhete (o FireHub local manda para cá quem chega sem sessão — a senha
 * do painel não desce para o computador, então a tela de login local não
 * serviria): o botão "Entrar" abre o MESMO endereço na nuvem. Sem internet, a
 * rede de segurança do navegador (public/sw-contingencia.js) responde no lugar
 * da nuvem e traz de volta com o bilhete guardado. (14/10/2026)
 *
 * O fragmento traz também (lib/contingencia/troca.ts): de que endereço a tela
 * saiu (`origem`, com ou sem www), quantos pulos seguidos já houve (`n`) e as
 * preferências que só existem por origem (`p`: som e posição do KDS). Ficam
 * guardados AQUI, na origem da loja: a volta usa a mesma origem (validada
 * pela lista fixa) e leva a marca #fh-voltou=<ms>&n=<pulos> — com ela a nuvem
 * não pula de novo logo em seguida (o vaivém de 14/10).
 */
import { useEffect, useState } from "react";
import {
  CHAVE_DA_ORIGEM, CHAVE_DOS_PULOS, VOLTA_PADRAO, armazenamentoLocal, gravarPreferencias, lerPreferencias, origemValida,
  preferenciasDoFragmento, urlDeVolta, voltaSegura,
} from "@/lib/contingencia/troca";

function destinoSeguro(volta: string | null): string {
  return voltaSegura(volta) || VOLTA_PADRAO;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

type EstadoDaPorta = { modo?: string; nuvem?: string; origensDaNuvem?: unknown; origemDoPainel?: string };

/** O que a porta da loja diz (o supervisor sabe o endereço da nuvem); sem ela, null. */
async function estadoDaPorta(): Promise<EstadoDaPorta | null> {
  try {
    return await (await fetch("/__contingencia/estado", { cache: "no-store" })).json();
  } catch {
    return null;
  }
}

/**
 * Para onde voltar na nuvem: a origem de onde a tela saiu (se estiver na
 * lista), senão a do painel no supervisor, senão a nuvem dele, senão a de sempre.
 */
function origemDaVolta(saiuDe: string | null, e: EstadoDaPorta | null): string {
  const nuvem = typeof e?.nuvem === "string" && /^https?:\/\//.test(e.nuvem) ? e.nuvem.replace(/\/+$/, "") : null;
  const extras = Array.isArray(e?.origensDaNuvem) ? e!.origensDaNuvem : nuvem ? [nuvem] : [];
  return origemValida(saiuDe, extras) || origemValida(e?.origemDoPainel, extras) || nuvem || "https://firehubfood.com.br";
}

export default function EntrarNaContingencia() {
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("Sem conexão com o FireHub. Entrando no computador da loja…");
  /** Para onde o botão "Entrar" leva (o mesmo endereço, na nuvem), quando não há bilhete. */
  const [entrarPor, setEntrarPor] = useState("");

  useEffect(() => {
    const parametros = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const bilhete = parametros.get("bilhete") || "";
    const volta = destinoSeguro(parametros.get("volta") || new URLSearchParams(window.location.search).get("volta"));
    // De onde a tela saiu e quantos pulos já houve: para a volta (TrocaDeContingencia).
    // Só guarda origem que esteja na lista fixa — o resto do caminho valida de novo.
    const saiuDe = origemValida(parametros.get("origem"));
    const pulos = Math.max(1, Math.trunc(Number(parametros.get("n"))) || 1);
    const guardar = (k: string, v: string | null) => {
      for (const area of [() => sessionStorage, () => localStorage]) {
        try { if (v === null) area().removeItem(k); else area().setItem(k, v); } catch { /* sem armazenamento */ }
      }
    };
    if (parametros.has("bilhete")) {
      guardar(CHAVE_DA_ORIGEM, saiuDe);
      guardar(CHAVE_DOS_PULOS, String(pulos));
    }
    // O som e a posição do KDS desta TV (no endereço da loja o armazenamento é outro).
    try { gravarPreferencias(armazenamentoLocal(), preferenciasDoFragmento(parametros)); } catch { /* sem armazenamento */ }
    history.replaceState(null, "", window.location.pathname);
    const semBilhete = (texto: string) => {
      setErro(texto);
      estadoDaPorta().then((e) => setEntrarPor(`${origemDaVolta(saiuDe, e)}${volta}`));
    };
    if (!bilhete) {
      semBilhete("");
      return;
    }
    let vivo = true;
    (async () => {
      for (let i = 0; i < 45 && vivo; i++) {
        try {
          const e = await (await fetch("/__contingencia/estado", { cache: "no-store" })).json();
          if (e?.modo === "contingencia" || e?.modo === "voltando") break;
          if (e?.modo === "normal" && e?.nuvem) {
            setAviso("A conexão voltou. Voltando ao FireHub…");
            // Com a marca de volta: a nuvem espera antes de pular de novo.
            window.location.replace(urlDeVolta({
              origem: origemDaVolta(saiuDe, e),
              volta,
              em: Date.now(),
              n: pulos,
              extras: Array.isArray(e?.origensDaNuvem) ? e.origensDaNuvem : [String(e.nuvem).replace(/\/+$/, "")],
              preferencias: lerPreferencias(armazenamentoLocal()),
            }));
            return;
          }
          setAviso("Conectando ao computador da loja…");
        } catch {
          /* a porta da loja respondendo devagar */
        }
        await espera(2000);
      }
      const r = await fetch("/api/contingencia/entrar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bilhete }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Não foi possível entrar.");
      window.location.replace(volta);
    })().catch((e) => vivo && semBilhete(e?.message || "Não foi possível entrar."));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f172a", color: "#f8fafc", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        {/* Desenho no lugar do emoji 🛟: o Windows 10 não tem esse emoji e mostrava um quadrado. */}
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }} aria-hidden>
          <circle cx="12" cy="12" r="10" /><path d="m4.93 4.93 4.24 4.24" /><path d="m14.83 9.17 4.24-4.24" /><path d="m14.83 14.83 4.24 4.24" /><path d="m9.17 14.83-4.24 4.24" /><circle cx="12" cy="12" r="4" />
        </svg>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Modo Contingência</h1>
        {entrarPor ? (
          <>
            <p style={{ color: "#cbd5e1", margin: "0 0 16px", lineHeight: 1.5 }}>
              Sem internet, o FireHub abre neste computador. Clique em <strong>Entrar</strong>: o navegador usa a entrada que guardou e
              você continua de onde parou, sem senha.
            </p>
            <a
              href={entrarPor}
              style={{ display: "inline-block", background: "linear-gradient(135deg,#8B5CF6,#6D28D9)", color: "#fff", fontWeight: 800, fontSize: 16, padding: "12px 28px", borderRadius: 12, textDecoration: "none" }}
            >
              Entrar
            </a>
            <p style={{ color: "#94a3b8", fontSize: 13, margin: "16px 0 0", lineHeight: 1.5 }}>
              Funciona em todo aparelho que já abriu o FireHub depois que o Modo Contingência foi ativado. O garçom entra pelo link dele, com a senha de sempre.
              {erro ? <span style={{ display: "block", marginTop: 6, color: "#fca5a5" }}>{erro}</span> : null}
            </p>
          </>
        ) : (
          <p style={{ color: erro ? "#fca5a5" : "#cbd5e1", margin: 0 }}>{erro || aviso}</p>
        )}
      </div>
    </main>
  );
}
