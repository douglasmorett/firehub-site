"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BotaoNaoVerMais, useNaoVerMais } from "./NaoVerMais";

/**
 * A faixa de "o iFood tirou a autorização desta loja" no topo do painel.
 *
 * A partir de 16/11/2026 o iFood remove a autorização da integradora nas lojas
 * paradas há 90 dias ou mais, e ela não volta sozinha. O cron do iFood percebe
 * (lib/ifood-autorizacao.ts) e marca a integração com `connected = false`;
 * esta faixa é o que faz o lojista ficar sabendo — sem ela, a loja voltaria a
 * vender no iFood e os pedidos simplesmente não entrariam no FireHub.
 *
 * Mesmo molde da faixa do robô caído (AvisoRoboDesconectado): só aparece
 * quando há o que fazer, relê a cada 5 min e o "não ver mais" cala esta
 * ocorrência (as lojas que caíram agora), não a próxima. Laranja do iFood, o
 * mesmo dos quadros da integração na tela de Integrações.
 */
export default function AvisoIfoodSemAutorizacao() {
  const [lojas, setLojas] = useState<{ merchantId: string; label: string }[]>([]);
  const ocorrencia = lojas.map((l) => l.merchantId).sort().join(",") || null;
  const naoVerMais = useNaoVerMais("ifood-sem-autorizacao", ocorrencia);

  useEffect(() => {
    let vivo = true;

    const conferir = async () => {
      try {
        const r = await fetch("/api/ifood/integration/list", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (!vivo) return;
        setLojas(
          (Array.isArray(d.integrations) ? d.integrations : []).filter(
            (i: { active?: boolean; connected?: boolean }) => i.active && i.connected === false
          )
        );
      } catch {
        // Silêncio de propósito: a faixa é um extra, nunca pode atrapalhar o painel.
      }
    };

    conferir();
    const t = setInterval(conferir, 5 * 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  if (lojas.length === 0 || !naoVerMais.pronto || naoVerMais.oculto) return null;

  const nomes = lojas.map((l) => l.label?.trim() || l.merchantId).join(", ");

  return (
    <Link
      href="/store/integracoes?abrir=ifood"
      style={{ textDecoration: "none", display: "block", margin: "0 0 1rem" }}
      aria-label="Autorizar o FireHub de novo no iFood"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.9rem",
          flexWrap: "wrap",
          background: "#FFF4EF",
          border: "1px solid #FFD3C2",
          borderLeft: "6px solid #9A3412",
          borderRadius: 12,
          padding: "0.9rem 1.1rem",
        }}
      >
        <span style={{ fontSize: "1.6rem", lineHeight: 1 }} aria-hidden>
          🔴
        </span>

        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 800, color: "#9A3412", fontSize: "1rem" }}>
            O iFood tirou a autorização do FireHub {lojas.length > 1 ? "nas lojas" : "na loja"} {nomes}
          </div>
          <div style={{ color: "#9A3412", fontSize: "0.88rem", marginTop: 2 }}>
            Acontece com loja parada no iFood há 90 dias ou mais. Enquanto você não autorizar de novo,
            os pedidos do iFood dela não entram aqui. Clique e conecte a loja de novo em Integrações › iFood.
          </div>
        </div>

        <span
          style={{
            background: "#9A3412",
            color: "#fff",
            fontWeight: 800,
            fontSize: "0.9rem",
            padding: "0.6rem 1.1rem",
            borderRadius: 10,
            whiteSpace: "nowrap",
          }}
        >
          Autorizar de novo
        </span>
        <BotaoNaoVerMais onClick={naoVerMais.ocultar} cor="#9A3412" borda="#FFD3C2" />
      </div>
    </Link>
  );
}
