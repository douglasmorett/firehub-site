"use client";
import { useEffect, useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";

/**
 * A faixa "JotaJá fora do ar" no painel de pedidos (lib/jotaja-instavel.ts).
 *
 * Em 24/10/2026 a API do JotaJá ficou uma hora respondendo 500 e a Duga
 * Burguer só soube pelo portal deles, duas horas depois. O cron registra a
 * queda; /api/store/avisos devolve `parceiroInstavel`; esta faixa mostra. Só
 * nesta tela, como os avisos do dia — é aqui que a loja olha os pedidos.
 */
const INTERVALO_DA_CONSULTA = 30_000;

type Parceiro = { canal: string; desde: string; ultimoErro?: string | null };

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export default function AvisoParceiroInstavel() {
  const [parceiro, setParceiro] = useState<Parceiro | null>(null);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const consultar = async () => {
      clearTimeout(timer);
      try {
        const r = await fetch("/api/store/avisos", { cache: "no-store" });
        if (r.ok && vivo) setParceiro(((await r.json()).parceiroInstavel as Parceiro | null) || null);
      } catch {
        // Sem rede: a próxima volta pergunta de novo.
      }
      if (vivo) timer = setTimeout(consultar, INTERVALO_DA_CONSULTA);
    };
    consultar();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, []);

  if (!parceiro) return null;
  return (
    <div
      role="alert"
      style={{
        background: PALETA.atencaoClaro,
        borderBottom: `2px solid ${PALETA.atencaoBorda}`,
        color: PALETA.carvao,
        padding: "10px 16px",
        fontWeight: 700,
        fontSize: "0.95rem",
        lineHeight: 1.4,
      }}
    >
      ⚠️ <b style={{ color: PALETA.atencao }}>{parceiro.canal} fora do ar desde {hora(parceiro.desde)}.</b>{" "}
      Pedido feito no {parceiro.canal} pode não estar entrando aqui: confira o portal do {parceiro.canal} e atenda por lá
      o que não aparecer no painel. A faixa some sozinha quando a API deles voltar.
    </div>
  );
}
