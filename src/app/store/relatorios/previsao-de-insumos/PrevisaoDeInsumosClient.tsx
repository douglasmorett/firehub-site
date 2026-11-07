"use client";
/**
 * Previsão de insumos da semana — quanto de cada insumo vai sair em cada um
 * dos próximos 7 dias, pela média do mesmo dia da semana × a ficha técnica.
 * A conta mora em lib/relatorios/previsao-de-insumos.ts; aqui são as
 * escolhas (semanas da média, média/−10%/+10%), o custo de cada dia e a
 * tabela insumo × dia.
 */
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia, fmtReais, NOMES_DOS_DIAS } from "@/lib/relatorios/base";
import { quantidadeLegivel } from "@/lib/relatorios/consumo-pela-ficha";
import { FAIXAS, type Faixa, type LinhaDaPrevisao, type ResultadoDaPrevisao } from "@/lib/relatorios/previsao-de-insumos";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = {
  lojas: string[];
  base: { de: string; ate: string; dias: number; semanas: number };
  temFicha: boolean;
  insumos: ResultadoDaPrevisao;
  preparos: ResultadoDaPrevisao;
  semFicha: { produtos: { nome: string; quantidade: number }[]; total: number };
  incompletos: number;
};

const ROTULO_DA_FAIXA: Record<Faixa, string> = { menos10: "−10%", media: "Média", mais10: "+10%" };
const th: React.CSSProperties = { padding: "8px 0.7rem", fontWeight: 800, whiteSpace: "nowrap", textAlign: "right" };
const td: React.CSSProperties = { padding: "7px 0.7rem", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };

