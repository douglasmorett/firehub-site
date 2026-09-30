"use client";
/**
 * Faturamento por dia — a tela. A conta mora em
 * lib/relatorios/faturamento-por-dia.ts (o que entra, o que não entra e a
 * régua única de lib/relatorios/regua-da-venda.ts: valor pelo pedido, a mesa
 * é uma venda no primeiro lançamento, serviço e desconto da mesa à parte);
 * aqui são os filtros, os cartões, o gráfico, a tabela dia a dia e a
 * comparação.
 *
 * O gráfico é de barras em CSS, sem biblioteca: uma série só (o valor do dia),
 * a média tracejada por cima, o melhor e o pior dia marcados com cor E com
 * rótulo (cor sozinha não diz nada a quem não distingue verde de vermelho).
 * Tocar numa barra mostra o dia — no celular não existe "passar o mouse".
 */
import React, { useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { DIAS_CURTOS, NOMES_DOS_DIAS, fmtDia, fmtPct, fmtQtd, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio, Variacao } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import {
  lerDiasDaSemana,
  type ComparacaoDosPeriodos, type DiaDeDestaque, type DiaDoFaturamento, type ProgressoDaMeta, type ResultadoDoFaturamento, type SomaDosDias,
} from "@/lib/relatorios/faturamento-por-dia";

type Resposta = ResultadoDoFaturamento & {
  lojas: string[];
  periodo: { de: string; ate: string };
  hoje: string;
  anterior: {
    de: string; ate: string; total: SomaDosDias; media: ResultadoDoFaturamento["media"]; melhorDia: DiaDeDestaque | null; ateEsteHorario: boolean;
    /** Com filtro de dia da semana: quantas semanas inteiras o anterior recua (periodoDeComparacao). */
    semanas: number | null;
  };
  comparacao: ComparacaoDosPeriodos;
  meta: ProgressoDaMeta | null;
  semMeta: "sem-meta" | "filtro" | "periodo" | null;
  mesasAbertas: { quantidade: number; consumo: number } | null;
};

const rotulo: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
// O cabeçalho quebra em duas linhas ("Valor das / vendas"): quem manda na
// largura da coluna é o número, e a tabela cabe inteira numa tela de notebook.
const th: React.CSSProperties = { padding: "8px 0.6rem", fontWeight: 800, verticalAlign: "bottom", lineHeight: 1.25 };
const td: React.CSSProperties = { padding: "7px 0.6rem" };

/** Semana começando no domingo, como o calendário do celular. */
const ORDEM_DOS_DIAS = [0, 1, 2, 3, 4, 5, 6];

const diaCurto = (d: { dia: string; diaSemana: number }) => `${DIAS_CURTOS[d.diaSemana]} ${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`;
const reaisOuTraco = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtReais(v));

