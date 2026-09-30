"use client";
/**
 * A moldura de toda tela de relatório: o caminho de volta ao menu, o título,
 * a explicação curta, EXPORTAR EXCEL e IMPRIMIR (os dois botões da Saipos), e
 * os estados de carregando e de erro. Mais os blocos que se repetem: cartão de
 * número, estado vazio e o aviso "comparado com o período anterior".
 */
import React from "react";
import Link from "next/link";
import { ArrowLeft, Download, Printer, RefreshCw } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia } from "@/lib/relatorios/base";

export default function ModeloDoRelatorio({
  titulo, descricao, slug, query, periodo, carregando, erro, onRecarregar, semExportar, children,
}: {
  titulo: string;
  descricao: string;
  /** A rota da API do relatório (/api/store/relatorios/<slug>) — para o Excel. */
  slug: string;
  query: string;
  periodo?: { de: string; ate: string } | null;
  carregando?: boolean;
  erro?: string | null;
  onRecarregar?: () => void;
  semExportar?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ padding: "1.5rem 1rem 3rem", maxWidth: 1280, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", color: PALETA.carvao }}>
      {/* Impressão em A4: some a navegação do painel e os filtros, fica o relatório. */}
      <style>{`
        @media print {
          .fh-sem-impressao, nav, aside, [data-fh-nav] { display: none !important; }
          body { background: #fff !important; }
          .fh-relatorio-bloco { break-inside: avoid; box-shadow: none !important; }
        }
      `}</style>

      <Link href="/store/relatorios" className="fh-sem-impressao"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 700, color: PALETA.areiaTinta, textDecoration: "none", marginBottom: 10 }}>
        <ArrowLeft size={14} /> Relatórios
      </Link>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap", marginBottom: "1.1rem" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: "1.55rem", fontWeight: 900, letterSpacing: "-0.01em" }}>{titulo}</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.86rem", color: PALETA.areiaTinta, maxWidth: 720 }}>{descricao}</p>
          {periodo && (
            <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: PALETA.carvao2, fontWeight: 700 }}>
              {periodo.de === periodo.ate ? fmtDia(periodo.de) : `${fmtDia(periodo.de)} a ${fmtDia(periodo.ate)}`}
              <span style={{ fontWeight: 500, color: PALETA.areiaTinta }}> · o dia vira às 5h</span>
            </p>
          )}
        </div>
        <div className="fh-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onRecarregar && (
            <button type="button" onClick={onRecarregar} className="btn btn-outline" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={15} /> Atualizar
            </button>
          )}
          <button type="button" onClick={() => window.print()} className="btn btn-outline" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Printer size={15} /> Imprimir
          </button>
          {!semExportar && (
            <a href={`/api/store/relatorios/${slug}?${query}${query ? "&" : ""}formato=xlsx`} className="btn btn-primary"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
              <Download size={15} /> Exportar Excel
            </a>
          )}
        </div>
      </header>

      {erro && (
        <div role="alert" style={{ background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, color: PALETA.grave, borderRadius: 12, padding: "0.8rem 1rem", marginBottom: "1rem", fontWeight: 700, fontSize: "0.88rem" }}>
          {erro}
        </div>
      )}

      <div style={{ opacity: carregando ? 0.55 : 1, transition: "opacity 0.15s" }} aria-busy={carregando || undefined}>
        {children}
      </div>
    </div>
  );
}

/** Um número grande com rótulo — os cartões do topo dos relatórios. */
export function Cartao({ rotulo, valor, detalhe, tom = "neutro" }: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: React.ReactNode;
  tom?: "neutro" | "ok" | "atencao" | "grave";
}) {
  const cor = tom === "ok" ? PALETA.ok : tom === "atencao" ? PALETA.atencao : tom === "grave" ? PALETA.grave : PALETA.carvao;
  return (
    <div className="fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 14, padding: "0.9rem 1rem", minWidth: 0 }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em" }}>{rotulo}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 900, color: cor, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
      {detalhe && <div style={{ fontSize: "0.76rem", color: PALETA.areiaTinta, marginTop: 4 }}>{detalhe}</div>}
    </div>
  );
}

/** A grade de cartões. */
export function GradeDeCartoes({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>{children}</div>;
}

/** Um bloco branco com título — a unidade de cada seção do relatório. */
export function Bloco({ titulo, subtitulo, acoes, children, semPadding }: {
  titulo?: React.ReactNode; subtitulo?: React.ReactNode; acoes?: React.ReactNode; children: React.ReactNode; semPadding?: boolean;
}) {
  return (
    <section className="fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, marginBottom: "1.25rem", overflow: "hidden" }}>
      {(titulo || acoes) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "0.9rem 1.1rem", borderBottom: `1px solid ${PALETA.areiaBorda}`, background: PALETA.areia }}>
          <div>
            {titulo && <h2 style={{ margin: 0, fontSize: "0.98rem", fontWeight: 900 }}>{titulo}</h2>}
            {subtitulo && <p style={{ margin: "2px 0 0", fontSize: "0.76rem", color: PALETA.areiaTinta }}>{subtitulo}</p>}
          </div>
          {acoes}
        </div>
      )}
      <div style={semPadding ? undefined : { padding: "1rem 1.1rem" }}>{children}</div>
    </section>
  );
}

/** Nada no período — dito com o que fazer, não uma tabela vazia. */
export function Vazio({ texto = "Nenhuma venda no período e filtros escolhidos." }: { texto?: string }) {
  return <div style={{ padding: "2.5rem 1rem", textAlign: "center", color: PALETA.areiaTinta, fontSize: "0.9rem" }}>{texto}</div>;
}

/** "↑ 12% vs. período anterior" — verde se subiu, vermelho se caiu (ou o contrário, para custo). */
export function Variacao({ atual, anterior, menorEhMelhor }: { atual: number; anterior: number; menorEhMelhor?: boolean }) {
  if (!anterior) return <span style={{ color: PALETA.areiaTinta }}>sem período anterior para comparar</span>;
  const v = ((atual - anterior) / Math.abs(anterior)) * 100;
  const bom = menorEhMelhor ? v < 0 : v > 0;
  const cor = Math.abs(v) < 0.5 ? PALETA.areiaTinta : bom ? PALETA.ok : PALETA.grave;
  return (
    <span style={{ color: cor, fontWeight: 700 }}>
      {v > 0 ? "↑" : v < 0 ? "↓" : "="} {Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior
    </span>
  );
}

/** Barrinha horizontal de participação, dentro de uma célula de tabela. */
export function BarraDePct({ pct, cor = PALETA.brasa }: { pct: number; cor?: string }) {
  return (
    <div style={{ height: 6, background: PALETA.areia, borderRadius: 999, overflow: "hidden", minWidth: 60 }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, background: cor, borderRadius: 999 }} />
    </div>
  );
}
