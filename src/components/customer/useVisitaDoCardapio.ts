"use client";
/**
 * O cardápio avisa o funil do site (lib/funil-do-site.ts): a entrada, o
 * produto aberto, o carrinho, o checkout e o pedido — e, com a aba aberta e à
 * vista, um sinal a cada 45 s para o "no seu site agora" da Início.
 *
 * A pessoa é um id aleatório guardado no navegador (sem nome, sem telefone).
 * Cada etapa vai uma vez por página; o servidor junta tudo numa linha por dia.
 * Nada aqui pode atrapalhar o pedido: sendBeacon, sem esperar resposta, e
 * qualquer erro é engolido.
 */
import { useCallback, useEffect, useRef } from "react";
import { BATIDA_DO_ONLINE_MS, type EtapaDoFunil } from "@/lib/funil-do-site-regras";

const CHAVE = "fh_visitante";

function idDoVisitante(): string {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo && /^[a-z0-9-]{8,64}$/i.test(salvo)) return salvo;
    const novo = (crypto as any)?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(CHAVE, novo);
    return novo;
  } catch {
    // Sem storage (aba anônima travada): vale só para esta página.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** `ativo` = false no modo mesa, garçom, totem e lanche da equipe. */
export function useVisitaDoCardapio(slug: string | null | undefined, ativo: boolean) {
  const sessao = useRef<string>("");
  const origem = useRef<{ utm: string; referrer: string }>({ utm: "", referrer: "" });
  const enviadas = useRef(new Set<string>());

  const enviar = useCallback((etapa: EtapaDoFunil | "batida") => {
    if (!ativo || !slug || !sessao.current) return;
    try {
      const corpo = JSON.stringify({ slug, sessao: sessao.current, etapa, ...origem.current });
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/loja/visita", corpo);
      } else {
        fetch("/api/loja/visita", { method: "POST", body: corpo, keepalive: true }).catch(() => {});
      }
    } catch { /* o funil nunca atrapalha o pedido */ }
  }, [ativo, slug]);

  /** Marca a etapa (uma vez por página). */
  const marcar = useCallback((etapa: EtapaDoFunil) => {
    if (enviadas.current.has(etapa)) return;
    enviadas.current.add(etapa);
    enviar(etapa);
  }, [enviar]);

  useEffect(() => {
    if (!ativo || !slug) return;
    sessao.current = idDoVisitante();
    try {
      const url = new URL(window.location.href);
      origem.current = { utm: url.searchParams.get("utm_source") || "", referrer: document.referrer || "" };
    } catch { /* sem origem */ }
    marcar("visita");

    // O "online agora": só com a aba à vista (aba esquecida no fundo não é gente no site).
    const bater = () => { if (document.visibilityState === "visible") enviar("batida"); };
    const relogio = window.setInterval(bater, BATIDA_DO_ONLINE_MS);
    const aoVoltar = () => { if (document.visibilityState === "visible") enviar("batida"); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      window.clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [ativo, slug, marcar, enviar]);

  return marcar;
}
