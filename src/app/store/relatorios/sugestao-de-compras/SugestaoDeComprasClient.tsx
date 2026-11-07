"use client";
/**
 * Lista de compras — o que comprar, de quem e quanto, para o lojista mandar
 * no WhatsApp do fornecedor ou imprimir. A conta mora em
 * lib/relatorios/sugestao-de-compras.ts; aqui são as escolhas (até o ideal ou
 * para N dias), a lista por fornecedor, o ideal editável na própria linha e o
 * texto pronto do pedido.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, MessageCircle } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia, fmtQtd, fmtReais } from "@/lib/relatorios/base";
import { quantidadeLegivel } from "@/lib/relatorios/consumo-pela-ficha";
import type { GrupoDoFornecedor, LinhaDaLista, ResultadoDaLista } from "@/lib/relatorios/sugestao-de-compras";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import AvisoNoTopo, { type Aviso } from "@/components/relatorios/AvisoNoTopo";
import { useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = {
  lojas: string[];
  base: { de: string; ate: string; dias: number; pedida: number };
  modo: "ideal" | "dias";
  dias: number;
  temFicha: boolean;
  insumosCadastrados: number;
  compras: ResultadoDaLista;
  preparos: LinhaDaLista[];
  valorDoEstoque: number;
  insumosSemCusto: number;
  semFicha: { produtos: { nome: string; quantidade: number }[]; total: number };
  incompletos: number;
};

const th: React.CSSProperties = { padding: "8px 0.8rem", fontWeight: 800, whiteSpace: "nowrap", textAlign: "right" };
const td: React.CSSProperties = { padding: "8px 0.8rem", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };
const cabecalhoDaTabela: React.CSSProperties = { color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` };

const SITUACAO: Record<LinhaDaLista["situacao"], { rotulo: string; cor: string; fundo: string }> = {
  acabou: { rotulo: "Acabou", cor: PALETA.grave, fundo: PALETA.graveClaro },
  abaixoDoMinimo: { rotulo: "Abaixo do mínimo", cor: PALETA.atencao, fundo: PALETA.atencaoClaro },
  comprar: { rotulo: "Comprar", cor: PALETA.brasaTinta, fundo: PALETA.brasaClaro },
  ok: { rotulo: "Ok", cor: PALETA.ok, fundo: PALETA.okClaro },
  semUso: { rotulo: "Sem uso", cor: PALETA.areiaTinta, fundo: PALETA.areia },
};

function Selo({ s }: { s: LinhaDaLista["situacao"] }) {
  const c = SITUACAO[s];
  return <span style={{ fontSize: "0.7rem", fontWeight: 800, color: c.cor, background: c.fundo, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{c.rotulo}</span>;
}

function fmtDura(d: number | null): string {
  if (d === null) return "—";
  if (d < 1) return "menos de 1 dia";
  return `${fmtQtd(Math.floor(d))} dia${Math.floor(d) === 1 ? "" : "s"}`;
}

/** O ideal na própria linha: digita, sai do campo (ou Enter) e grava. Vazio volta a sugerir pelo consumo. */
function CampoDoIdeal({ linha, aoSalvar }: { linha: LinhaDaLista; aoSalvar: (l: LinhaDaLista, texto: string) => Promise<boolean> }) {
  const original = linha.ideal != null ? String(linha.ideal).replace(".", ",") : "";
  const [texto, setTexto] = useState(original);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setTexto(original), [original]);
  const salvar = async () => {
    if (texto.trim() === original) return;
    setSalvando(true);
    const ok = await aoSalvar(linha, texto.trim());
    setSalvando(false);
    if (!ok) setTexto(original);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={salvar} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        inputMode="decimal" disabled={salvando} aria-label={`Estoque ideal de ${linha.nome} (${linha.unidade})`}
        placeholder={linha.idealSugerido != null ? fmtQtd(linha.idealSugerido) : "—"}
        title={linha.idealSugerido != null && linha.ideal == null ? `Sugerido pelo consumo de 7 dias: ${quantidadeLegivel(linha.idealSugerido, linha.unidade)}. Digite para fixar o seu.` : "Quanto você quer ter depois de comprar"}
        style={{ width: 76, padding: "5px 7px", borderRadius: 8, border: `1.5px solid ${linha.ideal == null ? PALETA.areiaBorda : PALETA.brasaBorda}`, fontSize: "0.82rem", fontFamily: "inherit", textAlign: "right", background: linha.ideal == null ? PALETA.areia : "#fff" }} />
      <span style={{ fontSize: "0.72rem", color: PALETA.areiaTinta }}>{linha.unidade}</span>
    </span>
  );
}

