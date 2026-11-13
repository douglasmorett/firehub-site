"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNaoVerMais } from "./NaoVerMais";

/**
 * A janela das novidades da homologação do iFood (12/11/2026): entregador do
 * iFood/99 no card do pedido e pausa nos apps pelo Bill.
 *
 * Só para loja com iFood conectado. Quem foi autorizado antes dos módulos
 * novos (lib/ifood-permissoes.ts) vê também "autorize de novo" — e a janela
 * volta uma vez por dia até a loja autorizar, porque sem isso as novidades não
 * funcionam. Quem já está liberado vê uma vez só.
 */
export default function NovidadesDoIfood() {
  const [lojas, setLojas] = useState<{ label: string; merchantId: string; faltaReautorizar?: boolean }[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/ifood/integration/list", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo || !d) return;
        setLojas((Array.isArray(d.integrations) ? d.integrations : []).filter((i: any) => i.active && i.connected !== false));
      })
      .catch(() => { /* a janela é um extra: sem rede, não aparece */ });
    return () => { vivo = false; };
  }, []);

  const precisam = (lojas || []).filter((l) => l.faltaReautorizar);
  const hoje = new Date().toISOString().slice(0, 10);
  const ocorrencia = lojas === null ? null : precisam.length ? `reautorizar-${hoje}` : "liberado";
  const aviso = useNaoVerMais("novidades-ifood-nov-2026", ocorrencia);

  if (!lojas || lojas.length === 0 || !aviso.pronto || aviso.oculto) return null;

  const item = (emoji: string, titulo: string, texto: string) => (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ fontSize: "1.3rem", lineHeight: 1.2 }}>{emoji}</div>
      <div>
        <div style={{ fontWeight: 800, color: "#1C1917", fontSize: "0.92rem" }}>{titulo}</div>
        <div style={{ color: "#57534E", fontSize: "0.82rem", lineHeight: 1.45 }}>{texto}</div>
      </div>
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Novidades do FireHub com o iFood"
      style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ background: "linear-gradient(135deg, #EA1D2C, #9A3412)", color: "#fff", padding: "18px 20px", borderRadius: "18px 18px 0 0" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.06em", opacity: 0.9 }}>NOVIDADE</div>
          <div style={{ fontSize: "1.2rem", fontWeight: 900, marginTop: 2 }}>O FireHub agora fala mais com o iFood</div>
          <div style={{ fontSize: "0.8rem", opacity: 0.92, marginTop: 4 }}>O iFood aprovou novas funções da integração. Veja o que muda:</div>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {item("🛵", "Chamar entregador do iFood no pedido",
            "Pedido do seu site, robô ou balcão ganha o botão “Chamar entregador”. Você vê o preço e o tempo antes de chamar e, no pedido da 99, compara com o 99 Entrega e escolhe o mais barato.")}
          {item("📍", "Quem vem e quando chega, no próprio pedido",
            "Depois de chamar, o pedido mostra o nome do entregador, o veículo e quanto falta para chegar na loja e no cliente — sem abrir o app do iFood. Dá para cancelar enquanto o app deixar.")}
          {item("⏸️", "Pausar no iFood e na 99 pelo Bill",
            "Acabou um item? Pause pelo Bill e ele pergunta: “Posso pausar no iFood e na 99 também?”. Um “sim” e pronto. Vale para reativar também.")}

          {precisam.length > 0 && (
            <div style={{ background: "#FFFBEB", border: "1.5px solid #FCD34D", borderRadius: 12, padding: "12px 14px", color: "#78350F", fontSize: "0.82rem", lineHeight: 1.45 }}>
              <div style={{ fontWeight: 900, marginBottom: 4 }}>🟡 Autorize o FireHub de novo no iFood para liberar</div>
              {precisam.length === 1 ? "A sua loja" : "As lojas"} <b>{precisam.map((l) => l.label || l.merchantId.slice(0, 8)).join(", ")}</b> {precisam.length === 1 ? "foi autorizada" : "foram autorizadas"} antes dessas funções existirem.
              Leva 2 minutos: em Integrações › iFood, clique em “Conectar e Autorizar no Portal iFood”, autorize e cole o código. Os pedidos continuam entrando normalmente.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, padding: "0 20px 18px" }}>
          {precisam.length > 0 ? (
            <>
              <button onClick={aviso.ocultar} style={{ flex: 1, padding: "0.7rem", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Depois
              </button>
              <Link href="/store/integracoes?abrir=ifood" onClick={aviso.ocultar}
                style={{ flex: 2, padding: "0.7rem", borderRadius: 10, background: "#EA1D2C", color: "#fff", fontWeight: 800, textAlign: "center", textDecoration: "none" }}>
                Autorizar agora
              </Link>
            </>
          ) : (
            <button onClick={aviso.ocultar} style={{ flex: 1, padding: "0.7rem", borderRadius: 10, border: "none", background: "#1C1917", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
              Entendi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
