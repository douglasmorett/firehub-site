"use client";
/**
 * A moldura de toda tela de relatório: o caminho de volta ao menu, o título,
 * a explicação curta, EXPORTAR EXCEL e BAIXAR PDF, e os estados de carregando
 * e de erro. Mais os blocos que se repetem: cartão de número, estado vazio e o
 * aviso "comparado com o período anterior".
 *
 * O PDF é a impressão do navegador ("Salvar como PDF" no Chrome), no padrão
 * que o lojista conhece do SWFast: logo e nome da loja, título, período,
 * filtros e a hora em que foi gerado no topo; o cabeçalho das tabelas repetido
 * em cada folha; "FireHub · Página x de y" no rodapé (margem do @page,
 * Chrome 131+). Tudo aqui, para valer em todo relatório sem mexer em cada
 * tela: as regras de tabela pegam qualquer <table> dentro da moldura. Tabela
 * larga (min-width acima da folha em pé) faz o PDF sair deitado, para nada
 * cortar na direita.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Download, FileDown, RefreshCw } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia } from "@/lib/relatorios/base";

type DadosDaLoja = { nomeDaLoja: string; logo: string | null; fuso: string | null };
const ContextoDaLoja = createContext<DadosDaLoja | null>(null);

/** A loja do cabeçalho do PDF — posta uma vez no layout de app/store/relatorios. */
export function LojaDoRelatorio({ loja, children }: { loja: DadosDaLoja; children: React.ReactNode }) {
  return <ContextoDaLoja.Provider value={loja}>{children}</ContextoDaLoja.Provider>;
}

