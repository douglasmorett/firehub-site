"use client";

import { useEffect, useState } from "react";

/**
 * A faixa de "a impressão parou".
 *
 * Comanda de mesa, de balcão e a conta da mesa não são empurradas para a
 * impressora: o Assistente no PC do caixa PUXA a fila da nuvem a cada 3 s.
 * Quando ele fecha, trava ou perde a configuração da loja, nada avisa — a
 * loja descobre pela comanda que não saiu, e o suporte só sabe indo ao PC.
 * O servidor carimba a última consulta (User.printQueuePolledAt); esta faixa
 * lê o carimbo.
 *
 * Dois casos, e as duas frases são diferentes de propósito:
 *   - consultou e parou → o programa fechou ou o PC está desligado;
 *   - NUNCA consultou, mas há impressora cadastrada → a fila não sabe qual é
 *     a loja (Assistente antigo, ou instalado sem clicar Salvar em
 *     Impressoras naquele PC). Foi exatamente o cenário do "pedido de mesa
 *     entra no sistema mas não imprime".
 *
 * Só aparece para loja com impressora cadastrada: quem não imprime pelo
 * Assistente não tem o que consertar.
 */
const TOLERANCIA_S = 3 * 60;

export default function AvisoImpressaoParada() {
  const [estado, setEstado] = useState<{ temImpressora: boolean; ultimoPoll: string | null; paradoHaSegundos: number | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    const conferir = async () => {
      try {
        const r = await fetch("/api/store/print-queue/status", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (vivo) setEstado(d);
      } catch {
        // Silêncio de propósito: a faixa é um extra e nunca pode atrapalhar o painel.
      }
    };
    conferir();
    const t = setInterval(conferir, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  if (!estado || !estado.temImpressora) return null;

  const nuncaConsultou = estado.ultimoPoll === null;
  const parado = !nuncaConsultou && (estado.paradoHaSegundos ?? 0) > TOLERANCIA_S;
  if (!nuncaConsultou && !parado) return null;

  const minutos = Math.floor((estado.paradoHaSegundos ?? 0) / 60);
  const tempo = minutos >= 120 ? `${Math.floor(minutos / 60)} horas` : `${minutos} min`;

  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: "0.9rem", flexWrap: "wrap",
        background: "#FFF7ED", border: "1px solid #FED7AA", borderLeft: "6px solid #EA580C",
        borderRadius: 12, padding: "0.9rem 1.1rem", margin: "0 0 1rem",
      }}
    >
      <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>🖨️</span>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: "#9A3412", fontSize: "0.95rem" }}>
          {nuncaConsultou
            ? "O Assistente de Impressão desta loja nunca consultou a fila da nuvem"
            : `A impressão automática parou há ${tempo}`}
        </div>
        <div style={{ color: "#C2410C", fontSize: "0.85rem", lineHeight: 1.5 }}>
          {nuncaConsultou
            ? "Comanda de mesa, de balcão e a conta da mesa dependem dessa fila. No PC do caixa, abra Impressoras no painel e clique em Salvar — isso manda a identificação da loja para o Assistente. Se ele for anterior à versão 1.2.1, instale o atual."
            : "Comanda de mesa, de balcão e a conta da mesa não vão sair até ele voltar. Confira se o Assistente de Impressão está aberto no PC do caixa e se o PC está ligado e com internet."}
        </div>
      </div>
      <a
        href="/store/impressoras"
        style={{
          background: "#EA580C", color: "#fff", textDecoration: "none", borderRadius: 10,
          padding: "10px 18px", fontWeight: 800, fontSize: "0.85rem", whiteSpace: "nowrap",
        }}
      >
        Abrir Impressoras →
      </a>
    </div>
  );
}
