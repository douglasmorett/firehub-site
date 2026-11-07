"use client";
/**
 * Giro de mesas — a tela. A conta mora em lib/relatorios/giro-de-mesas.ts
 * (contas fechadas no período, consumo pela régua única, ticket por pessoa só
 * com o nº de pessoas informado); aqui são os filtros, o resumo do salão, as
 * mesas que mais rendem e as paradas, e o ranking mesa a mesa.
 *
 * O ranking ordena por qualquer coluna (toque no cabeçalho): ordenar não é
 * recontar — os números vêm prontos do servidor, a tela só muda a ordem.
 */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtPct, fmtQtd, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import { fmtPermanencia, nomeDaLinha, type GiroDeMesas, type LinhaDoGiro } from "@/lib/relatorios/giro-de-mesas";

type Resposta = GiroDeMesas & { periodo: { de: string; ate: string } };

const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 0.6rem", fontWeight: 800, verticalAlign: "bottom", lineHeight: 1.25 };
const td: React.CSSProperties = { padding: "7px 0.6rem" };

const SEM_PESSOAS = "sem nº de pessoas";
const reaisOuTraco = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtReais(v));
const qtdOuTraco = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtQtd(v));

type Chave = "numero" | "contas" | "giroPorDia" | "faturamento" | "ticketPorConta" | "ticketPorPessoa" | "pa" | "permanenciaMediaMin" | "reaisPorHora";

const COLUNAS: Array<{ chave: Chave; t: string; dica?: string; esquerda?: boolean }> = [
  { chave: "numero", t: "Mesa", esquerda: true },
  { chave: "contas", t: "Contas (giro)", dica: "Quantas contas a mesa fechou no período (conta liberada sem consumo não conta)." },
  { chave: "giroPorDia", t: "Giro por dia", dica: "Contas ÷ dias de salão aberto (dia com pelo menos uma conta fechada)." },
  { chave: "faturamento", t: "Faturamento", dica: "O consumo das contas: o lançado, sem taxa de serviço, gorjeta e troco." },
  { chave: "ticketPorConta", t: "Ticket por conta" },
  { chave: "ticketPorPessoa", t: "Ticket por pessoa", dica: "Só das contas com o nº de pessoas (\"Quantas pessoas?\" ao abrir a mesa, ou as pessoas nomeadas na conta)." },
  { chave: "pa", t: "P.A.", dica: "Produtos por atendimento: itens ÷ contas." },
  { chave: "permanenciaMediaMin", t: "Permanência média", dica: "Tempo médio entre abrir e fechar a conta." },
  { chave: "reaisPorHora", t: "R$ por hora ocupada", dica: "Faturamento ÷ horas em que a mesa ficou ocupada." },
];

