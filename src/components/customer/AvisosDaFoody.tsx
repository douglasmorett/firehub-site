"use client";
/**
 * O aviso no topo do painel de pedidos quando a chamada automática (ou manual)
 * ao motoboy da Foody/Voe falhou. Sem ele a falha ficava só no log: o status
 * do pedido mudou normalmente, e ninguém sabia que o motoboy não foi chamado.
 *
 * Loja sem a integração responde { ligada: false } e a tela para de perguntar.
 * Com ela, relê a cada minuto. "Dispensar" esconde só nesta tela (até a
 * próxima falha nova).
 */
import { useEffect, useState } from "react";

type Falha = { pedidoId: string; numero: number | null; erro: string; quando: string };

export default function AvisosDaFoody() {
  const [falhas, setFalhas] = useState<Falha[]>([]);
  const [dispensadas, setDispensadas] = useState<Record<string, string>>({});

  useEffect(() => {
    let parar = false;
    let relogio: ReturnType<typeof setTimeout> | null = null;
    const ler = () => {
      fetch("/api/store/foody/avisos", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (parar || !d) return;
          setFalhas(Array.isArray(d.falhas) ? d.falhas : []);
          if (d.ligada) relogio = setTimeout(ler, 60_000);
        })
        .catch(() => { if (!parar) relogio = setTimeout(ler, 120_000); });
    };
    ler();
    return () => { parar = true; if (relogio) clearTimeout(relogio); };
  }, []);

  const visiveis = falhas.filter((f) => dispensadas[f.pedidoId] !== f.quando);
  if (!visiveis.length) return null;

  return (
    <div role="alert" style={{ margin: "0 0 12px", background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 12, padding: "10px 14px", color: "#7F1D1D" }}>
      <div style={{ fontWeight: 900, fontSize: "0.9rem", marginBottom: 4 }}>🛵 Atenção com a Voe/Foody</div>
      {visiveis.slice(0, 4).map((f) => (
        <div key={f.pedidoId} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", fontSize: "0.82rem", padding: "3px 0", flexWrap: "wrap" }}>
          <span>
            <b>Pedido {f.numero ? `#${f.numero}` : ""}</b> — {f.erro}. Confira em <b>Informações da entrega</b> do pedido.
          </span>
          <button type="button" onClick={() => setDispensadas((d) => ({ ...d, [f.pedidoId]: f.quando }))}
            style={{ border: "none", background: "transparent", color: "#991B1B", fontWeight: 800, cursor: "pointer", fontSize: "0.78rem" }}>
            Dispensar
          </button>
        </div>
      ))}
    </div>
  );
}
