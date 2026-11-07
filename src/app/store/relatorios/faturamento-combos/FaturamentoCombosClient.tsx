"use client";
/**
 * Faturamento de combos — a tela. A conta mora em
 * lib/relatorios/faturamento-combos.ts (o que é combo, a venda com combo e a
 * régua única: vendas e valor batem com o Faturamento por dia); aqui são os
 * filtros, os cartões, os combos que mais venderam e a tabela dia a dia.
 *
 * O SWF dá a % das vendas com combo por dia, só. A pergunta que o lojista
 * quer responder é outra: "o combo faz o cliente gastar mais?" — então o
 * cartão principal é o ticket COM combo contra o SEM combo, com a diferença
 * em reais, e embaixo vem quais combos puxam isso.
 */
import React from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { NOMES_DOS_DIAS, fmtDia, fmtPct, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import type { DiaDeCombos, ResultadoDosCombos, SomaDeCombos } from "@/lib/relatorios/faturamento-combos";

type Resposta = ResultadoDosCombos & {
  lojas: string[];
  periodo: { de: string; ate: string };
  hoje: string;
  /** Quantos produtos estão marcados como combo no cardápio das lojas. */
  combosNoCardapio: number;
};

const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 0.6rem", fontWeight: 800, verticalAlign: "bottom", lineHeight: 1.25 };
const td: React.CSSProperties = { padding: "7px 0.6rem" };

const reaisOuTraco = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtReais(v));
const pctOuTraco = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtPct(v * 100));

export default function FaturamentoCombosClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "mes");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("faturamento-combos", query);

  const t = dados?.total;
  const dif = dados?.diferencaDoTicket;

  return (
    <ModeloDoRelatorio
      titulo="Faturamento de combos"
      descricao="Quantas vendas levaram combo, quanto os combos venderam e se quem pede combo gasta mais. Dia a dia, com os combos que mais saíram."
      slug="faturamento-combos" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} />

      {dados && t && (
        <GradeDeCartoes>
          <Cartao rotulo="Vendas com combo" valor={pctOuTraco(t.pctComCombo)}
            detalhe={`${t.vendasComCombo.toLocaleString("pt-BR")} de ${t.vendas.toLocaleString("pt-BR")} vendas`} />
          <Cartao rotulo="Vendido em combos" valor={fmtReais(t.valorDosCombos)}
            detalhe={`${t.combos.toLocaleString("pt-BR")} combo${t.combos === 1 ? "" : "s"}${t.pctDoValor !== null ? ` · ${fmtPct(t.pctDoValor * 100)} do faturamento` : ""}`} />
          <Cartao rotulo="Ticket com combo" valor={reaisOuTraco(t.ticketComCombo)}
            tom={dif ? (dif.reais > 0 ? "ok" : dif.reais < 0 ? "atencao" : "neutro") : "neutro"}
            detalhe={dif
              ? `${dif.reais >= 0 ? "+" : "−"}${fmtReais(Math.abs(dif.reais))}${dif.pct !== null ? ` (${fmtPct(Math.abs(dif.pct) * 100)})` : ""} ${dif.reais >= 0 ? "a mais" : "a menos"} que sem combo`
              : "Sem venda com e sem combo para comparar"} />
          <Cartao rotulo="Ticket sem combo" valor={reaisOuTraco(t.ticketSemCombo)}
            detalhe={`Faturamento do período ${fmtReais(t.valor)}`} />
        </GradeDeCartoes>
      )}

      {dados && t && t.vendas === 0 && (
        <Bloco><Vazio texto="Nenhuma venda no período e filtros escolhidos. Tente um período maior ou tire algum filtro." /></Bloco>
      )}

      {dados && t && t.vendas > 0 && t.combos === 0 && (
        <Bloco>
          <div style={{ padding: "2rem 1rem", textAlign: "center", color: PALETA.areiaTinta, fontSize: "0.9rem", lineHeight: 1.6 }}>
            {dados.combosNoCardapio
              ? `Nenhum combo vendido no período. A loja tem ${dados.combosNoCardapio} combo${dados.combosNoCardapio === 1 ? "" : "s"} no cardápio.`
              : "Nenhum combo vendido no período — e a loja ainda não tem combo no cardápio."}
            <br />
            <Link href="/store/cardapio" style={{ color: PALETA.marca, fontWeight: 700 }}>Montar um combo no cardápio</Link>
            {" "}(lanche + batata + bebida por um preço fechado, por exemplo).
          </div>
        </Bloco>
      )}

      {dados && t && t.combos > 0 && (
        <>
          <Bloco titulo="Combos que mais venderam" subtitulo="Pelo valor vendido. Vendas: em quantas vendas o combo apareceu." semPadding>
            <TabelaDoRanking dados={dados} />
          </Bloco>
          <Bloco titulo="Dia a dia" subtitulo="Com combo + sem combo = as vendas e o faturamento do Faturamento por dia." semPadding>
            <TabelaDosDias dados={dados} />
          </Bloco>
        </>
      )}

      {dados && (
        <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55 }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: PALETA.carvao2 }}>Combo</strong> é o produto marcado como combo no cardápio — e o item do iFood ou do 99 com o mesmo nome dele, ou com &quot;combo&quot; no nome ou na categoria.
            Lanche com adicionais não é combo. <strong style={{ color: PALETA.carvao2 }}>Venda com combo</strong> é a venda em que algum pedido levou combo: a mesa conta uma vez, mesmo com o combo na segunda rodada.
            <strong style={{ color: PALETA.carvao2 }}> Vendido em combos</strong> é preço × quantidade dos combos, sem a entrega; o faturamento e as vendas são os do
            {" "}<Link href={`/store/relatorios/faturamento-por-dia?${query}`} style={{ color: PALETA.marca, fontWeight: 700 }}>Faturamento por dia</Link>. O dia vira às 5h.
          </p>
        </div>
      )}
    </ModeloDoRelatorio>
  );
}

