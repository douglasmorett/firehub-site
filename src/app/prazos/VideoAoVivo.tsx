"use client";

import { useState } from "react";

/**
 * O vídeo do topo: a gravação REAL da extensão trabalhando no Portal do
 * Parceiro (tutorial "extensao-ifood-ao-vivo", 85–117 s), pedida pelo dono
 * em 06/11/2026: "colocar o vídeo mostrando ela funcionando logo no topo".
 *
 * O arquivo (public/prazos/ao-vivo.mp4, 14 s, ~100 KB, sem áudio) é só o
 * topo da tabela "Tempo e taxa" recortado e ampliado — a tela inteira tem letra
 * pequena demais para celular. Os dois cortes de câmera da gravação (o
 * painel e a cena "esvaziou") ficaram de fora.
 *
 * A legenda não está queimada no vídeo: vem do tempo do player, em texto
 * grande, porque é ela que conta a história ("a fila cresceu → subiu").
 * Os tempos abaixo foram lidos quadro a quadro no arquivo final; trocou o
 * vídeo, refaça a tabela.
 */
const LEGENDAS: { ate: number; fila: string; prazo: string }[] = [
  { ate: 1.5, fila: "4 pedidos na fila", prazo: "28 min" },
  { ate: 7, fila: "A fila cresceu", prazo: "subiu para 38 min" },
  { ate: 10, fila: "6 pedidos na fila", prazo: "subiu para 58 min" },
  { ate: 12.5, fila: "A cozinha esvaziou", prazo: "descendo sozinho" },
  { ate: 99, fila: "Fila vazia", prazo: "voltou para 28 min" },
];

export default function VideoAoVivo() {
  const [i, setI] = useState(0);

  return (
    <figure style={{ margin: "0 0 22px", maxWidth: 400 }}>
      <div style={{ borderRadius: 18, overflow: "hidden", border: "1px solid rgba(255,255,255,.14)", boxShadow: "0 18px 50px rgba(0,0,0,.45)", background: "#fff" }}>
        <video
          src="/prazos/ao-vivo.mp4"
          poster="/prazos/ao-vivo-capa.jpg"
          width={540}
          height={470}
          muted
          autoPlay
          loop
          playsInline
          preload="metadata"
          aria-label="Gravação real do Portal do Parceiro: o tempo de entrega sobe de 28 para 58 minutos quando a fila enche e volta para 28 quando esvazia"
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            const novo = LEGENDAS.findIndex((l) => t < l.ate);
            if (novo !== i) setI(novo);
          }}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
        {/* A legenda vai embaixo do vídeo, não por cima: por cima ela tapava
            justamente as linhas de tempo que mudam. */}
        <div
          aria-hidden
          style={{ background: "#0B1220", color: "#fff", padding: "10px 14px", lineHeight: 1.25, borderTop: "3px solid #FF5722" }}
        >
          <div style={{ fontSize: ".85rem", color: "#CBD5E1", fontWeight: 700 }}>{LEGENDAS[i].fila}</div>
          <div style={{ fontSize: "1.2rem", fontWeight: 900, color: "#FF7A59" }}>Prazo no iFood: {LEGENDAS[i].prazo}</div>
        </div>
      </div>
      <figcaption style={{ color: "#94A3B8", fontSize: ".8rem", marginTop: 8 }}>
        Gravação real do Portal do Parceiro do iFood · quem muda o número é a extensão
      </figcaption>
    </figure>
  );
}