function TabelaDaPrevisao({ p, fator, linhas }: { p: ResultadoDaPrevisao; fator: number; linhas: LinhaDaPrevisao[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem", minWidth: 860 }}>
        <thead>
          <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
            <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: "#fff" }}>Insumo</th>
            {p.dias.map((d) => <th key={d.dia} style={th}>{d.rotulo}</th>)}
            <th style={th}>Semana</th>
            <th style={th}>Custo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
              <td style={{ ...td, textAlign: "left", fontWeight: 700, whiteSpace: "normal", minWidth: 150, position: "sticky", left: 0, background: "#fff" }}>{l.nome}</td>
              {l.porDia.map((q, k) => <td key={k} style={{ ...td, color: q > 0 ? PALETA.carvao2 : PALETA.areiaBorda }}>{q > 0 ? quantidadeLegivel(q * fator, l.unidade) : "—"}</td>)}
              <td style={{ ...td, fontWeight: 900 }}>{quantidadeLegivel(l.total * fator, l.unidade)}</td>
              <td style={{ ...td, fontWeight: 700, color: l.custoTotal === null ? PALETA.atencao : PALETA.carvao }}>
                {l.custoTotal === null ? "sem custo" : fmtReais(l.custoTotal * fator)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${PALETA.areiaBorda}`, background: PALETA.areia }}>
            <td style={{ ...td, textAlign: "left", fontWeight: 900, position: "sticky", left: 0, background: PALETA.areia }}>Custo do dia</td>
            {p.dias.map((d) => <td key={d.dia} style={{ ...td, fontWeight: 800 }}>{fmtReais(d.custo * fator)}</td>)}
            <td style={td} />
            <td style={{ ...td, fontWeight: 900 }}>{fmtReais(p.totais.custo * fator)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function PrevisaoDeInsumosClient({ inicio }: { inicio: InicioDosFiltros }) {
  const sp0 = useMemo(() => new URLSearchParams(inicio.query), [inicio.query]);
  const [semanas, setSemanas] = useState(String([2, 4, 8].includes(Number(sp0.get("semanas"))) ? Number(sp0.get("semanas")) : 4));
  const [faixa, setFaixa] = useState<Faixa>("media");
  const [busca, setBusca] = useState("");
  const query = new URLSearchParams({ semanas }).toString();
  useEffect(() => {
    try { window.history.replaceState(null, "", `${window.location.pathname}?${query}`); } catch {}
  }, [query]);
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("previsao-de-insumos", query);

  const fator = FAIXAS[faixa];
  const p = dados?.insumos;
  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (p?.linhas || []).filter((l) => !t || l.nome.toLowerCase().includes(t));
  }, [p, busca]);
  const maiorDia = p?.dias.reduce((m, d) => (d.custo > (m?.custo ?? -1) ? d : m), null as ResultadoDaPrevisao["dias"][number] | null) ?? null;
  const maiorCusto = Math.max(0, ...(p?.dias || []).map((d) => d.custo));
  const diasSemAmostra = (p?.dias || []).filter((d) => d.amostras === 0);

  const botao = (ativo: boolean): React.CSSProperties => ({
    padding: "7px 12px", borderRadius: 10, border: `1.5px solid ${ativo ? PALETA.marca : PALETA.areiaBorda}`, background: ativo ? PALETA.brasaClaro : "#fff",
    color: ativo ? PALETA.marca : PALETA.carvao2, fontWeight: 800, fontSize: "0.84rem", cursor: "pointer", fontFamily: "inherit",
  });

  return (
    <ModeloDoRelatorio
      titulo="Previsão de insumos da semana"
      descricao="Quanto de cada insumo vai sair em cada um dos próximos 7 dias: a média do mesmo dia da semana nas últimas semanas × a ficha técnica. Sexta se compara com sexta."
      slug="previsao-de-insumos" query={query} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <div className="fh-sem-impressao fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, padding: "0.9rem 1.1rem", marginBottom: "1.25rem", display: "grid", gap: "0.8rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta, minWidth: 120 }}>Média das últimas</span>
          {["2", "4", "8"].map((s) => <button key={s} type="button" style={botao(semanas === s)} onClick={() => setSemanas(s)}>{s} semanas</button>)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta, minWidth: 120 }}>Mostrar</span>
          {(["menos10", "media", "mais10"] as Faixa[]).map((f) => (
            <button key={f} type="button" style={botao(faixa === f)} onClick={() => setFaixa(f)}>
              {f === "media" ? "Média" : f === "menos10" ? "Semana fraca (−10%)" : "Semana forte (+10%)"}
            </button>
          ))}
        </div>
      </div>

      {dados && !dados.temFicha && (
        <Bloco titulo="Comece pela ficha técnica" subtitulo="Sem ficha, o sistema não sabe quanto cada venda gasta de insumo.">
          <Link href="/store/estoque" className="btn btn-outline" style={{ textDecoration: "none" }}>Abrir Estoque → Fichas técnicas</Link>
        </Bloco>
      )}

      {p && (
        <GradeDeCartoes>
          <Cartao rotulo={`Custo previsto da semana (${ROTULO_DA_FAIXA[faixa]})`} valor={fmtReais(p.totais.custo * fator)}
            detalhe={`Média ${fmtReais(p.totais.custo)} · −10% ${fmtReais(p.totais.custo * 0.9)} · +10% ${fmtReais(p.totais.custo * 1.1)}`} />
          <Cartao rotulo="Dia mais pesado" valor={maiorDia && maiorDia.custo > 0 ? NOMES_DOS_DIAS[maiorDia.diaSemana] : "—"}
            detalhe={maiorDia && maiorDia.custo > 0 ? `${fmtReais(maiorDia.custo * fator)} em insumos` : "Sem consumo previsto"} />
          <Cartao rotulo="Insumos na semana" valor={String(p.linhas.length)}
            detalhe={p.totais.insumosSemCusto ? `${p.totais.insumosSemCusto} sem custo (fora do valor)` : "Todos com custo"} tom={p.totais.insumosSemCusto ? "atencao" : "neutro"} />
        </GradeDeCartoes>
      )}

      {dados && (
        <div style={{ display: "grid", gap: "0.6rem", marginBottom: "1.25rem", fontSize: "0.85rem", lineHeight: 1.5 }}>
          {dados.base.dias < dados.base.semanas * 7 && (
            <div style={{ background: PALETA.areia, border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 12, padding: "0.7rem 1rem" }}>
              As vendas começam em {fmtDia(dados.base.de)}: a média é sobre {dados.base.dias} dia{dados.base.dias === 1 ? "" : "s"}.
              {diasSemAmostra.length > 0 && ` Ainda não houve ${diasSemAmostra.map((d) => NOMES_DOS_DIAS[d.diaSemana].toLowerCase()).join(", ")} na base: esse dia aparece zerado.`}
            </div>
          )}
          {dados.semFicha.total > 0 && (
            <div style={{ background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, borderRadius: 12, padding: "0.7rem 1rem" }}>
              <strong>{dados.semFicha.total} produto{dados.semFicha.total === 1 ? "" : "s"} vendido{dados.semFicha.total === 1 ? "" : "s"} sem ficha técnica</strong> fica{dados.semFicha.total === 1 ? "" : "m"} fora da previsão
              {" "}(os mais vendidos: {dados.semFicha.produtos.slice(0, 5).map((x) => x.nome).join(", ")}). <Link href="/store/estoque" style={{ color: PALETA.marca, fontWeight: 800 }}>Cadastrar fichas</Link>
            </div>
          )}
        </div>
      )}

      {p && p.linhas.length > 0 && (
        <Bloco titulo="Custo de cada dia" subtitulo={`${ROTULO_DA_FAIXA[faixa]} do custo dos insumos previsto, pelo custo de hoje.`}>
          <div style={{ display: "grid", gap: 6 }}>
            {p.dias.map((d) => (
              <div key={d.dia} style={{ display: "grid", gridTemplateColumns: "92px 1fr 100px", gap: 10, alignItems: "center", fontSize: "0.84rem", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ fontWeight: 700, color: PALETA.carvao2 }}>{d.rotulo}</span>
                <div style={{ height: 10, background: PALETA.areia, borderRadius: 999, overflow: "hidden" }} aria-hidden>
                  <div style={{ height: "100%", width: `${maiorCusto > 0 ? (d.custo / maiorCusto) * 100 : 0}%`, background: PALETA.brasa, borderRadius: 999 }} />
                </div>
                <span style={{ textAlign: "right", fontWeight: 800 }}>{fmtReais(d.custo * fator)}</span>
              </div>
            ))}
          </div>
        </Bloco>
      )}

      {p && (
        <Bloco semPadding titulo={`Insumos × dia (${ROTULO_DA_FAIXA[faixa]})`} subtitulo="Os que mais custam primeiro. Quantidade na unidade do estoque, em kg/litro quando passa de mil."
          acoes={
            <div className="fh-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo…" aria-label="Buscar insumo"
                style={{ padding: "7px 12px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.85rem", fontFamily: "inherit", width: 200 }} />
              <Link href="/store/relatorios/sugestao-de-compras?modo=dias&dias=7" style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.marca, textDecoration: "none" }}>Lista de compras para 7 dias →</Link>
            </div>
          }>
          {linhas.length === 0
            ? <Vazio texto={busca ? `Nenhum insumo com “${busca}”.` : "Nenhum consumo previsto: sem venda com ficha técnica nas últimas semanas."} />
            : <TabelaDaPrevisao p={p} fator={fator} linhas={linhas} />}
        </Bloco>
      )}

      {dados && dados.preparos.linhas.length > 0 && (
        <Bloco semPadding titulo="Preparos para produzir" subtitulo="Massa, recheio e o que mais a cozinha faz. O que eles levam de insumo já está na tabela acima.">
          <TabelaDaPrevisao p={dados.preparos} fator={fator} linhas={dados.preparos.linhas} />
        </Bloco>
      )}

      {dados && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.6 }}>
          Cada dia = a média do que as vendas do mesmo dia da semana gastaram de {fmtDia(dados.base.de)} a {fmtDia(dados.base.ate)}, pela ficha técnica de hoje. Dia da semana em que a loja não vendeu entra como zero.
          −10% e +10% são a folga para uma semana mais fraca ou mais forte. Custo = o de hoje do insumo (última compra ou cadastro); insumo sem custo aparece com a quantidade e fica fora do valor.
          {dados.incompletos > 0 && ` ${dados.incompletos} item(ns) vendido(s) tinham opção escolhida sem ficha técnica: a previsão deles saiu menor.`}
        </p>
      )}
    </ModeloDoRelatorio>
  );
}
