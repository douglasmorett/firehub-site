"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * A faixa de "seu robô caiu" no topo do painel.
 *
 * Por que ela existe: quando o WhatsApp de uma loja desconectava, NADA avisava
 * ninguém. O gateway tentava religar em silêncio (chegou a 26 tentativas numa
 * loja), o painel continuava com cara de normal, e o lojista só descobria pelo
 * cliente reclamando que ninguém respondeu — às vezes dias depois. Foi assim
 * que três lojas ficaram mudas ao mesmo tempo sem um único alarme.
 *
 * Ela só aparece para quem JÁ CONECTOU alguma vez e está fora agora (a regra
 * vem pronta de /api/chatbot/status-conexao). Enquanto estiver tudo certo, o
 * componente não desenha nada — faixa que aparece à toa vira paisagem, e aí
 * não serve para o dia em que importa.
 */
export default function AvisoRoboDesconectado() {
  const [precisa, setPrecisa] = useState(false);
  const [desde, setDesde] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;

    const conferir = async () => {
      try {
        const r = await fetch("/api/chatbot/status-conexao", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (!vivo) return;
        setPrecisa(Boolean(d.precisaReconectar));
        setDesde(d.desde || null);
      } catch {
        // Silêncio de propósito: a faixa é um extra, nunca pode atrapalhar o painel.
      }
    };

    conferir();
    // O lojista costuma deixar o painel aberto o dia inteiro. Sem isto, quem
    // abriu de manhã não veria a queda da tarde — e é justamente aí que o
    // aviso vale.
    const t = setInterval(conferir, 5 * 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  if (!precisa) return null;

  const haQuantoTempo = (() => {
    if (!desde) return "";
    const min = Math.floor((Date.now() - new Date(desde).getTime()) / 60000);
    if (!Number.isFinite(min) || min < 1) return "";
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.floor(h / 24)} dia(s)`;
  })();

  return (
    <Link
      href="/store/chatbot"
      style={{ textDecoration: "none", display: "block", margin: "0 0 1rem" }}
      aria-label="Religar o robô de WhatsApp"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.9rem",
          flexWrap: "wrap",
          background: "#FEF2F2",
          border: "1px solid #FCA5A5",
          borderLeft: "6px solid #DC2626",
          borderRadius: 12,
          padding: "0.9rem 1.1rem",
        }}
      >
        <span style={{ fontSize: "1.6rem", lineHeight: 1 }} aria-hidden>
          🤖
        </span>

        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 800, color: "#991B1B", fontSize: "1rem" }}>
            Seu robô de WhatsApp desconectou {haQuantoTempo}
          </div>
          <div style={{ color: "#7F1D1D", fontSize: "0.88rem", marginTop: 2 }}>
            Enquanto ele estiver fora, as mensagens dos seus clientes não são respondidas.
            Clique aqui e leia o QR Code de novo.
          </div>
        </div>

        <span
          style={{
            background: "#DC2626",
            color: "#fff",
            fontWeight: 800,
            fontSize: "0.9rem",
            padding: "0.6rem 1.1rem",
            borderRadius: 10,
            whiteSpace: "nowrap",
          }}
        >
          Religar agora
        </span>
      </div>
    </Link>
  );
}
