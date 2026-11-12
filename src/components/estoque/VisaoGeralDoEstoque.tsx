"use client";
/**
 * A aba "Visão geral" do Estoque (a primeira): o que importa hoje num olhar —
 * valor em estoque, CMV real e perdas da última semana do CMV (R$ só para
 * dados sensíveis), abaixo do mínimo, lotes vencendo, as 8 semanas, onde está
 * o dinheiro e a lista "O que fazer hoje", cada item levando ao lugar certo.
 *
 * Dados de /api/store/estoque/visao-geral (lib/estoque/analise-no-banco.ts).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, ClipboardList, Package, ShoppingCart, Timer, TrendingDown } from "lucide-react";
import type { AcaoDoDia, VisaoGeral } from "@/lib/estoque/analise-no-banco";

type Aba = NonNullable<AcaoDoDia["aba"]>;

const fmtR = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v));
const fmtP = (v: number | null | undefined, casas = 1) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const fmtQ = (q: number) => q.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

const ICONE_DA_ACAO: Record<AcaoDoDia["tipo"], string> = {
  comprar: "🛒", contar: "📋", lote: "⏰", semFicha: "🧾", semCusto: "💲", diferenca: "🔎",
};
const COR_DA_ZONA: Record<string, string> = { verde: "#059669", amarelo: "#D97706", vermelho: "#DC2626", sem: "#64748B" };

export default function VisaoGeralDoEstoque({ onAbrirAba }: { onAbrirAba: (aba: Aba) => void }) {
  const [dados, setDados] = useState<VisaoGeral | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/api/store/estoque/visao-geral")
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d?.error || "Não deu para carregar."); return d; })
      .then((d) => vivo && setDados(d))
      .catch((e) => vivo && setErro(e?.message || "Não deu para carregar."));
    return () => { vivo = false; };
  }, []);

  if (erro) return <div className="empty-state"><h3>{erro}</h3></div>;
  if (!dados) return <div className="empty-state"><div className="spinner" /><p>Montando a visão geral...</p></div>;

  const v = dados;
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {/* Números do topo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem" }}>
        {v.veValor && <Numero icone={<Package size={18} />} rotulo="Valor em estoque" valor={fmtR(v.valorEmEstoque)} detalhe={`${v.insumos.total} insumos · custo de hoje`} />}
        {v.veValor && v.cmv && (
          <Numero icone={<TrendingDown size={18} />} rotulo="CMV real" valor={fmtP(v.cmv.pct)} cor={COR_DA_ZONA[v.cmv.zona] || undefined}
            detalhe={v.cmv.pct == null ? `falta contagem (${diaMes(v.semana.de)} a ${diaMes(v.semana.ate)})` : `${diaMes(v.cmv.de)} a ${diaMes(v.cmv.ate)} · meta ${fmtP(v.cmv.meta, 0)}`} />
        )}
        {v.veValor && v.perdas && (
          <Numero icone={<AlertTriangle size={18} />} rotulo="Perdas (controláveis)" valor={fmtP(v.perdas.pct, 2)} cor="#C92E09"
            detalhe={`${fmtR(v.perdas.valor)} da venda · ${diaMes(v.semana.de)} a ${diaMes(v.semana.ate)}`} onClick={() => onAbrirAba("controlaveis")} />
        )}
        <Numero icone={<ShoppingCart size={18} />} rotulo="Abaixo do mínimo" valor={String(v.insumos.abaixoDoMinimo.length)}
          cor={v.insumos.abaixoDoMinimo.length ? "#D97706" : undefined} detalhe={v.insumos.negativos ? `${v.insumos.negativos} com saldo negativo` : "nenhum negativo"} onClick={() => onAbrirAba("items")} />
        <Numero icone={<Timer size={18} />} rotulo="Lotes vencendo (3 dias)" valor={String(v.lotes.vencendo.length)}
          cor={v.lotes.vencendo.length ? "#DC2626" : undefined} detalhe={v.lotes.vencidos ? `${v.lotes.vencidos} já vencido(s)` : "nenhum vencido"} onClick={() => onAbrirAba("lotes")} />
        <Numero icone={<ClipboardList size={18} />} rotulo="Fichas técnicas" valor={v.insumos.fichasPct == null ? "—" : `${v.insumos.fichasPct}%`}
          detalhe="dos produtos têm ficha" onClick={() => onAbrirAba("recipes")} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: "1rem", alignItems: "start" }}>
        {/* O que fazer hoje */}
        <div style={caixa}>
          <h3 style={titulo}>✅ O que fazer hoje</h3>
          {v.acoes.length === 0 ? (
            <p style={{ fontSize: "0.88rem", color: "#059669", fontWeight: 700 }}>Tudo em dia. Nada urgente no estoque.</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {v.acoes.map((a, i) => {
                const conteudo = (
                  <>
                    <span style={{ fontSize: "1.1rem" }}>{ICONE_DA_ACAO[a.tipo]}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 800, fontSize: "0.88rem", color: "#1C1917" }}>{a.texto}</span>
                      {a.detalhe && <span style={{ display: "block", fontSize: "0.76rem", color: a.urgente ? "#B91C1C" : "#64748B", fontWeight: a.urgente ? 700 : 500 }}>{a.detalhe}</span>}
                    </span>
                    <ChevronRight size={16} color="#94A3B8" />
                  </>
                );
                const estilo: React.CSSProperties = {
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, textAlign: "left", width: "100%",
                  border: `1px solid ${a.urgente ? "#FECACA" : "#E7DDD3"}`, background: a.urgente ? "#FEF2F2" : "#FAF6F2", cursor: "pointer", textDecoration: "none",
                };
                return a.href
                  ? <Link key={i} href={a.href} style={estilo}>{conteudo}</Link>
                  : <button key={i} type="button" style={estilo} onClick={() => a.aba && onAbrirAba(a.aba)}>{conteudo}</button>;
              })}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: "1rem" }}>
          {/* Onde está o dinheiro */}
          {v.veValor && (
            <div style={caixa}>
              <h3 style={titulo}>💸 Onde está o dinheiro <small style={{ fontWeight: 600, color: "#94A3B8" }}>· semana {diaMes(v.semana.de)} a {diaMes(v.semana.ate)}</small></h3>
              {v.ondeEstaODinheiro.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "#94A3B8" }}>Sem perdas na semana (ou falta contagem).</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {v.ondeEstaODinheiro.map((i, n) => (
                    <button key={n} type="button" onClick={() => onAbrirAba("controlaveis")} style={{ display: "block", textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.84rem", gap: 8 }}>
                        <span style={{ fontWeight: 700 }}>{n + 1}. {i.nome} <span style={{ color: "#94A3B8", fontWeight: 500 }}>· {i.rotulo}</span></span>
                        <strong>{fmtR(i.valor)}</strong>
                      </div>
                      <div style={{ height: 6, background: "#F1F5F9", borderRadius: 99, marginTop: 3 }}>
                        <div style={{ width: `${Math.max(3, (i.valor / (v.ondeEstaODinheiro[0].valor || 1)) * 100)}%`, height: "100%", background: "#C92E09", borderRadius: 99 }} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Abaixo do mínimo e vencendo */}
          <div style={caixa}>
            <h3 style={titulo}>📉 Abaixo do mínimo</h3>
            {v.insumos.abaixoDoMinimo.length === 0 ? <p style={{ fontSize: "0.85rem", color: "#94A3B8" }}>Nenhum insumo abaixo do mínimo.</p> : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4, fontSize: "0.85rem" }}>
                {v.insumos.abaixoDoMinimo.map((i) => (
                  <li key={i.nome} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{i.nome}</span>
                    <strong style={{ color: i.saldo <= 0 ? "#B91C1C" : "#B45309", whiteSpace: "nowrap" }}>{fmtQ(i.saldo)} / mín. {fmtQ(i.minimo)} {i.unidade}</strong>
                  </li>
                ))}
              </ul>
            )}
            {v.lotes.vencendo.length > 0 && (
              <>
                <h3 style={{ ...titulo, marginTop: "0.9rem" }}>⏰ Vencendo em até 3 dias</h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4, fontSize: "0.85rem" }}>
                  {v.lotes.vencendo.map((l, i) => (
                    <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{l.nome}</span>
                      <strong style={{ color: "#B91C1C", whiteSpace: "nowrap" }}>{fmtQ(l.quantidade)} {l.unidade} · {new Date(l.validoAte).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      {/* As 8 semanas */}
      {v.veValor && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: "1rem" }}>
          <Grafico titulo="🗑️ Perdas lançadas por semana" serie={v.semanas.map((s) => ({ rotulo: diaMes(s.de), valor: s.perdas }))} cor="#C92E09" vazio="Nenhuma perda lançada nas últimas 8 semanas." />
          <Grafico titulo="📦 Valor do estoque na contagem" serie={v.semanas.map((s) => ({ rotulo: diaMes(s.de), valor: s.estoque }))} cor="#2563EB" vazio="Sem contagem fechada nas últimas 8 semanas." />
        </div>
      )}
    </div>
  );
}

const caixa: React.CSSProperties = { background: "#fff", border: "1px solid #E7DDD3", borderRadius: 14, padding: "14px 16px", minWidth: 0 };
const titulo: React.CSSProperties = { fontSize: "0.95rem", fontWeight: 800, margin: "0 0 0.6rem" };

function Numero({ icone, rotulo, valor, detalhe, cor, onClick }: { icone: React.ReactNode; rotulo: string; valor: string; detalhe?: string; cor?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      style={{ textAlign: "left", background: "#fff", border: "1px solid #E7DDD3", borderRadius: 12, padding: "12px 14px", cursor: onClick ? "pointer" : "default", color: "#1C1917" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase" }}>{icone} {rotulo}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 900, color: cor || "#1C1917", marginTop: 2 }}>{valor}</div>
      {detalhe && <div style={{ fontSize: "0.76rem", color: "#64748B" }}>{detalhe}</div>}
    </button>
  );
}

/** Barras em SVG, sem biblioteca: 8 semanas, a atual por último. */
function Grafico({ titulo: t, serie, cor, vazio }: { titulo: string; serie: { rotulo: string; valor: number | null }[]; cor: string; vazio: string }) {
  const max = Math.max(0, ...serie.map((s) => s.valor ?? 0));
  const L = 560, A = 170, base = 140, larg = L / serie.length;
  return (
    <div style={caixa}>
      <h3 style={titulo}>{t}</h3>
      {max <= 0 ? <p style={{ fontSize: "0.85rem", color: "#94A3B8" }}>{vazio}</p> : (
        <svg viewBox={`0 0 ${L} ${A}`} width="100%" role="img" aria-label={t} style={{ display: "block" }}>
          <line x1={0} x2={L} y1={base} y2={base} stroke="#E7DDD3" />
          {serie.map((s, i) => {
            const h = s.valor ? Math.max(2, (s.valor / max) * 110) : 0;
            const x = i * larg + larg * 0.18;
            const w = larg * 0.64;
            const atual = i === serie.length - 1;
            return (
              <g key={i}>
                {s.valor != null && s.valor > 0 && <rect x={x} y={base - h} width={w} height={h} rx={4} fill={cor} opacity={atual ? 0.45 : 0.9} />}
                {s.valor != null && s.valor > 0 && (
                  <text x={x + w / 2} y={base - h - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">
                    {s.valor >= 1000 ? `${(s.valor / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : Math.round(s.valor).toLocaleString("pt-BR")}
                  </text>
                )}
                <text x={x + w / 2} y={base + 16} textAnchor="middle" fontSize="11" fill="#64748B">{s.rotulo}{atual ? "*" : ""}</text>
              </g>
            );
          })}
          <text x={L} y={A - 2} textAnchor="end" fontSize="10" fill="#94A3B8">semanas do CMV · * em andamento · R$</text>
        </svg>
      )}
    </div>
  );
}