function TabelaDeInsumos({ linhas, aoSalvar, mostrarSituacao = true }: { linhas: LinhaDaLista[]; aoSalvar: (l: LinhaDaLista, texto: string) => Promise<boolean>; mostrarSituacao?: boolean }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 720 }}>
        <thead>
          <tr style={cabecalhoDaTabela}>
            <th style={{ ...th, textAlign: "left" }}>Insumo</th>
            <th style={th}>Comprar</th>
            <th style={th}>Tem hoje</th>
            <th style={th}>Dura</th>
            <th style={th}>Gasta por dia</th>
            <th style={th}>Mínimo</th>
            <th style={th} title="Quanto você quer ter depois de comprar. Vazio = o sistema sugere pelo consumo de 7 dias (em cinza).">Ideal</th>
            <th style={th}>Custo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
              <td style={{ ...td, textAlign: "left", whiteSpace: "normal", minWidth: 160 }}>
                <div style={{ fontWeight: 700 }}>{l.nome}</div>
                {mostrarSituacao && <div style={{ marginTop: 3 }}><Selo s={l.situacao} /></div>}
              </td>
              <td style={{ ...td, fontWeight: 900, fontSize: "0.95rem", color: l.comprar > 0 ? PALETA.carvao : PALETA.areiaTinta }}>
                {l.comprar > 0 ? quantidadeLegivel(l.comprar, l.unidade) : "—"}
              </td>
              <td style={{ ...td, color: l.saldo <= 0 ? PALETA.grave : PALETA.carvao2 }}>{quantidadeLegivel(l.saldo, l.unidade)}</td>
              <td style={{ ...td, color: l.duraDias !== null && l.duraDias < 2 ? PALETA.grave : PALETA.carvao2 }}>{fmtDura(l.duraDias)}</td>
              <td style={{ ...td, color: PALETA.areiaTinta }}>{l.consumoPorDia > 0 ? quantidadeLegivel(l.consumoPorDia, l.unidade) : "—"}</td>
              <td style={{ ...td, color: PALETA.areiaTinta }}>{l.minimo != null ? quantidadeLegivel(l.minimo, l.unidade) : "—"}</td>
              <td style={td}><CampoDoIdeal linha={l} aoSalvar={aoSalvar} /></td>
              <td style={{ ...td, fontWeight: 700, color: l.custoDaCompra === null ? PALETA.atencao : PALETA.carvao }}
                title={l.custoDaCompra === null ? "Insumo sem custo cadastrado: lance a compra ou o custo em Estoque" : undefined}>
                {l.comprar > 0 ? (l.custoDaCompra === null ? "sem custo" : fmtReais(l.custoDaCompra)) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SugestaoDeComprasClient({ inicio }: { inicio: InicioDosFiltros }) {
  const sp0 = useMemo(() => new URLSearchParams(inicio.query), [inicio.query]);
  const [modo, setModo] = useState<"ideal" | "dias">(sp0.get("modo") === "dias" ? "dias" : "ideal");
  const [dias, setDias] = useState(String(Number(sp0.get("dias")) || 7));
  const [base, setBase] = useState(String([7, 14, 28, 56].includes(Number(sp0.get("base"))) ? Number(sp0.get("base")) : 28));
  const [verTodos, setVerTodos] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);

  const query = new URLSearchParams({ base, modo, ...(modo === "dias" ? { dias } : {}) }).toString();
  useEffect(() => {
    try { window.history.replaceState(null, "", `${window.location.pathname}?${query}`); } catch {}
  }, [query]);
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("sugestao-de-compras", query);

  const salvarIdeal = useCallback(async (l: LinhaDaLista, texto: string) => {
    try {
      const r = await fetch("/api/store/relatorios/sugestao-de-compras", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ insumoId: l.id, ideal: texto }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || "Não salvou.");
      setAviso({ tipo: "ok", titulo: texto ? `Ideal de ${l.nome} salvo` : `Ideal de ${l.nome} apagado`, detalhe: texto ? "A lista já compra até ele." : "Volta a valer o sugerido pelo consumo." });
      recarregar();
      return true;
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "O ideal não foi salvo", detalhe: e?.message });
      return false;
    }
  }, [recarregar]);

  const copiar = async (g: GrupoDoFornecedor) => {
    try {
      await navigator.clipboard.writeText(g.texto);
      setAviso({ tipo: "ok", titulo: "Pedido copiado", detalhe: `Cole no WhatsApp de ${g.fornecedor}.` });
    } catch {
      setAviso({ tipo: "erro", titulo: "Não consegui copiar", detalhe: "Use o botão do WhatsApp, que já leva o texto." });
    }
  };

  const botao = (ativo: boolean): React.CSSProperties => ({
    padding: "7px 12px", borderRadius: 10, border: `1.5px solid ${ativo ? PALETA.marca : PALETA.areiaBorda}`, background: ativo ? PALETA.brasaClaro : "#fff",
    color: ativo ? PALETA.marca : PALETA.carvao2, fontWeight: 800, fontSize: "0.84rem", cursor: "pointer", fontFamily: "inherit",
  });
  const t = dados?.compras.totais;
  const aComprar = dados?.compras.fornecedores || [];
  const preparosParaFazer = (dados?.preparos || []).filter((p) => p.comprar > 0);

  return (
    <ModeloDoRelatorio
      titulo="Lista de compras"
      descricao="O que comprar, de qual fornecedor e quanto — pelo que você tem hoje e pelo quanto gasta por dia (suas vendas × a ficha técnica). Mande no WhatsApp do fornecedor ou imprima."
      slug="sugestao-de-compras" query={query} carregando={carregando} erro={erro} onRecarregar={recarregar}>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      <div className="fh-sem-impressao fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, padding: "0.9rem 1.1rem", marginBottom: "1.25rem", display: "grid", gap: "0.8rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta, minWidth: 120 }}>Quanto comprar</span>
          <button type="button" style={botao(modo === "ideal")} onClick={() => setModo("ideal")}>Até o estoque ideal</button>
          <button type="button" style={botao(modo === "dias")} onClick={() => setModo("dias")}>Para os próximos dias</button>
          {modo === "dias" && (
            <select value={dias} onChange={(e) => setDias(e.target.value)} aria-label="Quantos dias a compra cobre"
              style={{ padding: "7px 10px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontWeight: 700, fontFamily: "inherit" }}>
              {[2, 3, 4, 5, 7, 10, 14, 15, 21, 30].map((n) => <option key={n} value={n}>{n} dias</option>)}
            </select>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta, minWidth: 120 }}>Gasto médio de</span>
          {["7", "14", "28", "56"].map((b) => (
            <button key={b} type="button" style={botao(base === b)} onClick={() => setBase(b)}>{b === "7" ? "1 semana" : `${Number(b) / 7} semanas`}</button>
          ))}
        </div>
      </div>

      {dados && !dados.temFicha && (
        <Bloco titulo="Comece pela ficha técnica" subtitulo="Sem ficha, o sistema não sabe quanto cada venda gasta de insumo.">
          <p style={{ margin: "0 0 0.8rem", fontSize: "0.88rem", lineHeight: 1.6, color: PALETA.carvao2 }}>
            A lista ainda funciona pelo mínimo e pelo ideal que você cadastrar em cada insumo. Com a ficha técnica, ela calcula sozinha quanto você gasta por dia e quanto comprar.
          </p>
          <Link href="/store/estoque" className="btn btn-outline" style={{ textDecoration: "none" }}>Abrir Estoque → Fichas técnicas</Link>
        </Bloco>
      )}

      {dados && t && (
        <GradeDeCartoes>
          <Cartao rotulo="Comprar agora" valor={fmtReais(t.aComprar)}
            detalhe={t.itens ? `${t.itens} insumo${t.itens === 1 ? "" : "s"} · ${aComprar.length} fornecedor${aComprar.length === 1 ? "" : "es"}${t.itensSemCusto ? ` · ${t.itensSemCusto} sem custo (fora do total)` : ""}` : "Nada para comprar agora"} />
          <Cartao rotulo="Acabaram" valor={String(t.acabaram)} tom={t.acabaram ? "grave" : "ok"} detalhe="Saldo zerado ou negativo" />
          <Cartao rotulo="Abaixo do mínimo" valor={String(t.abaixoDoMinimo)} tom={t.abaixoDoMinimo ? "atencao" : "ok"} detalhe="Ainda tem, mas pouco" />
          <Cartao rotulo="Valor do estoque hoje" valor={fmtReais(dados.valorDoEstoque)}
            detalhe={dados.insumosSemCusto ? `${dados.insumosSemCusto} insumo${dados.insumosSemCusto === 1 ? "" : "s"} com saldo e sem custo (fora do valor)` : "Saldo × custo de hoje"} />
        </GradeDeCartoes>
      )}

      {dados && (
        <div style={{ display: "grid", gap: "0.6rem", marginBottom: "1.25rem", fontSize: "0.85rem", lineHeight: 1.5 }}>
          {dados.base.dias < dados.base.pedida && (
            <div style={{ background: PALETA.areia, border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 12, padding: "0.7rem 1rem" }}>
              As vendas começam em {fmtDia(dados.base.de)}: o gasto médio é sobre {dados.base.dias} dia{dados.base.dias === 1 ? "" : "s"}. Com mais dias de venda, a conta fica mais firme.
            </div>
          )}
          {dados.semFicha.total > 0 && (
            <div style={{ background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, borderRadius: 12, padding: "0.7rem 1rem" }}>
              <strong>{dados.semFicha.total} produto{dados.semFicha.total === 1 ? "" : "s"} vendido{dados.semFicha.total === 1 ? "" : "s"} sem ficha técnica</strong> não entra{dados.semFicha.total === 1 ? "" : "m"} no gasto por dia
              {" "}(os mais vendidos: {dados.semFicha.produtos.slice(0, 5).map((p) => p.nome).join(", ")}). O que eles gastam fica fora da lista. <Link href="/store/estoque" style={{ color: PALETA.marca, fontWeight: 800 }}>Cadastrar fichas</Link>
            </div>
          )}
        </div>
      )}

      {dados && aComprar.length === 0 && (
        <Bloco titulo="Nada para comprar agora">
          <Vazio texto={dados.temFicha || dados.compras.linhas.some((l) => l.minimo != null || l.ideal != null)
            ? "Todos os insumos estão acima do que você precisa. Confira o ideal de cada um em “Ver todos os insumos”."
            : "Cadastre o mínimo ou o ideal dos insumos (em “Ver todos os insumos”) ou a ficha técnica dos produtos para a lista calcular."} />
        </Bloco>
      )}

      {aComprar.map((g) => (
        <Bloco key={g.fornecedor} semPadding titulo={g.fornecedor}
          subtitulo={`${g.itens.length} insumo${g.itens.length === 1 ? "" : "s"} · ${fmtReais(g.total)}${g.itensSemCusto ? ` + ${g.itensSemCusto} sem custo` : ""}`}
          acoes={
            <div className="fh-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-outline" onClick={() => copiar(g)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px" }}>
                <Copy size={14} /> Copiar pedido
              </button>
              <a href={`https://wa.me/${g.telefone || ""}?text=${encodeURIComponent(g.texto)}`} target="_blank" rel="noopener noreferrer" className="btn btn-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", textDecoration: "none", background: "#25D366", borderColor: "#25D366" }}>
                <MessageCircle size={14} /> Mandar no WhatsApp
              </a>
            </div>
          }>
          <TabelaDeInsumos linhas={g.itens} aoSalvar={salvarIdeal} />
        </Bloco>
      ))}

      {preparosParaFazer.length > 0 && (
        <Bloco semPadding titulo="Para produzir na cozinha" subtitulo="Preparos (massa, recheio) que vão faltar. O que eles gastam de insumo já está na lista de compras acima.">
          <TabelaDeInsumos linhas={preparosParaFazer} aoSalvar={salvarIdeal} />
        </Bloco>
      )}

      {dados && dados.compras.linhas.length > 0 && (
        <div className="fh-sem-impressao" style={{ marginBottom: "1.25rem" }}>
          <button type="button" className="btn btn-outline" onClick={() => setVerTodos((v) => !v)}>
            {verTodos ? "Esconder a lista completa" : `Ver todos os insumos (${dados.compras.linhas.length}) e ajustar o ideal`}
          </button>
        </div>
      )}
      {dados && verTodos && (
        <Bloco semPadding titulo="Todos os insumos" subtitulo="Digite o ideal de cada um: quanto você quer ter na prateleira depois de comprar. Em cinza, o sugerido pelo consumo de 7 dias.">
          <TabelaDeInsumos linhas={dados.compras.linhas} aoSalvar={salvarIdeal} />
        </Bloco>
      )}

      {dados && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.6 }}>
          Gasto por dia = o que suas vendas de {fmtDia(dados.base.de)} a {fmtDia(dados.base.ate)} gastariam pela ficha técnica de hoje, dividido por {dados.base.dias} dias (hoje fica fora: o dia não acabou).
          {" "}{dados.modo === "dias" ? `Comprar = o gasto de ${dados.dias} dias (nunca abaixo do mínimo) menos o que você tem hoje.` : "Comprar = o ideal menos o que você tem hoje. Sem ideal cadastrado, vale o gasto de 7 dias (nunca abaixo do mínimo)."}
          {" "}Saldo negativo conta como zero. A quantidade sobe para um número redondo de pedir. Preparo (massa, recheio) entra pelos insumos que ele leva.
          {" "}O fornecedor é o da última compra lançada do insumo. Custo = o da última compra (ou o do cadastro).
          {dados.incompletos > 0 && ` ${dados.incompletos} item(ns) vendido(s) tinham opção escolhida sem ficha técnica: o gasto deles saiu menor.`}
        </p>
      )}
    </ModeloDoRelatorio>
  );
}
