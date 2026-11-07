"use client";
/**
 * Ticket médio — a tela. A conta mora em lib/relatorios/ticket-medio.ts (a
 * régua única: valor pelo pedido, a mesa é um atendimento; pessoas só onde a
 * mesa informou); aqui são os filtros, os cartões e as duas tabelas, por dia e
 * por garçom. Nenhum número é recontado aqui.
 */
import React from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { DIAS_CURTOS, fmtDia, fmtQtd, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import { FORA_DO_SALAO, MESA_SEM_GARCOM, type NumerosDoTicket, type TicketMedio } from "@/lib/relatorios/ticket-medio";

type Resposta = TicketMedio & { periodo: { de: string; ate: string } };

const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 0.6rem", fontWeight: 800, verticalAlign: "bottom", lineHeight: 1.25 };
const td: React.CSSProperties = { padding: "7px 0.6rem" };

const SEM_PESSOAS = "sem nº de pessoas";
const reaisOuTraco = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtReais(v));

const CABECALHO: Array<{ t: string; dica?: string }> = [
  { t: "Faturamento", dica: "O valor das vendas, como no Faturamento por dia: o pedido no dia dele, a mesa aberta ou fechada." },
  { t: "Atendimentos", dica: "Cada pedido é um; a mesa é um só, no dia do primeiro lançamento, por mais rodadas que tenha." },
  { t: "Pessoas", dica: "Só da mesa: o \"Quantas pessoas?\" ao abrir, senão as pessoas nomeadas na conta." },
  { t: "Ticket por atendimento", dica: "Faturamento ÷ atendimentos — o ticket médio do Faturamento por dia." },
  { t: "Ticket por pessoa", dica: "O lançado nas mesas com o nº de pessoas ÷ as pessoas delas. Mesa sem o número fica fora." },
  { t: "P.A.", dica: "Produtos por atendimento: itens ÷ atendimentos." },
];

export default function TicketMedioClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "mes");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("ticket-medio", query);
  const t = dados?.total;

  return (
    <ModeloDoRelatorio
      titulo="Ticket médio"
      descricao="Quanto cada atendimento e cada pessoa gastou, e quantos produtos levou (P.A.) — dia a dia e por garçom."
      slug="ticket-medio" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} />

      {dados && t && (
        <GradeDeCartoes>
          <Cartao rotulo="Ticket por atendimento" valor={reaisOuTraco(t.ticketPorAtendimento)}
            detalhe={`${fmtReais(t.faturamento)} em ${t.atendimentos.toLocaleString("pt-BR")} atendimento${t.atendimentos === 1 ? "" : "s"}`} />
          <Cartao rotulo="Ticket por pessoa" valor={t.ticketPorPessoa === null ? <span style={{ fontSize: "1rem" }}>{SEM_PESSOAS}</span> : fmtReais(t.ticketPorPessoa)}
            detalhe={t.ticketPorPessoa !== null
              ? `${t.pessoas.toLocaleString("pt-BR")} pessoas em ${t.mesasComPessoas} de ${t.mesas} mesas`
              : t.mesas > 0 ? "Preencha \"Quantas pessoas?\" ao abrir a mesa" : "Só a mesa tem nº de pessoas"} />
          <Cartao rotulo="P.A." valor={t.pa === null ? "—" : fmtQtd(t.pa)} detalhe="produtos por atendimento" />
          <Cartao rotulo="Mesas" valor={t.mesas.toLocaleString("pt-BR")}
            detalhe={t.atendimentos > 0 ? `${Math.round((t.mesas / t.atendimentos) * 100)}% dos atendimentos` : "nenhum atendimento"} />
        </GradeDeCartoes>
      )}

      {dados && t && t.atendimentos === 0 && (
        <Bloco><Vazio texto="Nenhuma venda no período e filtros escolhidos. Tente um período maior ou tire algum filtro." /></Bloco>
      )}

      {dados && t && t.atendimentos > 0 && (
        <>
          <Bloco titulo="Dia a dia" subtitulo="Só os dias com venda. O dia vira às 5h." semPadding>
            <Tabela rotulo="Dia" total={t}
              linhas={dados.porDia.map((d) => ({ chave: d.dia, nome: `${DIAS_CURTOS[d.diaSemana]} ${fmtDia(d.dia)}`, n: d }))} />
          </Bloco>
          <Bloco titulo="Por garçom" subtitulo="O garçom da conta da mesa. O que não é mesa fica em Fora do salão; as linhas somam o total." semPadding>
            <Tabela rotulo="Garçom" total={t}
              linhas={dados.porGarcom.map((g) => ({ chave: g.chave, nome: g.nome, n: g, apagada: g.chave === FORA_DO_SALAO || g.chave === MESA_SEM_GARCOM }))} />
          </Bloco>
        </>
      )}

      {dados && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55 }}>
          <strong style={{ color: PALETA.carvao2 }}>Faturamento e atendimentos</strong> são os do <Link href={`/store/relatorios/faturamento-por-dia?${query}`} style={{ color: PALETA.marca, fontWeight: 700 }}>Faturamento por dia</Link>:
          a mesa é um atendimento só, no dia do primeiro lançamento, e o ticket por atendimento bate com o ticket médio de lá.
          <strong style={{ color: PALETA.carvao2 }}> Pessoas</strong> só existem na mesa — o &quot;Quantas pessoas?&quot; ao abrir a mesa, senão as pessoas nomeadas na conta; balcão e entrega não têm, e não se inventa.
          A taxa de serviço não entra (é do garçom; esperado × cobrado no <Link href="/store/garcons" style={{ color: PALETA.marca, fontWeight: 700 }}>Relatório de Mesas</Link>).
          Mesa a mesa, com o giro: <Link href={`/store/relatorios/giro-de-mesas?${query}`} style={{ color: PALETA.marca, fontWeight: 700 }}>Giro de mesas</Link>.
        </p>
      )}
    </ModeloDoRelatorio>
  );
}