export default function FaturamentoPorDiaClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, extras, mudarExtra, query } = useFiltros(inicio, "mes", { dias: "" });
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("faturamento-por-dia", query);

  const diasMarcados = lerDiasDaSemana(extras.dias);
  const alternarDia = (d: number) => {
    // Nada marcado = todos marcados (a regra dos filtros): desmarcar um dia
    // com "todos" ligado deixa os outros seis.
    const atual = diasMarcados.length ? diasMarcados : ORDEM_DOS_DIAS;
    const novo = atual.includes(d) ? atual.filter((x) => x !== d) : [...atual, d];
    mudarExtra("dias", novo.length === 7 || novo.length === 0 ? "" : novo.sort((a, b) => a - b).join(","));
  };

  // Lançamento, não venda: pela régua um período pode ter valor sem venda nova
  // (a mesa que começou antes e lançou de novo dentro dele).
  const temVenda = Boolean(dados && (dados.total.lancamentos > 0 || dados.total.canceladosQtd > 0));
  const hojeAberto = Boolean(dados?.dias.some((d) => d.estado === "hoje"));
  const rotuloDaMedia = dados?.media.base === "fechados" && hojeAberto ? "Média por dia (sem hoje)" : "Média por dia";

  return (
    <ModeloDoRelatorio
      titulo="Faturamento por dia"
      descricao="Quanto a loja vendeu em cada dia do período, com o acumulado, o ticket médio e a comparação com o período anterior. Dia sem venda aparece com zero."
      slug="faturamento-por-dia" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje}>
        <div style={{ borderTop: `1px dashed ${PALETA.areiaBorda}`, paddingTop: "0.8rem" }}>
          <div style={rotulo}>Dias da semana</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {ORDEM_DOS_DIAS.map((d) => {
              const marcado = diasMarcados.length === 0 || diasMarcados.includes(d);
              return (
                <button key={d} type="button" onClick={() => alternarDia(d)} aria-pressed={marcado} title={NOMES_DOS_DIAS[d]}
                  style={{
                    minWidth: 48, padding: "6px 10px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700,
                    border: `1.5px solid ${marcado ? PALETA.carvao2 : PALETA.areiaBorda}`,
                    background: marcado ? PALETA.areia : "#fff", color: marcado ? PALETA.carvao : PALETA.areiaTinta,
                  }}>
                  {DIAS_CURTOS[d]}
                </button>
              );
            })}
            {diasMarcados.length > 0 && (
              <button type="button" onClick={() => mudarExtra("dias", "")}
                style={{ border: "none", background: "none", color: PALETA.marca, fontWeight: 700, cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
                todos os dias
              </button>
            )}
          </div>
        </div>
      </BarraDeFiltros>

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Faturamento" valor={fmtReais(dados.total.valor)}
            detalhe={<Variacao atual={dados.comparacao.total.atual} anterior={dados.comparacao.total.anterior} />} />
          <Cartao rotulo={rotuloDaMedia} valor={fmtReais(dados.media.valor)}
            detalhe={<Variacao atual={dados.comparacao.media.atual} anterior={dados.comparacao.media.anterior} />} />
          <Cartao rotulo="Vendas" valor={dados.total.vendas.toLocaleString("pt-BR")}
            detalhe={`Ticket médio ${reaisOuTraco(dados.total.ticketMedio)}${dados.total.lancamentos !== dados.total.vendas ? ` · ${dados.total.lancamentos.toLocaleString("pt-BR")} lançamentos (a mesa conta uma vez)` : ""}`} />
          <Cartao rotulo="▲ Melhor dia" tom={dados.melhorDia ? "ok" : "neutro"}
            valor={dados.melhorDia ? diaCurto(dados.melhorDia) : "—"}
            detalhe={dados.melhorDia ? `${fmtReais(dados.melhorDia.valor)} · ${dados.melhorDia.vendas} venda${dados.melhorDia.vendas === 1 ? "" : "s"}` : "Nenhuma venda no período"} />
          {/* O pior é sempre OUTRO dia, abaixo do melhor: com empate no topo ou um dia só, não há pior. */}
          <Cartao rotulo="▼ Pior dia" tom={dados.piorDia ? "atencao" : "neutro"}
            valor={dados.piorDia ? diaCurto(dados.piorDia) : "—"}
            detalhe={dados.piorDia ? `${fmtReais(dados.piorDia.valor)} · entre os dias fechados com venda` : "Precisa de outro dia fechado com venda, abaixo do melhor"} />
          <Cartao rotulo="Cancelados" valor={dados.total.canceladosQtd.toLocaleString("pt-BR")}
            detalhe={dados.total.canceladosQtd ? `${fmtReais(dados.total.canceladosValor)} — fora do faturamento` : "Nenhum no período"} />
        </GradeDeCartoes>
      )}

      {dados?.meta && <BlocoDaMeta meta={dados.meta} hoje={dados.hoje} />}
      {(dados?.semMeta === "filtro" || dados?.semMeta === "periodo") && (
        <p style={{ margin: "-0.4rem 0 1.1rem", fontSize: "0.78rem", color: PALETA.areiaTinta }}>
          {dados.semMeta === "filtro"
            ? "A meta de faturamento do mês fica escondida com filtro de tipo, canal, marca, horário ou dia da semana: ela compararia só uma parte das vendas com a meta da loja inteira."
            : "A meta de faturamento do mês aparece quando o período termina hoje ou no último dia de um mês."}
        </p>
      )}

      {dados && !temVenda && (
        <Bloco><Vazio texto="Nenhuma venda no período e filtros escolhidos. Tente um período maior ou tire algum filtro." /></Bloco>
      )}

      {dados && temVenda && (
        <>
          <Bloco titulo="Valor por dia"
            subtitulo={`Tracejado: ${rotuloDaMedia.toLowerCase()}, ${fmtReais(dados.media.valor)}.${dados.mediaDiasComVenda !== null && dados.mediaDiasComVenda !== dados.media.valor ? ` Nos dias com venda: ${fmtReais(dados.mediaDiasComVenda)}.` : ""}`}>
            <Grafico dias={dados.dias} media={dados.media.valor} melhor={dados.melhorDia?.dia} pior={dados.piorDia?.dia} />
          </Bloco>

          <Bloco titulo="Dia a dia" subtitulo="Itens + Entrega − Descontos + Outros = Valor das vendas. Cada linha fecha." semPadding>
            <TabelaDosDias dados={dados} rotuloDaMedia={rotuloDaMedia} />
          </Bloco>

          <Bloco titulo="Comparado com o período anterior"
            subtitulo={[
              // Com filtro de dia da semana, os n dias logo antes podem ter outra
              // quantidade de sextas: o anterior recua em semanas inteiras.
              dados.anterior.semanas
                ? `${fmtDia(dados.anterior.de)} a ${fmtDia(dados.anterior.ate)}, ${dados.anterior.semanas} semana${dados.anterior.semanas === 1 ? "" : "s"} antes — o mesmo número de cada dia da semana marcado`
                : `${fmtDia(dados.anterior.de)} a ${fmtDia(dados.anterior.ate)}, mesmo tamanho`,
              dados.anterior.ateEsteHorario ? "até este mesmo horário (hoje ainda não acabou)" : "",
            ].filter(Boolean).join(" · ")}
            semPadding>
            <TabelaDaComparacao c={dados.comparacao} />
          </Bloco>
        </>
      )}

      {dados && (
        <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55, display: "grid", gap: 6 }}>
          {dados.mesasAbertas && (
            <p style={{ margin: 0 }}>
              <strong style={{ color: PALETA.carvao2 }}>{dados.mesasAbertas.quantidade} mesa{dados.mesasAbertas.quantidade === 1 ? "" : "s"} ainda aberta{dados.mesasAbertas.quantidade === 1 ? "" : "s"}</strong>, com {fmtReais(dados.mesasAbertas.consumo)} lançados no período — já estão no valor das vendas; o pagamento, a taxa de serviço e a gorjeta entram quando a conta fechar.
            </p>
          )}
          {dados.servicoDasMesas > 0 && (
            <p style={{ margin: 0 }}>
              Taxa de serviço e gorjeta de {dados.mesasFechadas.mesas} mesa{dados.mesasFechadas.mesas === 1 ? "" : "s"} fechada{dados.mesasFechadas.mesas === 1 ? "" : "s"}: {fmtReais(dados.servicoDasMesas)} — do garçom, à parte do faturamento.
            </p>
          )}
          {dados.mesasFechadas.descontoNaMesa > 0 && (
            <p style={{ margin: 0 }}>
              <strong style={{ color: PALETA.carvao2 }}>Desconto no fechamento da mesa</strong>: {fmtReais(dados.mesasFechadas.descontoNaMesa)} em {dados.mesasFechadas.mesasComDesconto} mesa{dados.mesasFechadas.mesasComDesconto === 1 ? "" : "s"} (coluna à parte, no dia em que a mesa fechou).
              Não sai do valor das vendas, que é o que foi lançado; sai de consumo − (pago − serviço − gorjeta) e é um piso — troco deixado na mesa esconde parte dele.
            </p>
          )}
          {dados.valoresImpossiveis > 0 && (
            <p role="note" style={{ margin: 0, color: PALETA.grave, fontWeight: 700 }}>
              {dados.valoresImpossiveis} pedido{dados.valoresImpossiveis === 1 ? "" : "s"} com valor impossível (R$ 1 milhão ou mais) ficou fora das somas — confira no painel de pedidos.
            </p>
          )}
          <p style={{ margin: 0 }}>
            <strong style={{ color: PALETA.carvao2 }}>Valor das vendas</strong> é o que o cliente pagou, com a entrega e já sem o desconto — inclusive o cupom bancado pelo iFood/99
            (quem bancou cada desconto está em <Link href={`/store/relatorios/descontos?${query}`} style={{ color: PALETA.marca, fontWeight: 700 }}>Cupons e descontos</Link>).
            <strong style={{ color: PALETA.carvao2 }}> Outros</strong> é o que o app cobrou do cliente além dos itens e da entrega, como a taxa de serviço do iFood.
            Cancelados, pedido do totem esperando pagamento e rascunho do robô não são venda.
            <strong style={{ color: PALETA.carvao2 }}> Mesa</strong>: o valor é o que foi lançado, no dia de cada lançamento, com a mesa aberta ou fechada; a conta é <strong>uma</strong> venda,
            no dia do primeiro lançamento — a mesma régua do Vendas por período e do Dia e hora. O troco não mexe no valor.
            O dia vira às 5h: a venda da 1h da manhã é do dia anterior.
          </p>
        </div>
      )}
    </ModeloDoRelatorio>
  );
}

