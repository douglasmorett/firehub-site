"use client";

import { useEffect, useState } from "react";

/**
 * A faixa de "seu caixa está aberto há mais de um dia".
 *
 * Por que ela existe: o esperado do fechamento soma TUDO desde a abertura, sem
 * limite de tempo (src/app/api/cash-session/route.ts). Caixa que atravessa o
 * dia vai empilhando turno sobre turno, e quando alguém finalmente fecha
 * aparece um número que não dá para conferir com gaveta nenhuma. Medido em
 * 29/08/2026: Pastel da Paulista com 8 dias e R$ 10.210,97 acumulados, Ruíco
 * Burger com 14 dias.
 *
 * Ninguém abre o caixa querendo isso — esquece, o movimento vira, o dia acaba.
 * Por isso o lugar do aviso é o painel inteiro, e não a tela do caixa: quem
 * esqueceu não vai justamente até lá conferir.
 *
 * Roxo de propósito: âmbar e vermelho já são as cores de cobrança pendente e
 * conta bloqueada neste mesmo painel. Caixa aberto demais não é dívida, e
 * vestir o aviso com a roupa da cobrança faria o lojista ler "estão me
 * cobrando de novo" e passar direto. O roxo é a mesma cor que o fechamento usa
 * na linha de fiado — a família do caixa.
 *
 * Aparece só depois de 24h. Loja que abre às 10h e fecha à 1h da manhã seguinte
 * é operação normal, não descuido.
 */
export default function AvisoCaixaAberto24h() {
  const [horas, setHoras] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;

    const conferir = async () => {
      try {
        const r = await fetch("/api/cash-session", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (!vivo) return;
        const abertoEm = d?.session?.status === "OPEN" ? d?.session?.openedAt : null;
        if (!abertoEm) { setHoras(null); return; }
        const h = (Date.now() - new Date(abertoEm).getTime()) / 3_600_000;
        setHoras(Number.isFinite(h) ? h : null);
      } catch {
        // Silêncio de propósito: a faixa é um extra e nunca pode atrapalhar o painel.
      }
    };

    conferir();
    // O painel fica aberto o dia inteiro. Sem reconferir, quem abriu a tela às
    // 10h nunca veria o caixa cruzar as 24h à noite.
    const t = setInterval(conferir, 10 * 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  if (horas === null || horas < 24) return null;

  const dias = Math.floor(horas / 24);
  const tempo = dias >= 1
    ? `${dias} ${dias === 1 ? "dia" : "dias"}`
    : `${Math.floor(horas)} horas`;

  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: "0.9rem", flexWrap: "wrap",
        background: "#FAF5FF", border: "1px solid #E9D5FF", borderLeft: "6px solid #7E22CE",
        borderRadius: 12, padding: "0.9rem 1.1rem", margin: "0 0 1rem",
      }}
    >
      <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>🕒</span>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: "#6B21A8", fontSize: "0.95rem" }}>
          Seu caixa está aberto há {tempo}
        </div>
        <div style={{ color: "#7E22CE", fontSize: "0.85rem", lineHeight: 1.5 }}>
          Aconselhamos fechar e abrir de novo. Enquanto ele fica aberto, o fechamento vai somando
          as vendas de todos esses dias — e aí o valor esperado não bate com o dinheiro da gaveta.
        </div>
      </div>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("firehub:abrir-menu-caixa"))}
        style={{
          background: "#7E22CE", color: "#fff", border: "none", borderRadius: 10,
          padding: "10px 18px", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer",
          fontFamily: "inherit", whiteSpace: "nowrap",
        }}
      >
        Abrir o caixa →
      </button>
    </div>
  );
}
