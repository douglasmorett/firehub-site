"use client";

import { useEffect, useState } from "react";
import { GATILHOS } from "./gatilhos";

/**
 * O pré-título do hero: um "você sabia?" de uma linha, acima da manchete.
 *
 * Casa o anúncio com a página. O anúncio que fala de posição manda para
 * `/prazos?g=posicao`; o que fala de atraso, `?g=atraso`; o de cliente,
 * `?g=cliente`. A pessoa lê na página o mesmo gancho que a fez clicar
 * (message match) — sem isso o primeiro segundo da página contradiz o
 * anúncio e ela sai. Sem `?g`, o primeiro gatilho.
 *
 * O primeiro é renderizado no servidor (aparece antes do JavaScript); o
 * `?g` troca depois de montar. Sem `useSearchParams` de propósito: ele
 * obrigaria Suspense e faria o hero inteiro esperar o cliente.
 */
export default function GatilhoDoHero() {
  const [g, setG] = useState(GATILHOS[0]);

  useEffect(() => {
    const chave = new URLSearchParams(window.location.search).get("g");
    const achado = GATILHOS.find((x) => x.chave === chave);
    if (achado) setG(achado);
  }, []);

  return (
    <div
      style={{
        display: "inline-flex", alignItems: "flex-start", gap: 10,
        background: "rgba(255,122,89,.12)", border: "1px solid rgba(255,122,89,.45)",
        borderRadius: 14, padding: "10px 14px", marginBottom: 18, maxWidth: 760,
        color: "#FFD9CF", lineHeight: 1.45, fontSize: ".98rem",
      }}
    >
      <span style={{ fontWeight: 900, color: "#FF7A59", whiteSpace: "nowrap", letterSpacing: ".3px", fontSize: ".8rem", marginTop: 3 }}>
        VOCÊ SABIA?
      </span>
      <span>{g.hero}</span>
    </div>
  );
}