export default function GiroDeMesasClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "mes");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("giro-de-mesas", query);
  const r = dados?.resumo;

  const rendem = dados?.mesas.filter((l) => l.destaque === "rende") ?? [];
  const paradas = dados?.mesas.filter((l) => l.destaque === "parada") ?? [];

  return (
    <ModeloDoRelatorio
      titulo="Giro de mesas"
      descricao="Mesa a mesa: quantas vezes cada uma girou, quanto faturou, quanto tempo ficou ocupada e quanto cada pessoa gastou. As que mais rendem e as paradas ficam marcadas."
      slug="giro-de-mesas" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      {/* É tudo mesa: tipo, canal e marca não mudam nada aqui. O horário é o do fechamento da conta. */}
      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ tipos: false, canais: false, marcas: false }} />

      {dados && r && (
        <GradeDeCartoes>
          <Cartao rotulo="Giro médio" valor={r.giroMedioPorMesa === null ? "—" : `${fmtQtd(r.giroMedioPorMesa)}×`}
            detalhe={`por mesa por dia · ${r.contas.toLocaleString("pt-BR")} conta${r.contas === 1 ? "" : "s"} em ${r.mesas} mesa${r.mesas === 1 ? "" : "s"} e ${r.diasAbertos} dia${r.diasAbertos === 1 ? "" : "s"} de salão aberto`} />
          <Cartao rotulo="Faturamento do salão" valor={fmtReais(r.faturamento)} detalhe={`Ticket por conta ${reaisOuTraco(r.ticketPorConta)}`} />
          <Cartao rotulo="Ticket por pessoa" valor={r.ticketPorPessoa === null ? <span style={{ fontSize: "1rem" }}>{SEM_PESSOAS}</span> : fmtReais(r.ticketPorPessoa)}
            detalhe={r.ticketPorPessoa === null
              ? "Preencha \"Quantas pessoas?\" ao abrir a mesa"
              : `${r.pessoas.toLocaleString("pt-BR")} pessoas em ${r.contasComPessoas} de ${r.contas} contas`} />
          <Cartao rotulo="Permanência média" valor={fmtPermanencia(r.permanenciaMediaMin)} detalhe={`${fmtQtd(r.horasOcupada)} h de mesa ocupada`} />
          <Cartao rotulo="P.A." valor={qtdOuTraco(r.pa)} detalhe="produtos por atendimento (itens por conta)" />
          <Cartao rotulo="R$ por hora ocupada" valor={reaisOuTraco(r.reaisPorHora)} detalhe="quanto a mesa rende enquanto está ocupada" />
        </GradeDeCartoes>
      )}

      {dados && r && r.contas === 0 && (
        <Bloco><Vazio texto="Nenhuma conta de mesa fechada no período. Tente um período maior ou tire o filtro de horário." /></Bloco>
      )}

      {dados && r && r.contas > 0 && (rendem.length > 0 || paradas.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
          {rendem.length > 0 && (
            <Destaques titulo="▲ As que mais rendem" cor={PALETA.ok} fundo={PALETA.okClaro}
              texto="Onde vale pôr o garçom mais experiente e a reserva."
              mesas={rendem} valor={(l) => `${fmtReais(l.faturamento)} · ${l.contas} conta${l.contas === 1 ? "" : "s"}`} />
          )}
          {paradas.length > 0 && (
            <Destaques titulo="▼ Paradas" cor={PALETA.atencao} fundo={PALETA.atencaoClaro}
              texto="Giraram menos da metade da média do salão (ou nem abriram). Vale olhar o lugar: canto, sol, corrente de ar, longe da vista."
              mesas={paradas} valor={(l) => (l.contas === 0 ? "não abriu" : `${l.contas} conta${l.contas === 1 ? "" : "s"}`)} />
          )}
        </div>
      )}

      {dados && r && r.contas > 0 && (
        <Bloco titulo="Mesa a mesa" subtitulo="Toque no nome da coluna para ordenar. A soma das linhas fecha com o resumo do salão." semPadding>
          <TabelaDoGiro dados={dados} />
        </Bloco>
      )}

      {dados && r && (
        <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55, display: "grid", gap: 6 }}>
          {(r.liberadasSemConsumo > 0 || r.contasDeComanda > 0) && (
            <p style={{ margin: 0 }}>
              Fora do giro:{" "}
              {[
                r.liberadasSemConsumo > 0 ? `${r.liberadasSemConsumo} conta${r.liberadasSemConsumo === 1 ? "" : "s"} liberada${r.liberadasSemConsumo === 1 ? "" : "s"} sem consumo (mesa aberta por engano)` : "",
                r.contasDeComanda > 0 ? `${r.contasDeComanda} conta${r.contasDeComanda === 1 ? "" : "s"} de comanda numerada (cartão de uma pessoa, não um lugar do salão)` : "",
              ].filter(Boolean).join(" e ")}.
            </p>
          )}
          <p style={{ margin: 0 }}>
            <strong style={{ color: PALETA.carvao2 }}>Faturamento</strong> é o consumo das contas fechadas no período — o lançado, sem taxa de serviço, gorjeta e troco —,
            os mesmos números do Histórico de mesas e do Relatório de Mesas (<Link href="/store/garcons" style={{ color: PALETA.marca, fontWeight: 700 }}>Garçons</Link>, com a taxa de serviço esperada × cobrada por garçom).
            <strong style={{ color: PALETA.carvao2 }}> Ticket por pessoa</strong> usa só as contas com o nº de pessoas: o &quot;Quantas pessoas?&quot; ao abrir a mesa ou as pessoas nomeadas na conta. Sem o número, não se inventa.
            Mesa ainda aberta entra quando fechar. O dia vira às 5h: a conta fechada à 1h da manhã é do dia anterior.
            Por dia e por garçom: <Link href={`/store/relatorios/ticket-medio?${query}`} style={{ color: PALETA.marca, fontWeight: 700 }}>Ticket médio</Link>.
          </p>
        </div>
      )}
    </ModeloDoRelatorio>
  );
}