function Tabela({ rotulo, linhas, total }: { rotulo: string; linhas: Array<{ chave: string; nome: string; n: NumerosDoTicket; apagada?: boolean }>; total: NumerosDoTicket }) {
  const fixa: React.CSSProperties = { position: "sticky", left: 0, zIndex: 1 };
  const celulas = (n: NumerosDoTicket) => (
    <>
      <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(n.faturamento)}</td>
      <td style={{ ...td, ...num }}>
        {n.atendimentos.toLocaleString("pt-BR")}
        {n.mesas > 0 && <div style={{ fontSize: "0.68rem", fontWeight: 500, color: PALETA.areiaTinta }}>{n.mesas} mesa{n.mesas === 1 ? "" : "s"}</div>}
      </td>
      <td style={{ ...td, ...num }}>
        {n.mesasComPessoas > 0 ? n.pessoas.toLocaleString("pt-BR") : "—"}
        {n.mesasComPessoas > 0 && n.mesasComPessoas < n.mesas && (
          <div style={{ fontSize: "0.68rem", fontWeight: 500, color: PALETA.areiaTinta }}>{n.mesasComPessoas} de {n.mesas} mesas</div>
        )}
      </td>
      <td style={{ ...td, ...num }}>{reaisOuTraco(n.ticketPorAtendimento)}</td>
      <td style={{ ...td, ...num }}>
        {n.ticketPorPessoa !== null ? fmtReais(n.ticketPorPessoa) : n.mesas > 0 ? <span style={{ fontSize: "0.72rem", fontWeight: 600, color: PALETA.areiaTinta }}>{SEM_PESSOAS}</span> : "—"}
      </td>
      <td style={{ ...td, ...num }}>{n.pa === null ? "—" : fmtQtd(n.pa)}</td>
    </>
  );
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: "0.83rem" }}>
        <thead>
          <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}`, background: "#fff" }}>
            <th style={{ ...th, ...fixa, background: "#fff", textAlign: "left" }}>{rotulo}</th>
            {CABECALHO.map((c) => (
              <th key={c.t} title={c.dica} style={{ ...th, textAlign: "right", ...(c.dica ? { textDecoration: "underline dotted", cursor: "help" } : {}) }}>{c.t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.chave} style={{ borderBottom: `1px solid ${PALETA.areia}`, color: PALETA.carvao }}>
              <td style={{ ...td, ...fixa, background: "#fff", fontWeight: 700, whiteSpace: "nowrap", fontStyle: l.apagada ? "italic" : "normal", color: l.apagada ? PALETA.areiaTinta : PALETA.carvao }}>{l.nome}</td>
              {celulas(l.n)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: PALETA.areia, fontWeight: 800, borderTop: `2px solid ${PALETA.areiaBorda}` }}>
            <td style={{ ...td, ...fixa, background: PALETA.areia }}>Total</td>
            {celulas(total)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
