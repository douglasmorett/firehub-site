"use client";
import { useEffect, useRef, useState } from "react";
import { buscarCaixaFechado, type CaixaFechadoApurado } from "@/components/customer/VendasPorTipoDoCaixa";

/**
 * As linhas fora da gaveta de um caixa JÁ FECHADO, na tabela do Histórico:
 * o pago online por canal, o que o entregador do app cobrou, o aguardando
 * pagamento, o fiado, as formas próprias e a forma não identificada — as
 * mesmas do modal de fechamento (StoreTopNav). Douglas, 24/10/2026: "tem que
 * manter informando detalhado pago online, pix online, tudo no histórico de
 * caixa depois que fecha".
 *
 * O caixa fechado só grava o total do online, então o detalhe é apurado de
 * novo (api/cash-session/por-tipo) quando o caixa aparece na tela — não os 60
 * ao abrir a página. "Mesas ainda abertas" fica de fora: refeita hoje, diria
 * as mesas abertas de agora, não as da hora do fechamento.
 */
const fmt = (v: number) => `${v < -0.004 ? "−" : ""}R$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const td = { padding: "7px 16px" } as const;

function Linha({ nome, nota, valor, travado, cor, fundo }: { nome: string; nota: string; valor: number; travado?: boolean; cor: string; fundo: string }) {
  return (
    <tr style={{ borderBottom: "1px solid #F1F5F9", background: fundo }}>
      <td style={{ ...td, fontWeight: 600, color: cor }}>
        {nome}
        <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 500, opacity: 0.85 }}>{nota}</span>
      </td>
      <td style={{ ...td, textAlign: "right", color: cor, fontWeight: 700 }}>{fmt(valor)}</td>
      <td style={{ ...td, textAlign: "right", color: cor, fontWeight: 700 }}>{travado ? `🔒 ${fmt(valor)}` : "—"}</td>
      <td style={{ ...td, textAlign: "right", color: "#94A3B8" }}>—</td>
    </tr>
  );
}

const pedidos = (n: number) => `${n} ${n === 1 ? "pedido" : "pedidos"}`;

export default function ForaDaGavetaDoCaixaFechado({ sessionId }: { sessionId: string }) {
  const ref = useRef<HTMLTableRowElement>(null);
  const [estado, setEstado] = useState<"esperando" | "carregando" | "erro">("esperando");
  const [dados, setDados] = useState<CaixaFechadoApurado | null>(null);

  const carregar = async () => {
    setEstado("carregando");
    const j = await buscarCaixaFechado(sessionId);
    if (j) setDados(j);
    else setEstado("erro");
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((vistos) => {
      if (vistos.some((v) => v.isIntersecting)) { obs.disconnect(); carregar(); }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!dados) {
    return (
      <tr ref={ref}>
        <td colSpan={4} style={{ ...td, fontSize: "0.72rem", color: "#94A3B8" }}>
          {estado === "erro"
            ? <button type="button" onClick={carregar} style={{ background: "none", border: "none", padding: 0, color: "#B45309", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Não consegui somar o pago online por canal — tentar de novo</button>
            : "Somando o pago online por canal…"}
        </td>
      </tr>
    );
  }

  const fora = dados.foraDaConferencia;
  return (
    <>
      {(dados.onlinePorCanal || []).map((c) => (
        <Linha key={`online-${c.nome}`} nome={`⚡ ${c.nome} — pago online`} nota={`${pedidos(c.qtd)} · não passa pela gaveta`} valor={c.valor} travado cor="#1C1917" fundo="#FAF6F2" />
      ))}
      {(dados.cobradoPeloApp || []).map((c) => (
        <Linha key={`cobrado-${c.nome}`} nome={`🛵 ${c.nome} — o entregador do app cobrou`} nota={`${c.qtd} ${c.qtd === 1 ? "pedido pago" : "pedidos pagos"} na porta · o app repassa`} valor={c.valor} travado cor="#1C1917" fundo="#FAF6F2" />
      ))}
      {/* O cupom do pedido pago no app já está no online acima; o do pago na
          porta, o app repassa depois. Informação: não se conta. */}
      {((dados.cupomDaPlataforma || []) as { nome: string; qtd: number; valor: number; noOnline?: number }[]).filter((c) => c.valor > 0.005).map((c) => {
        const noOnline = Math.min(c.valor, c.noOnline || 0);
        const depois = Math.round((c.valor - noOnline) * 100) / 100;
        return (
          <Linha key={`cupom-${c.nome}`} nome={`🎟️ Cupons pagos pelo ${c.nome}`}
                 nota={`${noOnline > 0.005 ? `${fmt(noOnline)} já estão no repasse acima. ` : ""}${depois > 0.005 ? `${fmt(depois)} de pedidos pagos na porta: o ${c.nome} repassa depois. ` : ""}Não se conta na gaveta.`}
                 valor={c.valor} cor="#9A3412" fundo="#FFF4EF" />
        );
      })}
      {(dados.pendentes?.quantidade || 0) > 0 && (
        <Linha nome="⏳ Aguardando pagamento" nota={`${pedidos(dados.pendentes!.quantidade)} — fora da conferência`} valor={dados.pendentes!.valor} cor="#B45309" fundo="#FEFCE8" />
      )}
      {(fora?.fiadoQtd || 0) > 0 && (
        <Linha nome="📝 Fiado / conta da equipe" nota={`${pedidos(fora!.fiadoQtd)} — fora da conferência`} valor={fora!.fiado} cor="#1C1917" fundo="#FAF6F2" />
      )}
      {(fora?.proprias || []).filter((p) => p.qtd > 0).map((p) => (
        <Linha key={`propria-${p.nome}`} nome={`🪙 ${p.nome}`} nota={`${p.qtd} ${p.qtd === 1 ? "pagamento" : "pagamentos"} — forma própria, fora da gaveta`} valor={p.valor} cor="#5B21B6" fundo="#F5F3FF" />
      ))}
      {(fora?.naoIdentificadoQtd || 0) > 0 && (
        <Linha nome="❔ Forma não identificada" nota={`${pedidos(fora!.naoIdentificadoQtd)} — fora da conferência`} valor={fora!.naoIdentificado} cor="#475569" fundo="#F8FAFC" />
      )}
    </>
  );
}