/** "07/11/2026 14:32" no relógio da loja. */
function agoraNaLoja(fuso: string | null | undefined): string {
  const p: Record<string, string> = {};
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso || "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  for (const parte of f.formatToParts(new Date())) p[parte.type] = parte.value;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** Acima disto (px) a tabela não cabe na A4 em pé com a fonte da impressão. */
const LARGURA_DA_FOLHA_EM_PE = 760;

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
  const loja = useContext(ContextoDaLoja);
  const raiz = useRef<HTMLDivElement>(null);
  // Hora e orientação são as do MOMENTO da impressão (o Ctrl+P também passa
  // por aqui): o flushSync desenha antes de o Chrome montar a prévia.
  const [impressao, setImpressao] = useState<{ geradoEm: string; deitado: boolean } | null>(null);
  const textoDoPeriodo = periodo ? (periodo.de === periodo.ate ? fmtDia(periodo.de) : `${fmtDia(periodo.de)} a ${fmtDia(periodo.ate)}`) : "";

  useEffect(() => {
    let tituloDaAba = "";
    const antes = () => {
      const tabelas = Array.from(raiz.current?.querySelectorAll("table") || []);
      const deitado = tabelas.some((t) => {
        const minimo = getComputedStyle(t).minWidth;
        return minimo.endsWith("px") && parseFloat(minimo) > LARGURA_DA_FOLHA_EM_PE;
      });
      flushSync(() => setImpressao({ geradoEm: agoraNaLoja(loja?.fuso), deitado }));
      // O título da aba é o nome que o Chrome sugere para o arquivo PDF.
      tituloDaAba = document.title;
      document.title = [titulo, loja?.nomeDaLoja, textoDoPeriodo.replace(/\//g, "-")].filter(Boolean).join(" - ");
    };
    const depois = () => { if (tituloDaAba) document.title = tituloDaAba; };
    window.addEventListener("beforeprint", antes);
    window.addEventListener("afterprint", depois);
    return () => { window.removeEventListener("beforeprint", antes); window.removeEventListener("afterprint", depois); };
  }, [titulo, textoDoPeriodo, loja?.nomeDaLoja, loja?.fuso]);

  const geradoEm = impressao?.geradoEm || "";
  const rodape = (conteudo: string) => `content: ${conteudo}; font: 600 7.5pt system-ui, -apple-system, sans-serif; color: ${PALETA.areiaTinta};`;

  return (
    <div ref={raiz} className="fh-relatorio" style={{ padding: "1.5rem 1rem 3rem", maxWidth: 1280, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", color: PALETA.carvao }}>
      {/* Impressão e PDF em A4: some a navegação do painel e os filtros, entra o
          cabeçalho da loja, e toda tabela da moldura se ajusta à folha. */}
      <style>{`
        @page {
          size: A4 ${impressao?.deitado ? "landscape" : "portrait"};
          margin: 12mm 10mm 14mm;
          @bottom-left { ${rodape(JSON.stringify(geradoEm ? `Gerado em ${geradoEm}` : ""))} }
          @bottom-right { ${rodape(`"FireHub · Página " counter(page) " de " counter(pages)`)} }
        }
        .fh-so-impressao { display: none; }
        @media print {
          .fh-sem-impressao, nav, aside, [data-fh-nav] { display: none !important; }
          /* Só o relatório vai para o papel: a barra do topo do painel, os avisos
             e os botões flutuantes saíam em toda folha, por cima da tabela. */
          body *:not(:has(.fh-relatorio)):not(.fh-relatorio):not(.fh-relatorio *) { display: none !important; }
          body *:has(.fh-relatorio) { display: block !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; height: auto !important; overflow: visible !important; }
          .fh-so-impressao { display: block !important; }
          html { font-size: 13px !important; }
          html, body { background: #fff !important; }
          .fh-relatorio { padding: 0 !important; max-width: none !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .fh-relatorio-bloco { break-inside: avoid; box-shadow: none !important; }
          /* Tabela: sem rolagem (o papel corta), na largura da folha, cabeçalho
             em toda folha, linha inteira numa folha só, o total só no fim. */
          .fh-relatorio div:has(> table) { overflow: visible !important; }
          .fh-relatorio table { width: 100% !important; min-width: 0 !important; }
          .fh-relatorio thead { display: table-header-group; }
          .fh-relatorio tfoot { display: table-row-group; }
          .fh-relatorio tr { break-inside: avoid; }
          .fh-relatorio th, .fh-relatorio td { position: static !important; padding-top: 4px !important; padding-bottom: 4px !important; }
          .fh-relatorio thead th { background-color: ${PALETA.areiaBorda} !important; color: ${PALETA.carvao} !important; }
          .fh-relatorio tfoot td, .fh-relatorio tfoot th { background-color: ${PALETA.areia}; font-weight: 800; }
          .fh-relatorio h2 { break-after: avoid; }
        }
      `}</style>

      {/* O cabeçalho do PDF (só no papel). */}
      <div className="fh-so-impressao" style={{ borderBottom: `2px solid ${PALETA.marca}`, paddingBottom: 8, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {loja?.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={loja.logo} alt="" style={{ width: 52, height: 52, objectFit: "contain", borderRadius: 8, flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {loja?.nomeDaLoja && <div style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em" }}>{loja.nomeDaLoja}</div>}
            <div style={{ fontSize: "1.45rem", fontWeight: 900, lineHeight: 1.15 }}>{titulo}</div>
            {textoDoPeriodo && (
              <div style={{ fontSize: "0.85rem", fontWeight: 700, color: PALETA.carvao2, marginTop: 2 }}>
                Período: {textoDoPeriodo}<span style={{ fontWeight: 500, color: PALETA.areiaTinta }}> · o dia vira às 5h</span>
              </div>
            )}
          </div>
          {geradoEm && (
            <div style={{ fontSize: "0.75rem", color: PALETA.areiaTinta, textAlign: "right", flexShrink: 0 }}>
              Gerado em<br /><strong style={{ color: PALETA.carvao2 }}>{geradoEm}</strong>
            </div>
          )}
        </div>
      </div>

      <Link href="/store/relatorios" className="fh-sem-impressao"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 700, color: PALETA.areiaTinta, textDecoration: "none", marginBottom: 10 }}>
        <ArrowLeft size={14} /> Relatórios
      </Link>

      <header className="fh-sem-impressao" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap", marginBottom: "1.1rem" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: "1.55rem", fontWeight: 900, letterSpacing: "-0.01em" }}>{titulo}</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.86rem", color: PALETA.areiaTinta, maxWidth: 720 }}>{descricao}</p>
          {periodo && (
            <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: PALETA.carvao2, fontWeight: 700 }}>
              {textoDoPeriodo}
              <span style={{ fontWeight: 500, color: PALETA.areiaTinta }}> · o dia vira às 5h</span>
            </p>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {onRecarregar && (
              <button type="button" onClick={onRecarregar} className="btn btn-outline" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <RefreshCw size={15} /> Atualizar
              </button>
            )}
            <button type="button" onClick={() => window.print()} className="btn btn-outline" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              title="Abre a impressão do navegador: em Destino, escolha “Salvar como PDF” (ou a impressora)">
              <FileDown size={15} /> Baixar PDF
            </button>
            {!semExportar && (
              <a href={`/api/store/relatorios/${slug}?${query}${query ? "&" : ""}formato=xlsx`} className="btn btn-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
                <Download size={15} /> Exportar Excel
              </a>
            )}
          </div>
          <span style={{ fontSize: "0.72rem", color: PALETA.areiaTinta }}>
            No PDF, em <strong>Destino</strong> escolha <strong>Salvar como PDF</strong>
          </span>
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