// ── O GRÁFICO ───────────────────────────────────────────────────────────────

function Grafico({ dias, media, melhor, pior }: { dias: DiaDoFaturamento[]; media: number; melhor?: string; pior?: string }) {
  const [foco, setFoco] = useState<string | null>(null);
  const max = Math.max(media, ...dias.map((d) => d.valor), 1);
  const ALTURA = 190;
  const largura = dias.length > 62 ? 9 : dias.length > 31 ? 13 : 0; // 0 = as barras dividem a largura
  const rotuloACada = dias.length <= 16 ? 1 : dias.length <= 31 ? 2 : 7;
  const focado = dias.find((d) => d.dia === foco) || null;
  // O rótulo do melhor e do pior dia sempre aparece; o rótulo comum ao lado
  // dele sai, senão "07" e "08" encostavam num mês inteiro no celular.
  const forcado = (i: number) => dias[i] && (dias[i].dia === melhor || dias[i].dia === pior);
  const mostraRotulo = (i: number) => forcado(i) || (i % rotuloACada === 0 && !forcado(i - 1) && !forcado(i + 1));

  const corDa = (d: DiaDoFaturamento) => (d.dia === melhor ? PALETA.ok : d.dia === pior ? PALETA.atencao : d.dia === foco ? PALETA.carvao2 : "#A8A29E");

  return (
    <div>
      <div aria-live="polite" style={{ minHeight: 22, fontSize: "0.84rem", marginBottom: 8, color: PALETA.carvao2 }}>
        {focado ? (
          <span>
            <strong>{NOMES_DOS_DIAS[focado.diaSemana]}, {fmtDia(focado.dia)}</strong>
            {focado.estado === "futuro" ? " — ainda não chegou" : (
              <> — {fmtReais(focado.valor)} · {focado.vendas} venda{focado.vendas === 1 ? "" : "s"}
                {focado.ticketMedio !== null ? ` · ticket ${fmtReais(focado.ticketMedio)}` : ""}
                {focado.estado === "hoje" ? " · hoje, ainda aberto" : focado.estado === "antes" ? " · antes do 1º pedido da loja" : ""}</>
            )}
          </span>
        ) : <span style={{ color: PALETA.areiaTinta }}>Toque ou passe o mouse numa barra para ver o dia.</span>}
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ position: "relative", minWidth: largura ? dias.length * (largura + 2) : undefined }}>
          <div style={{ position: "relative", height: ALTURA, display: "flex", alignItems: "stretch", gap: 2, borderBottom: `1px solid ${PALETA.areiaBorda}` }}
            onMouseLeave={() => setFoco(null)}>
            {dias.map((d) => {
              const pct = d.estado === "futuro" ? 0 : (d.valor / max) * 100;
              return (
                <button key={d.dia} type="button"
                  onMouseEnter={() => setFoco(d.dia)} onFocus={() => setFoco(d.dia)} onClick={() => setFoco(d.dia)}
                  aria-label={`${NOMES_DOS_DIAS[d.diaSemana]}, ${fmtDia(d.dia)}: ${d.estado === "futuro" ? "ainda não chegou" : fmtReais(d.valor)}`}
                  style={{
                    flex: largura ? `0 0 ${largura}px` : "1 1 0", minWidth: 0, height: "100%", padding: 0, border: "none", cursor: "pointer",
                    background: d.dia === foco ? PALETA.areia : "transparent", display: "flex", alignItems: "flex-end", justifyContent: "center", borderRadius: 4,
                  }}>
                  {d.estado !== "futuro" && (
                    <span style={{
                      // A área de toque é a coluna inteira; a barra, fina (no máximo 44px).
                      display: "block", width: "100%", maxWidth: 44, height: `${Math.max(pct, d.valor > 0 ? 1.5 : 0.8)}%`, borderRadius: "4px 4px 0 0",
                      background: d.estado === "hoje"
                        ? `repeating-linear-gradient(135deg, ${corDa(d)} 0 4px, ${PALETA.areiaBorda} 4px 7px)`
                        : d.valor > 0 ? corDa(d) : PALETA.areiaBorda,
                    }} />
                  )}
                </button>
              );
            })}
            {media > 0 && (
              <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: `${(media / max) * 100}%`, borderTop: `2px dashed ${PALETA.carvao}`, pointerEvents: "none" }}>
                <span style={{ position: "absolute", right: 0, bottom: 3, fontSize: "0.7rem", fontWeight: 800, color: PALETA.carvao, background: "rgba(255,255,255,0.85)", padding: "0 4px", borderRadius: 4 }}>
                  média {fmtReais(media)}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 2, marginTop: 4 }} aria-hidden>
            {dias.map((d, i) => (
              <span key={d.dia} style={{
                flex: largura ? `0 0 ${largura}px` : "1 1 0", minWidth: 0, textAlign: "center", fontSize: "0.66rem", lineHeight: 1.2,
                color: d.dia === melhor || d.dia === pior ? PALETA.carvao : PALETA.areiaTinta, fontWeight: d.dia === melhor || d.dia === pior ? 800 : 500,
                overflow: "visible", whiteSpace: "nowrap",
              }}>
                {mostraRotulo(i) ? (
                  <>{d.dia.slice(8, 10)}{rotuloACada === 1 && <><br />{DIAS_CURTOS[d.diaSemana]}</>}</>
                ) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1.1rem", marginTop: 10, fontSize: "0.74rem", color: PALETA.areiaTinta }}>
        <Legenda cor={PALETA.ok} texto="▲ melhor dia" />
        <Legenda cor={PALETA.atencao} texto="▼ pior dia (entre os fechados com venda)" />
        <Legenda cor={`repeating-linear-gradient(135deg, #A8A29E 0 4px, ${PALETA.areiaBorda} 4px 7px)`} texto="hoje, ainda aberto" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 18, borderTop: `2px dashed ${PALETA.carvao}` }} /> média por dia
        </span>
      </div>
    </div>
  );
}