function TabelaDoRanking({ dados }: { dados: Resposta }) {
  const maior = Math.max(1, ...dados.ranking.map((c) => c.valor));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: "0.84rem" }}>
        <thead>
          <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
            <th style={{ ...th, textAlign: "left" }}>Combo</th>
            <th style={{ ...th, textAlign: "right" }}>Quantidade</th>
            <th style={{ ...th, textAlign: "right" }}>Vendas</th>
            <th style={{ ...th, textAlign: "right" }}>Valor</th>
            <th style={{ ...th, width: "22%" }} />
          </tr>
        </thead>
        <tbody>
          {dados.ranking.map((c) => (
            <tr key={c.nome} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
              <td style={{ ...td, fontWeight: 700 }}>{c.nome}</td>
              <td style={{ ...td, ...num }}>{c.quantidade.toLocaleString("pt-BR")}</td>
              <td style={{ ...td, ...num }}>{c.vendas.toLocaleString("pt-BR")}</td>
              <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(c.valor)}</td>
              <td style={td}><BarraDePct pct={(c.valor / maior) * 100} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaDosDias({ dados }: { dados: Resposta }) {
  const cabecalho: Array<{ t: string; dica?: string; esquerda?: boolean }> = [
    { t: "Data", esquerda: true }, { t: "Dia", esquerda: true },
    { t: "Vendas", dica: "Atendimentos: cada pedido é uma venda, e a mesa é uma venda só." },
    { t: "Com combo" }, { t: "% com combo" },
    { t: "Combos", dica: "Unidades de combo vendidas." }, { t: "Vendido em combos", dica: "Preço × quantidade dos combos." },
    { t: "Faturamento" }, { t: "Ticket com combo" }, { t: "Ticket sem combo" },
  ];
  const fixa: React.CSSProperties = { position: "sticky", left: 0, zIndex: 1 };
  const linha = (rotulo: React.ReactNode, s: SomaDeCombos, fundo: string, forte: boolean, d?: DiaDeCombos) => {
    const futuro = d?.estado === "futuro";
    const v = (x: React.ReactNode) => (futuro ? "—" : x);
    const apagado = futuro || s.vendas === 0;
    return (
      <tr key={d?.dia ?? "total"} style={{ borderBottom: `1px solid ${PALETA.areia}`, background: fundo, color: apagado && !forte ? PALETA.areiaTinta : PALETA.carvao, fontWeight: forte ? 800 : undefined, borderTop: forte ? `2px solid ${PALETA.areiaBorda}` : undefined }}>
        {rotulo}
        <td style={{ ...td, ...num }}>{v(s.vendas.toLocaleString("pt-BR"))}</td>
        <td style={{ ...td, ...num }}>{v(s.vendasComCombo.toLocaleString("pt-BR"))}</td>
        <td style={{ ...td, ...num }}>{v(pctOuTraco(s.pctComCombo))}</td>
        <td style={{ ...td, ...num }}>{v(s.combos.toLocaleString("pt-BR"))}</td>
        <td style={{ ...td, ...num, fontWeight: 800 }}>{v(fmtReais(s.valorDosCombos))}</td>
        <td style={{ ...td, ...num }}>{v(fmtReais(s.valor))}</td>
        <td style={{ ...td, ...num }}>{v(reaisOuTraco(s.ticketComCombo))}</td>
        <td style={{ ...td, ...num }}>{v(reaisOuTraco(s.ticketSemCombo))}</td>
      </tr>
    );
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", fontSize: "0.83rem" }}>
        <thead>
          <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
            {cabecalho.map((c, i) => (
              <th key={c.t} title={c.dica} style={{ ...th, textAlign: c.esquerda ? "left" : "right", ...(i === 0 ? { ...fixa, background: "#fff" } : {}),
                ...(c.dica ? { textDecoration: "underline dotted", cursor: "help" } : {}) }}>
                {c.t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dados.dias.map((d) => linha(
            <>
              <td style={{ ...td, ...fixa, background: "#fff", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtDia(d.dia)}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{NOMES_DOS_DIAS[d.diaSemana]}{d.estado === "hoje" ? " · hoje" : ""}</td>
            </>,
            d, "#fff", false, d,
          ))}
        </tbody>
        <tfoot>
          {linha(<td style={{ ...td, ...fixa, background: PALETA.areia }} colSpan={2}>Total</td>, dados.total, PALETA.areia, true)}
        </tfoot>
      </table>
    </div>
  );
}