function Destaques({ titulo, cor, fundo, texto, mesas, valor }: {
  titulo: string; cor: string; fundo: string; texto: string; mesas: LinhaDoGiro[]; valor: (l: LinhaDoGiro) => string;
}) {
  return (
    <section className="fh-relatorio-bloco" style={{ background: fundo, border: `1px solid ${cor}33`, borderRadius: 14, padding: "0.9rem 1rem" }}>
      <div style={{ fontSize: "0.8rem", fontWeight: 900, color: cor, textTransform: "uppercase", letterSpacing: "0.04em" }}>{titulo}</div>
      <p style={{ margin: "4px 0 10px", fontSize: "0.78rem", color: PALETA.areiaTinta }}>{texto}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {mesas.map((l) => (
          <span key={l.mesaId} style={{ background: "#fff", border: `1px solid ${cor}55`, borderRadius: 999, padding: "4px 10px", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            <strong style={{ color: PALETA.carvao }}>{nomeDaLinha(l)}</strong> <span style={{ color: PALETA.areiaTinta }}>· {valor(l)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function TabelaDoGiro({ dados }: { dados: Resposta }) {
  const [ordem, setOrdem] = useState<{ chave: Chave; desc: boolean }>({ chave: "faturamento", desc: true });
  const linhas = useMemo(() => {
    const valor = (l: LinhaDoGiro) => l[ordem.chave];
    return [...dados.mesas].sort((a, b) => {
      const va = valor(a), vb = valor(b);
      // Vazio ("—", "sem nº de pessoas") sempre embaixo, nos dois sentidos.
      if (va === null && vb === null) return a.numero - b.numero;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (ordem.desc ? vb - va : va - vb) || a.numero - b.numero;
    });
  }, [dados.mesas, ordem]);
  const ordenar = (chave: Chave) => setOrdem((o) => (o.chave === chave ? { chave, desc: !o.desc } : { chave, desc: chave !== "numero" && chave !== "permanenciaMediaMin" }));
  const r = dados.resumo;
  const fixa: React.CSSProperties = { position: "sticky", left: 0, zIndex: 1 };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: "0.83rem" }}>
        <thead>
          <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}`, background: "#fff" }}>
            {COLUNAS.map((c, i) => {
              const ativa = ordem.chave === c.chave;
              return (
                <th key={c.chave} title={c.dica} aria-sort={ativa ? (ordem.desc ? "descending" : "ascending") : undefined}
                  style={{ ...th, textAlign: c.esquerda ? "left" : "right", ...(i === 0 ? { ...fixa, background: "#fff" } : {}) }}>
                  <button type="button" onClick={() => ordenar(c.chave)}
                    style={{ all: "unset", cursor: "pointer", color: ativa ? PALETA.carvao : "inherit", ...(c.dica ? { textDecoration: "underline dotted" } : {}) }}>
                    {c.t}{ativa ? (ordem.desc ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              );
            })}
            <th style={{ ...th, textAlign: "left" }}>% do salão</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const fundo = l.destaque === "rende" ? PALETA.okClaro : l.destaque === "parada" ? PALETA.atencaoClaro : "#fff";
            const apagada = l.contas === 0;
            return (
              <tr key={l.mesaId} style={{ borderBottom: `1px solid ${PALETA.areia}`, background: fundo, color: apagada ? PALETA.areiaTinta : PALETA.carvao }}>
                <td style={{ ...td, ...fixa, background: fundo, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {nomeDaLinha(l)}
                  {l.destaque === "rende" && <Etiqueta cor={PALETA.ok} texto="▲ rende mais" />}
                  {l.destaque === "parada" && <Etiqueta cor={PALETA.atencao} texto={`▼ ${l.contas === 0 ? "não abriu" : "parada"}`} />}
                </td>
                <td style={{ ...td, ...num, fontWeight: 800 }}>{l.contas.toLocaleString("pt-BR")}</td>
                <td style={{ ...td, ...num }}>{qtdOuTraco(l.giroPorDia)}</td>
                <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(l.faturamento)}</td>
                <td style={{ ...td, ...num }}>{reaisOuTraco(l.ticketPorConta)}</td>
                <td style={{ ...td, ...num }}>
                  {l.ticketPorPessoa !== null ? (
                    <>
                      {fmtReais(l.ticketPorPessoa)}
                      <div style={{ fontSize: "0.68rem", color: PALETA.areiaTinta }}>{l.pessoas} pessoa{l.pessoas === 1 ? "" : "s"}{l.contasComPessoas < l.contas ? ` · ${l.contasComPessoas} de ${l.contas} contas` : ""}</div>
                    </>
                  ) : l.contas > 0 ? <span style={{ fontSize: "0.72rem", color: PALETA.areiaTinta }}>{SEM_PESSOAS}</span> : "—"}
                </td>
                <td style={{ ...td, ...num }}>{qtdOuTraco(l.pa)}</td>
                <td style={{ ...td, ...num }}>{fmtPermanencia(l.permanenciaMediaMin)}</td>
                <td style={{ ...td, ...num }}>{reaisOuTraco(l.reaisPorHora)}</td>
                <td style={{ ...td, minWidth: 110 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <BarraDePct pct={l.participacao} cor={l.destaque === "rende" ? PALETA.ok : PALETA.brasa} />
                    <span style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, ...num }}>{fmtPct(l.participacao)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: PALETA.areia, fontWeight: 800, borderTop: `2px solid ${PALETA.areiaBorda}` }}>
            <td style={{ ...td, ...fixa, background: PALETA.areia }}>Salão</td>
            <td style={{ ...td, ...num }}>{r.contas.toLocaleString("pt-BR")}</td>
            <td style={{ ...td, ...num }}>{qtdOuTraco(r.giroPorDia)}</td>
            <td style={{ ...td, ...num }}>{fmtReais(r.faturamento)}</td>
            <td style={{ ...td, ...num }}>{reaisOuTraco(r.ticketPorConta)}</td>
            <td style={{ ...td, ...num }}>{r.ticketPorPessoa !== null ? fmtReais(r.ticketPorPessoa) : <span style={{ fontSize: "0.72rem", fontWeight: 600 }}>{SEM_PESSOAS}</span>}</td>
            <td style={{ ...td, ...num }}>{qtdOuTraco(r.pa)}</td>
            <td style={{ ...td, ...num }}>{fmtPermanencia(r.permanenciaMediaMin)}</td>
            <td style={{ ...td, ...num }}>{reaisOuTraco(r.reaisPorHora)}</td>
            <td style={{ ...td }}>{r.faturamento > 0 ? "100%" : "—"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Etiqueta({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 999, fontSize: "0.68rem", fontWeight: 800, color: cor, background: "#fff", border: `1px solid ${cor}33`, whiteSpace: "nowrap" }}>
      {texto}
    </span>
  );
}
