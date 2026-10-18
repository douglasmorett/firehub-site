"use client";

/**
 * O Clube do aplicativo no cardápio (lib/clube): está no app da loja? qual a
 * situação de quem está logado? e o botão "Assinar".
 *
 * A sessão do login (lib/sessao-do-cliente.ts) fica no aparelho: é ela que
 * prova ao servidor que o desconto é do dono do telefone, e é com ela que o
 * login volta sozinho quando o cliente fecha e abre o app.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SituacaoDoClube = "ativo" | "pendente" | "encerrado" | "nao_assinante";
export type ClubeDaLoja = { nome: string; valor: number; percentual: number; teto: number | null };
export type ClienteDaSessao = { id: string; name: string; phone: string; address: string | null; birthDate: string | null };

const CHAVE_DA_SESSAO = "fh_sessao_cliente";

export function lerSessaoGuardada(): string | null {
  try { return localStorage.getItem(CHAVE_DA_SESSAO); } catch { return null; }
}
export function guardarSessao(sessao: string | null | undefined) {
  try {
    if (sessao) localStorage.setItem(CHAVE_DA_SESSAO, sessao);
    else localStorage.removeItem(CHAVE_DA_SESSAO);
  } catch {}
}

/** O cardápio está aberto dentro do app da loja (apps/loja)? */
export function estaNoAplicativo(): boolean {
  if (typeof window === "undefined") return false;
  return /\bFireHubApp\/\d/.test(navigator.userAgent) || Boolean((window as any).ReactNativeWebView);
}

export function useClubeDoApp(lojaId: string, ligado: boolean) {
  const [noApp, setNoApp] = useState(false);
  const [sessao, setSessaoState] = useState<string | null>(null);
  const [clube, setClube] = useState<ClubeDaLoja | null>(null);
  const [situacao, setSituacao] = useState<SituacaoDoClube>("nao_assinante");
  const [pagoAte, setPagoAte] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteDaSessao | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState("");
  const consultando = useRef(false);

  useEffect(() => {
    setNoApp(estaNoAplicativo());
    setSessaoState(lerSessaoGuardada());
  }, []);

  const setSessao = useCallback((s: string | null | undefined) => {
    guardarSessao(s);
    setSessaoState(s || null);
    if (!s) { setCliente(null); setSituacao("nao_assinante"); setPagoAte(null); }
  }, []);

  const consultar = useCallback(async () => {
    if (!ligado || !lojaId || consultando.current) return;
    const atual = lerSessaoGuardada();
    // No navegador e sem login, não há o que perguntar (o clube é do app).
    if (!atual && !estaNoAplicativo()) return;
    consultando.current = true;
    try {
      const r = await fetch(`/api/clube?loja=${encodeURIComponent(lojaId)}`, {
        cache: "no-store",
        headers: atual ? { "x-sessao-cliente": atual } : {},
      });
      if (!r.ok) return;
      const d = await r.json();
      setClube(d.clube || null);
      setSituacao(d.situacao || "nao_assinante");
      setPagoAte(d.pagoAte || null);
      setCliente(d.cliente || null);
      // Sessão que não vale mais (conta excluída, vencida): sai do aparelho.
      if (atual && !d.cliente) { guardarSessao(null); setSessaoState(null); }
    } catch {
      // sem rede: o cardápio segue sem o clube
    } finally {
      consultando.current = false;
    }
  }, [ligado, lojaId]);

  useEffect(() => { consultar(); }, [consultar, sessao]);

  // Voltou da Cakto (o checkout abre fora do app): confere de novo — o webhook
  // costuma chegar em segundos.
  useEffect(() => {
    if (!ligado) return;
    const aoVoltar = () => { if (document.visibilityState === "visible") consultar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [ligado, consultar]);

  /** Abre o checkout da Cakto. Sem login devolve "entrar" para o cardápio abrir o login. */
  const assinar = useCallback(async (): Promise<"ok" | "entrar" | "erro"> => {
    const atual = lerSessaoGuardada();
    if (!atual) return "entrar";
    setAbrindo(true);
    setErro("");
    try {
      const r = await fetch("/api/clube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loja: lojaId, sessao: atual }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && d.precisaEntrar) { setSessao(null); return "entrar"; }
      if (!r.ok || !d.checkout) { setErro(d.error || "Não foi possível abrir a assinatura agora."); return "erro"; }
      // No app, a página de pagamento abre no navegador do celular (apps/loja
      // manda para fora o que não é da loja) e o cliente volta para o app.
      if (estaNoAplicativo()) window.location.href = d.checkout;
      else window.open(d.checkout, "_blank", "noopener");
      return "ok";
    } catch {
      setErro("Sem conexão. Tente de novo.");
      return "erro";
    } finally {
      setAbrindo(false);
    }
  }, [lojaId, setSessao]);

  return {
    noApp,
    sessao,
    setSessao,
    clube,
    situacao,
    pagoAte,
    cliente,
    assinar,
    abrindo,
    erro,
    consultar,
    /** O desconto vale neste aparelho agora. */
    descontoValendo: noApp && !!clube && situacao === "ativo" && !!sessao,
  };
}
