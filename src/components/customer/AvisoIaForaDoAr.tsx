"use client";
import { useEffect, useState } from "react";

/**
 * Faixa do painel: a inteligência artificial do robô está fora do ar.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * De 13 a 18/09/2026 o crédito do Gemini ficou esgotado e o robô de TODAS as
 * lojas respondeu cinco dias com frase fixa — sem anotar pedido, sem chamar
 * atendente. Ninguém soube: o alerta por WhatsApp depende do "WhatsApp do
 * Proprietário", que a conta matriz e 3 das 5 lojas com robô não têm cadastrado.
 *
 * Esta faixa não depende de telefone. Enquanto a IA estiver fora o robô avisa
 * cada cliente e passa a conversa para a equipe — a loja PRECISA saber que é
 * com ela. Sem botão de "não ver mais", de propósito: some sozinha quando a IA
 * volta, e esconder um incidente em andamento é repetir os cinco dias.
 *
 * Lê o mesmo /api/chatbot/status-conexao da faixa de robô desconectado
 * (lib/saude-da-ia.ts é quem guarda o estado).
 */
export default function AvisoIaForaDoAr() {
  const [ia, setIa] = useState<{ foraDoAr: boolean; desde: string | null; resumo: string | null; exigeAcao: boolean } | null>(null);

  useEffect(() => {
    let vivo = true;
    const conferir = async () => {
      try {
        const r = await fetch("/api/chatbot/status-conexao", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (vivo) setIa(d?.ia ?? null);
      } catch {
        /* sem rede: a faixa só não atualiza */
      }
    };
    conferir();
    // Mais curto que o da faixa de conexão (5 min): aqui há cliente esperando gente.
    const t = setInterval(conferir, 90_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  if (!ia?.foraDoAr) return null;

  const haQuantoTempo = (() => {
    if (!ia.desde) return "";
    const min = Math.floor((Date.now() - new Date(ia.desde).getTime()) / 60000);
    if (!Number.isFinite(min) || min < 1) return "agora há pouco";
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)} dia(s)`;
  })();

  return (
    <div
      role="alert"
      style={{
        display: "flex", alignItems: "center", gap: "0.9rem", flexWrap: "wrap",
        background: "#FEF2F2", border: "1px solid #FECACA", borderLeft: "6px solid #C92E09",
        borderRadius: 12, padding: "0.9rem 1.1rem", margin: "0 0 1rem",
      }}
    >
      <span style={{ fontSize: "1.6rem", lineHeight: 1 }} aria-hidden>🤖</span>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 800, color: "#B71C1C", fontSize: "1rem" }}>
          O robô está sem inteligência artificial {haQuantoTempo}
        </div>
        <div style={{ color: "#B71C1C", fontSize: "0.88rem", marginTop: 2, lineHeight: 1.45 }}>
          Ele NÃO está atendendo: avisa cada cliente e passa a conversa para a equipe. Responda pelo WhatsApp da loja
          ou pelo balãozinho vermelho.{" "}
          {ia.exigeAcao
            ? "Isso não volta sozinho — o suporte do FireHub precisa agir."
            : "Costuma voltar sozinho em alguns minutos."}
          {ia.resumo ? ` (${ia.resumo})` : ""}
        </div>
      </div>
    </div>
  );
}
