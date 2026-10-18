"use client";

/**
 * O Clube do aplicativo no cardápio (lib/clube): está no app da loja? qual a
 * situação de quem está logado? e os botões "Assinar" e "Cancelar".
 *
 * A sessão do login (lib/sessao-do-cliente.ts) fica no aparelho: é ela que
 * prova ao servidor que o desconto é do dono do telefone, e é com ela que o
 * login volta sozinho quando o cliente fecha e abre o app. A instalação do app
 * (`window.__FIREHUB_APP__`, posta pelo apps/loja) prova que o pedido é de
 * dentro do aplicativo — o clube no cartão (Asaas) exige as duas.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SituacaoDoClube = "ativo" | "pendente" | "encerrado" | "nao_assinante";
export type ClubeDaLoja = {
  nome: string;
  valor: number;
  percentual: number;
  teto: number | null;
  /** Quem cobra: a Cakto (Hakim) ou o cartão pelo Asaas da loja. */
  cobranca?: "cakto" | "asaas";
  /** false = com cupom no pedido, o clube não entra. */
  acumulaComCupom?: boolean;
  chamada?: string | null;
};
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

/** O id da instalação que o app põe na página antes de ela carregar (apps/loja PaginaDaLoja). */
export function instalacaoDoApp(): string | null {
  if (typeof window === "undefined") return null;
  const id = (window as any).__FIREHUB_APP__?.instalacaoId;
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}

export function useClubeDoApp(lojaId: string, ligado: boolean) {
  const [noApp, setNoApp] = useState(false);
  const [sessao, setSessaoState] = useState<string | null>(null);
  const [clube, setClube] = useState<ClubeDaLoja | null>(null);
  const [situacao, setSituacao] = useState<SituacaoDoClube>("nao_assinante");
  const [pagoAte, setPagoAte] = useState<string | null>(null);
  const [cancelado, setCancelado] = useState(false);
  const [temCadastroNoAsaas, setTemCadastroNoAsaas] = useState(false);
  const [cliente, setCliente] = useState<ClienteDaSessao | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState("");
  /** Voltou do pagamento (?clube=ok): confere algumas vezes até o Asaas confirmar. */
  const [confirmando, setConfirmando] = useState(false);
  const consultando = useRef(false);

  useEffect(() => {
    setNoApp(estaNoAplicativo());
    setSessaoState(lerSessaoGuardada());
  }, []);

  const setSessao = useCallback((s: string | null | undefined) => {
    guardarSessao(s);
    setSessaoState(s || null);
    if (!s) { setCliente(null); setSituacao("nao_assinante"); setPagoAte(null); setCancelado(false); }
  }, []);

  const consultar = useCallback(async (): Promise<SituacaoDoClube | null> => {
    if (!ligado || !lojaId || consultando.current) return null;
    const atual = lerSessaoGuardada();
    // No navegador e sem login, não há o que perguntar (o clube é do app).
    if (!atual && !estaNoAplicativo()) return null;
    consultando.current = true;
    try {
      const r = await fetch(`/api/clube?loja=${encodeURIComponent(lojaId)}`, {
        cache: "no-store",
        headers: atual ? { "x-sessao-cliente": atual } : {},
      });
      if (!r.ok) return null;
      const d = await r.json();
      // Clube no cartão sem a instalação na página (app instalado antes desta
      // versão, ou navegador): o servidor não daria o desconto, então nem aparece.
      setClube(d.clube && (d.clube.cobranca !== "asaas" || instalacaoDoApp()) ? d.clube : null);
      setSituacao(d.situacao || "nao_assinante");
      setPagoAte(d.pagoAte || null);
      setCancelado(d.cancelado === true);
      setTemCadastroNoAsaas(d.temCadastroNoAsaas === true);
      setCliente(d.cliente || null);
      // Sessão que não vale mais (conta excluída, vencida): sai do aparelho.
      if (atual && !d.cliente) { guardarSessao(null); setSessaoState(null); }
      return d.situacao || "nao_assinante";
    } catch {
      // sem rede: o cardápio segue sem o clube
      return null;
    } finally {
      consultando.current = false;
    }
  }, [ligado, lojaId]);

  useEffect(() => { consultar(); }, [consultar, sessao]);

  // Voltou do checkout (Cakto fora do app, Asaas dentro dele): confere de novo —
  // o aviso do pagamento costuma chegar em segundos.
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

  // O checkout do Asaas devolve para ?clube=ok: até 8 conferências, de 3 em 3 s.
  useEffect(() => {
    if (!ligado || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("clube") !== "ok") return;
    url.searchParams.delete("clube");
    window.history.replaceState(null, "", url.toString());
    setConfirmando(true);
    let vezes = 0;
    let parado = false;
    const conferir = async () => {
      if (parado) return;
      const s = await consultar();
      vezes++;
      if (s === "ativo" || vezes >= 8) { setConfirmando(false); return; }
      setTimeout(conferir, 3000);
    };
    setTimeout(conferir, 1500);
    return () => { parado = true; };
  }, [ligado, consultar]);

  /**
   * Abre o pagamento (Cakto ou checkout do Asaas). Sem login devolve "entrar";
   * no Asaas sem cadastro, "cpf" (o modal pede o CPF e chama de novo).
   */
  const assinar = useCallback(async (cpf?: string): Promise<"ok" | "entrar" | "cpf" | "erro"> => {
    const atual = lerSessaoGuardada();
    if (!atual) return "entrar";
    setAbrindo(true);
    setErro("");
    try {
      const r = await fetch("/api/clube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loja: lojaId, sessao: atual, instalacao: instalacaoDoApp(), ...(cpf ? { cpf } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && d.precisaEntrar) { setSessao(null); return "entrar"; }
      if (d.precisaCpf) { setErro(cpf ? d.error || "Confira o CPF." : ""); return "cpf"; }
      if (d.jaSocio) { await consultar(); return "ok"; }
      if (!r.ok || !d.checkout) { setErro(d.error || "Não foi possível abrir a assinatura agora."); return "erro"; }
      // No app: a Cakto abre no navegador do celular (apps/loja manda para fora
      // o que não é da loja); o checkout do Asaas abre dentro do app e volta ao cardápio.
      if (estaNoAplicativo()) window.location.href = d.checkout;
      else window.open(d.checkout, "_blank", "noopener");
      return "ok";
    } catch {
      setErro("Sem conexão. Tente de novo.");
      return "erro";
    } finally {
      setAbrindo(false);
    }
  }, [lojaId, setSessao, consultar]);

  /** O sócio cancela no app (clube do Asaas). O que já foi pago vale até acabar. */
  const cancelar = useCallback(async (): Promise<boolean> => {
    const atual = lerSessaoGuardada();
    if (!atual) return false;
    setAbrindo(true);
    setErro("");
    try {
      const r = await fetch("/api/clube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "cancelar", loja: lojaId, sessao: atual }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.error || "Não deu para cancelar agora."); return false; }
      await consultar();
      return true;
    } catch {
      setErro("Sem conexão. Tente de novo.");
      return false;
    } finally {
      setAbrindo(false);
    }
  }, [lojaId, consultar]);

  return {
    noApp,
    sessao,
    setSessao,
    clube,
    situacao,
    pagoAte,
    cancelado,
    temCadastroNoAsaas,
    cliente,
    assinar,
    cancelar,
    abrindo,
    erro,
    confirmando,
    consultar,
    /** O desconto vale neste aparelho agora. */
    descontoValendo: noApp && !!clube && situacao === "ativo" && !!sessao,
  };
}