function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: cor }} /> {texto}
    </span>
  );
}

// ── A TABELA DIA A DIA ──────────────────────────────────────────────────────

function TabelaDosDias({ dados, rotuloDaMedia }: { dados: Resposta; rotuloDaMedia: string }) {
  // O desconto dado ao fechar a mesa é coluna À PARTE, depois dos cancelados e
  // só quando o período tem: não entra na conta da linha nem sai do valor.
  const comDescontoNaMesa = dados.total.descontoNaMesa > 0;
  const cabecalho: Array<{ t: string; dica?: string; esquerda?: boolean }> = [
    { t: "Data", esquerda: true }, { t: "Dia", esquerda: true },
    { t: "Vendas", dica: "Atendimentos: cada pedido é uma venda, e a mesa é uma venda só, no dia do primeiro lançamento. Embaixo, os lançamentos quando são mais." },
    { t: "Valor das vendas" }, { t: "Acumulado" },
    { t: "Ticket médio" }, { t: "Total dos itens", dica: "Preço × quantidade dos produtos, com as opções escolhidas neles." },
    { t: "Taxa de entrega" }, { t: "Outros", dica: "O que o app cobrou do cliente além dos itens e da entrega — a taxa de serviço do iFood, por exemplo." },
    { t: "Descontos", dica: "Cupons e descontos dos pedidos, inclusive os bancados pelo iFood/99. O desconto dado ao fechar a mesa fica à parte." },
    { t: "Cancelados" }, { t: "Valor cancelado" },
    ...(comDescontoNaMesa ? [{ t: "Desconto na mesa", dica: "Dado ao fechar a mesa, no dia do fechamento: consumo − (pago − serviço − gorjeta). À parte — não sai do valor das vendas. É um piso: troco deixado na mesa esconde parte dele." }] : []),
  ];
  const fixa: React.CSSProperties = { position: "sticky", left: 0, zIndex: 1 };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: comDescontoNaMesa ? 1030 : 940, borderCollapse: "collapse", fontSize: "0.83rem" }}>
        <thead>
          <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}`, background: "#fff" }}>
            {cabecalho.map((c, i) => (
              <th key={c.t} title={c.dica} style={{ ...th, textAlign: c.esquerda ? "left" : "right", ...(i === 0 ? { ...fixa, background: "#fff" } : {}),
                ...(c.dica ? { textDecoration: "underline dotted", cursor: "help" } : {}) }}>
                {c.t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dados.dias.map((d) => {
            const ehMelhor = dados.melhorDia?.dia === d.dia;
            const ehPior = dados.piorDia?.dia === d.dia;
            const futuro = d.estado === "futuro";
            const fundo = ehMelhor ? PALETA.okClaro : ehPior ? PALETA.atencaoClaro : "#fff";
            const apagado = futuro || d.lancamentos === 0;
            const cor = apagado ? PALETA.areiaTinta : PALETA.carvao;
            const v = (x: React.ReactNode) => (futuro ? "—" : x);
            return (
              <tr key={d.dia} style={{ borderBottom: `1px solid ${PALETA.areia}`, background: fundo, color: cor }}>
                <td style={{ ...td, ...fixa, background: fundo, fontWeight: 700, whiteSpace: "nowrap" }}>{fmtDia(d.dia)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {NOMES_DOS_DIAS[d.diaSemana]}
                  {d.estado === "hoje" && <Etiqueta cor={PALETA.carvao2} fundo={PALETA.areia} texto="hoje, aberto" />}
                  {d.estado === "antes" && <Etiqueta cor={PALETA.areiaTinta} fundo={PALETA.areia} texto="antes do 1º pedido" />}
                  {ehMelhor && <Etiqueta cor={PALETA.ok} fundo="#fff" texto="▲ melhor" />}
                  {ehPior && <Etiqueta cor={PALETA.atencao} fundo="#fff" texto="▼ pior" />}
                </td>
                <td style={{ ...td, ...num }}>{v(<>{d.vendas.toLocaleString("pt-BR")}<Lancamentos vendas={d.vendas} lancamentos={d.lancamentos} /></>)}</td>
                <td style={{ ...td, ...num, fontWeight: 800 }}>{v(fmtReais(d.valor))}</td>
                <td style={{ ...td, ...num, color: PALETA.areiaTinta }}>{reaisOuTraco(d.acumulado)}</td>
                <td style={{ ...td, ...num }}>{v(reaisOuTraco(d.ticketMedio))}</td>
                <td style={{ ...td, ...num }}>{v(reaisOuTraco(d.itens))}</td>
                <td style={{ ...td, ...num }}>{v(fmtReais(d.entrega))}</td>
                <td style={{ ...td, ...num }}>{v(reaisOuTraco(d.outros))}</td>
                <td style={{ ...td, ...num }}>{v(fmtReais(d.descontos))}</td>
                <td style={{ ...td, ...num, color: d.canceladosQtd ? PALETA.grave : cor }}>{v(d.canceladosQtd.toLocaleString("pt-BR"))}</td>
                <td style={{ ...td, ...num, color: d.canceladosQtd ? PALETA.grave : cor }}>{v(fmtReais(d.canceladosValor))}</td>
                {comDescontoNaMesa && <td style={{ ...td, ...num, color: PALETA.areiaTinta }}>{v(d.descontoNaMesa > 0 ? fmtReais(d.descontoNaMesa) : "—")}</td>}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <LinhaDaSoma rotulo="Total" s={dados.total} fixa={fixa} forte comDescontoNaMesa={comDescontoNaMesa} />
          <LinhaDaSoma rotulo={rotuloDaMedia} s={dados.media} fixa={fixa} comDescontoNaMesa={comDescontoNaMesa}
            dica={`Média dos ${dados.media.dias} dia${dados.media.dias === 1 ? "" : "s"}${dados.media.base === "fechados" ? " que já fecharam" : ""}, desde o 1º pedido da loja, dias sem venda incluídos. A linha fecha como as outras: "Outros" sai da mesma conta (valor − itens − entrega + descontos), e o arredondamento das médias fica nele.`} />
        </tfoot>
      </table>
    </div>
  );
}

/** "15 lanç." embaixo das vendas, quando a mesa juntou rodadas — o número de pedidos do dia. */
function Lancamentos({ vendas, lancamentos, fracao }: { vendas: number; lancamentos: number; fracao?: boolean }) {
  if (lancamentos === vendas) return null;
  return (
    <div title="Lançamentos: cada pedido, inclusive cada rodada de mesa" style={{ fontSize: "0.68rem", fontWeight: 500, color: PALETA.areiaTinta }}>
      {fracao ? fmtQtd(lancamentos) : lancamentos.toLocaleString("pt-BR")} lanç.
    </div>
  );
}

function LinhaDaSoma({ rotulo, s, fixa, forte, dica, comDescontoNaMesa }: { rotulo: string; s: SomaDosDias; fixa: React.CSSProperties; forte?: boolean; dica?: string; comDescontoNaMesa: boolean }) {
  const fundo = PALETA.areia;
  const q = (n: number) => (forte ? n.toLocaleString("pt-BR") : fmtQtd(n));
  return (
    <tr style={{ background: fundo, fontWeight: 800, borderTop: forte ? `2px solid ${PALETA.areiaBorda}` : undefined }} title={dica}>
      <td style={{ ...td, ...fixa, background: fundo, whiteSpace: "nowrap" }} colSpan={2}>{rotulo}</td>
      <td style={{ ...td, ...num }}>{q(s.vendas)}<Lancamentos vendas={s.vendas} lancamentos={s.lancamentos} fracao={!forte} /></td>
      <td style={{ ...td, ...num }}>{fmtReais(s.valor)}</td>
      <td style={{ ...td, ...num }} />
      <td style={{ ...td, ...num }}>{reaisOuTraco(s.ticketMedio)}</td>
      <td style={{ ...td, ...num }}>{reaisOuTraco(s.itens)}</td>
      <td style={{ ...td, ...num }}>{fmtReais(s.entrega)}</td>
      <td style={{ ...td, ...num }}>{reaisOuTraco(s.outros)}</td>
      <td style={{ ...td, ...num }}>{fmtReais(s.descontos)}</td>
      <td style={{ ...td, ...num }}>{q(s.canceladosQtd)}</td>
      <td style={{ ...td, ...num }}>{fmtReais(s.canceladosValor)}</td>
      {comDescontoNaMesa && <td style={{ ...td, ...num, color: PALETA.areiaTinta }}>{fmtReais(s.descontoNaMesa)}</td>}
    </tr>
  );
}

function Etiqueta({ cor, fundo, texto }: { cor: string; fundo: string; texto: string }) {
  return (
    <span style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 999, fontSize: "0.68rem", fontWeight: 800, color: cor, background: fundo, border: `1px solid ${cor}33`, whiteSpace: "nowrap" }}>
      {texto}
    </span>
  );
}

// ── A COMPARAÇÃO ────────────────────────────────────────────────────────────

function TabelaDaComparacao({ c }: { c: ComparacaoDosPeriodos }) {
  const linhas: Array<{ nome: string; atual: string; anterior: string; a: number; b: number }> = [
    { nome: "Valor das vendas", atual: fmtReais(c.total.atual), anterior: fmtReais(c.total.anterior), a: c.total.atual, b: c.total.anterior },
    { nome: "Vendas", atual: c.vendas.atual.toLocaleString("pt-BR"), anterior: c.vendas.anterior.toLocaleString("pt-BR"), a: c.vendas.atual, b: c.vendas.anterior },
    { nome: "Média por dia", atual: fmtReais(c.media.atual), anterior: fmtReais(c.media.anterior), a: c.media.atual, b: c.media.anterior },
    { nome: "Ticket médio", atual: fmtReais(c.ticketMedio.atual), anterior: fmtReais(c.ticketMedio.anterior), a: c.ticketMedio.atual, b: c.ticketMedio.anterior },
    {
      nome: "Melhor dia",
      atual: c.melhorDia.atual ? `${fmtReais(c.melhorDia.atual.valor)} (${diaCurto(c.melhorDia.atual)})` : "—",
      anterior: c.melhorDia.anterior ? `${fmtReais(c.melhorDia.anterior.valor)} (${diaCurto(c.melhorDia.anterior)})` : "—",
      a: c.melhorDia.atual?.valor || 0, b: c.melhorDia.anterior?.valor || 0,
    },
  ];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
            <th style={{ ...th, textAlign: "left" }} />
            <th style={{ ...th, textAlign: "right" }}>Este período</th>
            <th style={{ ...th, textAlign: "right" }}>Período anterior</th>
            <th style={{ ...th, textAlign: "right" }}>Variação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.nome} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
              <td style={{ ...td, fontWeight: 700 }}>{l.nome}</td>
              <td style={{ ...td, ...num, fontWeight: 800 }}>{l.atual}</td>
              <td style={{ ...td, ...num, color: PALETA.areiaTinta }}>{l.anterior}</td>
              <td style={{ ...td, ...num, fontSize: "0.8rem" }}>
                {l.b ? <VariacaoCurta atual={l.a} anterior={l.b} /> : <span style={{ color: PALETA.areiaTinta }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "↑ 12,3%" — a `Variacao` do modelo sem o "vs. período anterior" (a coluna já diz). */
function VariacaoCurta({ atual, anterior }: { atual: number; anterior: number }) {
  const v = ((atual - anterior) / Math.abs(anterior)) * 100;
  const cor = Math.abs(v) < 0.5 ? PALETA.areiaTinta : v > 0 ? PALETA.ok : PALETA.grave;
  return <span style={{ color: cor, fontWeight: 800 }}>{v > 0 ? "↑" : v < 0 ? "↓" : "="} {fmtPct(Math.abs(v))}</span>;
}

// ── A META DO MÊS ───────────────────────────────────────────────────────────

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function BlocoDaMeta({ meta, hoje }: { meta: ProgressoDaMeta; hoje: string }) {
  const nomeDoMes = MESES[Number(meta.mes.slice(5, 7)) - 1];
  const pct = Math.min(100, meta.pct * 100);
  const pctEsperado = Math.min(100, (meta.esperadoAteAgora / meta.meta) * 100);
  const situacao = {
    "batida": { cor: PALETA.ok, fundo: PALETA.okClaro, texto: "✓ Meta batida" },
    "no-ritmo": { cor: PALETA.ok, fundo: PALETA.okClaro, texto: "No ritmo da meta" },
    "abaixo-do-ritmo": { cor: PALETA.atencao, fundo: PALETA.atencaoClaro, texto: "Abaixo do ritmo" },
    "nao-batida": { cor: PALETA.grave, fundo: PALETA.graveClaro, texto: "Meta não batida" },
    "inicio-do-mes": { cor: PALETA.carvao2, fundo: PALETA.areia, texto: "Primeiro dia do mês" },
  }[meta.situacao];
  return (
    <Bloco titulo={`Meta de ${nomeDoMes}`}
      subtitulo={`${fmtReais(meta.meta)} no mês · acumulado até ${fmtDia(meta.ateODia)}${meta.ateODia === hoje ? " (hoje ainda aberto)" : ""}`}
      acoes={<span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.76rem", fontWeight: 800, color: situacao.cor, background: situacao.fundo, border: `1px solid ${situacao.cor}33` }}>{situacao.texto}</span>}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: "1.35rem", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{fmtReais(meta.acumulado)}</span>
        <span style={{ fontSize: "0.9rem", fontWeight: 800, color: PALETA.carvao2 }}>{fmtPct(meta.pct * 100)} da meta</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Acumulado do mês contra a meta"
        style={{ position: "relative", height: 12, background: PALETA.areia, borderRadius: 999, overflow: "visible", border: `1px solid ${PALETA.areiaBorda}` }}>
        <div style={{ height: "100%", width: `${pct}%`, background: situacao.cor, borderRadius: 999 }} />
        {!meta.mesEncerrado && pctEsperado > 0 && (
          <div title={`Onde deveria estar pelos dias fechados: ${fmtReais(meta.esperadoAteAgora)}`}
            style={{ position: "absolute", top: -4, bottom: -4, left: `${pctEsperado}%`, borderLeft: `2px dashed ${PALETA.carvao}` }} />
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.6rem 1rem", marginTop: 14, fontSize: "0.82rem" }}>
        {!meta.mesEncerrado && <Numero rotulo="Esperado pelos dias fechados" valor={fmtReais(meta.esperadoAteAgora)} dica="A meta dividida pelos dias do mês, vezes os dias que já fecharam (o tracejado da barra)." />}
        {meta.projecao !== null && <Numero rotulo={meta.mesEncerrado ? "Fechou o mês em" : "Projeção no ritmo atual"} valor={fmtReais(meta.projecao)} />}
        <Numero rotulo="Falta" valor={meta.faltam > 0 ? fmtReais(meta.faltam) : "nada"} />
        {meta.porDiaParaBater !== null && (
          <Numero rotulo={`Por dia, nos ${meta.diasRestantes} que faltam`} valor={fmtReais(meta.porDiaParaBater)} />
        )}
      </div>
    </Bloco>
  );
}

function Numero({ rotulo: r, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div title={dica}>
      <div style={{ ...rotulo, marginBottom: 2 }}>{r}</div>
      <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
    </div>
  );
}
