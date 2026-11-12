"use client";
/**
 * A aba "Insumos" do Estoque como tabela de verdade: saldo, custo, valor em
 * estoque (R$ só para dados sensíveis), consumo médio por dia (14 dias de
 * saídas reais), cobertura ("acaba em ~3 dias"), última contagem, classe e
 * curva ABC; filtros por classe e situação, busca e ordenação por coluna.
 * Clicar no nome abre a gaveta do insumo (preço por compra, movimentações,
 * fichas, perdas).
 *
 * Os saldos vêm do EstoqueClient (a lista que ele já carrega); a análise, de
 * /api/store/estoque/analise (lib/estoque/analise-no-banco.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, Trash2, X } from "lucide-react";
import { CLASSES, ROTULO_DA_CLASSE, type Classe } from "@/lib/cmv/controlaveis";
import type { AnaliseDoInsumo, DetalheDoInsumo } from "@/lib/estoque/analise-no-banco";

export type ItemDaTabela = {
  id: string; name: string; quantity: number; unit: string; minQuantity: number | null; unitCost: number | null;
  tipo?: string | null; contagemDiaria?: boolean | null; entraNoCmv?: boolean | null; idealQuantity?: number | null;
};

type Situacao = "todos" | "baixo" | "negativo" | "acabando" | "semCusto" | "semContagem";
type Coluna = "nome" | "saldo" | "custo" | "valor" | "consumo" | "cobertura" | "contagem" | "curva";

const fmtR = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const fmtQ = (q: number, u?: string) => `${q.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}${u ? ` ${u}` : ""}`;
const diaBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const COR_DA_CURVA: Record<string, { cor: string; fundo: string }> = { A: { cor: "#fff", fundo: "#C92E09" }, B: { cor: "#7C2D12", fundo: "#FED7AA" }, C: { cor: "#475569", fundo: "#E2E8F0" } };

export default function TabelaDeInsumos({ items, veValor, versao, onMovimentar, onEditar, onExcluir }: {
  items: ItemDaTabela[]; veValor: boolean; versao: number;
  onMovimentar: (id: string) => void; onEditar: (id: string) => void; onExcluir: (id: string) => void;
}) {
  const [analise, setAnalise] = useState<Map<string, AnaliseDoInsumo>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [classe, setClasse] = useState<Classe | "">("");
  const [situacao, setSituacao] = useState<Situacao>("todos");
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: "nome", desc: false });
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    fetch("/api/store/estoque/analise")
      .then((r) => r.json())
      .then((d) => { if (vivo && Array.isArray(d?.itens)) setAnalise(new Map((d.itens as AnaliseDoInsumo[]).map((i) => [i.id, i]))); })
      .catch(() => {})
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [versao]);

  const linhas = useMemo(() => items.map((it) => {
    const a = analise.get(it.id);
    const custo = veValor ? a?.custoHoje ?? it.unitCost ?? null : null;
    return { it, a, custo, valor: custo != null && it.quantity > 0 ? it.quantity * custo : 0 };
  }), [items, analise, veValor]);

  const contagens = useMemo(() => {
    const c = { baixo: 0, negativo: 0, acabando: 0, semCusto: 0, semContagem: 0 };
    for (const l of linhas) {
      if (l.it.quantity < 0) c.negativo++;
      else if (l.it.minQuantity != null && l.it.quantity <= l.it.minQuantity) c.baixo++;
      if (l.a && (l.a.nivel === "critico" || l.a.nivel === "acabou")) c.acabando++;
      if (l.a?.semCusto) c.semCusto++;
      if (l.a && l.a.ultimaContagem == null) c.semContagem++;
    }
    return c;
  }, [linhas]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtradas = linhas.filter(({ it, a }) => {
      if (termo && !it.name.toLowerCase().includes(termo)) return false;
      if (classe && a?.classe !== classe) return false;
      switch (situacao) {
        case "baixo": return it.quantity >= 0 && it.minQuantity != null && it.quantity <= it.minQuantity;
        case "negativo": return it.quantity < 0;
        case "acabando": return a?.nivel === "critico" || a?.nivel === "acabou";
        case "semCusto": return Boolean(a?.semCusto);
        case "semContagem": return a?.ultimaContagem == null;
        default: return true;
      }
    });
    const chave = (l: (typeof linhas)[number]): string | number => {
      switch (ordem.col) {
        case "nome": return l.it.name.toLowerCase();
        case "saldo": return l.it.quantity;
        case "custo": return l.custo ?? -1;
        case "valor": return l.valor;
        case "consumo": return l.a?.consumoDia ?? -1;
        case "cobertura": return l.a?.cobertura ?? 1e9;
        case "contagem": return l.a?.ultimaContagem ?? "";
        case "curva": return l.a?.curva ?? "Z";
      }
    };
    return filtradas.sort((x, y) => {
      const a = chave(x), b = chave(y);
      const r = typeof a === "string" ? a.localeCompare(String(b), "pt-BR") : a - (b as number);
      return ordem.desc ? -r : r;
    });
  }, [linhas, busca, classe, situacao, ordem]);

  const th = (col: Coluna, rotulo: string, direita = false) => (
    <th style={{ textAlign: direita ? "right" : "left", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}
      onClick={() => setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : col !== "nome" && col !== "cobertura" && col !== "curva" }))}>
      {rotulo}{ordem.col === col ? (ordem.desc ? " ↓" : " ↑") : ""}
    </th>
  );

  const chips: { id: Situacao; rotulo: string; n?: number }[] = [
    { id: "todos", rotulo: "Todos", n: items.length },
    { id: "acabando", rotulo: "Acabando (< 2 dias)", n: contagens.acabando },
    { id: "baixo", rotulo: "Abaixo do mínimo", n: contagens.baixo },
    { id: "negativo", rotulo: "Negativo", n: contagens.negativo },
    { id: "semCusto", rotulo: "Sem custo", n: contagens.semCusto },
    { id: "semContagem", rotulo: "Nunca contado", n: contagens.semContagem },
  ];

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
        <div className="search-bar" style={{ flex: "1 1 260px", margin: 0 }}>
          <Search size={18} className="search-icon" />
          <input type="text" placeholder="Pesquisar insumo (ex: Queijo, Carne moída)..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <select value={classe} onChange={(e) => setClasse(e.target.value as Classe | "")} aria-label="Filtrar por classe"
          style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid #E7DDD3", background: "#fff", fontWeight: 700, fontSize: "0.85rem" }}>
          <option value="">Todas as classes</option>
          {CLASSES.map((c) => <option key={c} value={c}>{ROTULO_DA_CLASSE[c]}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "0.75rem" }}>
        {chips.map((c) => (
          <button key={c.id} type="button" onClick={() => setSituacao(c.id)}
            style={{ fontSize: "0.78rem", fontWeight: 700, padding: "6px 11px", borderRadius: 999, border: "1px solid #E7DDD3", cursor: "pointer", background: situacao === c.id ? "#1C1917" : "#FAF6F2", color: situacao === c.id ? "#fff" : "#1C1917" }}>
            {c.rotulo}{c.n != null ? ` · ${c.n}` : ""}
          </button>
        ))}
        {carregando && <span style={{ fontSize: "0.78rem", color: "#94A3B8", alignSelf: "center" }}>calculando consumo...</span>}
      </div>

      {visiveis.length === 0 ? (
        <div className="empty-state"><h3>Nenhum insumo nesse filtro</h3><p>Troque o filtro ou cadastre um novo insumo no topo da página.</p></div>
      ) : (
        <div className="items-table-wrapper">
          <table className="items-table" style={{ fontSize: "0.86rem" }}>
            <thead>
              <tr>
                {th("nome", "Insumo")}
                <th>Classe</th>
                {th("saldo", "Saldo", true)}
                {veValor && th("custo", "Custo", true)}
                {veValor && th("valor", "Valor em estoque", true)}
                {th("consumo", "Consumo/dia", true)}
                {th("cobertura", "Cobertura", true)}
                {th("contagem", "Última contagem")}
                {th("curva", "ABC")}
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(({ it, a, custo, valor }) => {
                const negativo = it.quantity < 0;
                const baixo = !negativo && it.minQuantity != null && it.quantity <= it.minQuantity;
                const corCob = a?.nivel === "acabou" || a?.nivel === "critico" ? "#B91C1C" : a?.nivel === "atencao" ? "#B45309" : "#334155";
                return (
                  <tr key={it.id} className={`${negativo ? "negative-stock-tr" : ""} ${baixo ? "low-stock-tr" : ""}`}>
                    <td className="name-col">
                      <button type="button" onClick={() => setAberto(it.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 800, color: "#1C1917", textAlign: "left", textDecoration: "underline", textDecorationColor: "#E7DDD3", textUnderlineOffset: 3 }}>
                        {it.name}
                      </button>
                      {String(it.tipo || "").toUpperCase() === "PREPARO" && <span className="badge badge-nfe" style={{ marginLeft: 6 }}>Preparo</span>}
                      {it.contagemDiaria && <span className="badge badge-success" style={{ marginLeft: 6 }}>Conta todo dia</span>}
                      {it.entraNoCmv === false && <span className="badge" style={{ marginLeft: 6 }}>Fora do CMV</span>}
                      {(negativo || baixo) && (
                        <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: negativo ? "#B91C1C" : "#B45309" }}>
                          <AlertTriangle size={11} /> {negativo ? "Saldo negativo" : `Abaixo do mínimo (${fmtQ(it.minQuantity ?? 0, it.unit)})`}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.78rem", color: "#475569", whiteSpace: "nowrap" }}>{a ? `${ROTULO_DA_CLASSE[a.classe]}${a.classePalpite ? "*" : ""}` : "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{fmtQ(it.quantity, it.unit)}</td>
                    {veValor && <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{custo != null ? fmtR(custo) : <span style={{ color: "#B45309", fontWeight: 700 }}>sem custo</span>}</td>}
                    {veValor && <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{valor > 0 ? fmtR(valor) : "—"}</td>}
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }} title={a?.fonteDoConsumo === "contagem" ? "Uso livre (sem ficha): pelo consumo entre as duas últimas contagens completas" : undefined}>
                      {a && a.consumoDia > 0 ? fmtQ(a.consumoDia, it.unit) : "—"}
                      {a?.fonteDoConsumo === "contagem" && <span style={{ display: "block", fontSize: "0.68rem", color: "#94A3B8" }}>pela contagem</span>}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 800, color: corCob }}>
                      {!a ? "—" : a.nivel === "acabou" ? "acabou" : a.cobertura == null ? <span style={{ color: "#94A3B8", fontWeight: 500 }}>sem consumo</span> : `~${a.cobertura.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dia(s)`}
                    </td>
                    <td style={{ whiteSpace: "nowrap", color: a?.diasSemContar != null && a.diasSemContar > 7 ? "#B45309" : "#334155" }}>
                      {a?.ultimaContagem ? `${diaBr(a.ultimaContagem)} · há ${a.diasSemContar} d` : <span style={{ color: "#94A3B8" }}>nunca</span>}
                    </td>
                    <td>{a && <span title="Curva ABC pelo valor consumido em 14 dias" style={{ display: "inline-block", minWidth: 22, textAlign: "center", fontWeight: 900, fontSize: "0.75rem", borderRadius: 6, padding: "2px 6px", color: COR_DA_CURVA[a.curva].cor, background: COR_DA_CURVA[a.curva].fundo }}>{a.curva}</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      <div className="action-buttons">
                        <button className="btn-action btn-move" onClick={() => onMovimentar(it.id)}>Movimentar</button>
                        <button className="btn-action btn-move" onClick={() => onEditar(it.id)}>Editar</button>
                        <button className="btn-action btn-delete" onClick={() => onExcluir(it.id)} aria-label={`Excluir ${it.name}`}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: "0.74rem", color: "#94A3B8", margin: "0.5rem 0 0" }}>
        Consumo/dia = vendas pela ficha + perdas + saídas dos últimos 14 dias (uso livre, sem ficha: pelas duas últimas contagens completas). Cobertura = saldo ÷ consumo/dia (vermelho abaixo de 2 dias).
        ABC = A soma 80% do dinheiro consumido. Classe com * é o palpite pelo nome (corrija na aba Controláveis).
      </p>

      {aberto && <GavetaDoInsumo id={aberto} veValor={veValor} onFechar={() => setAberto(null)} />}
    </>
  );
}

function GavetaDoInsumo({ id, veValor, onFechar }: { id: string; veValor: boolean; onFechar: () => void }) {
  const [d, setD] = useState<DetalheDoInsumo | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let vivo = true;
    setD(null);
    fetch(`/api/store/estoque/analise?insumo=${encodeURIComponent(id)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || "Não deu para carregar."); return j.detalhe; })
      .then((x) => vivo && setD(x))
      .catch((e) => vivo && setErro(e?.message));
    return () => { vivo = false; };
  }, [id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  const ROTULO: Record<string, string> = { INPUT: "Entrada", SALE: "Venda", WASTE: "Perda", OUTPUT: "Saída", AJUSTE: "Contagem", ESTORNO: "Compra desfeita" };
  const precos = d?.precos;
  return (
    <div onClick={onFechar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.35)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <aside onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Detalhe do insumo"
        style={{ width: "min(560px, 100vw)", height: "100%", background: "#fff", overflowY: "auto", boxShadow: "-12px 0 30px rgba(15,23,42,.2)", padding: "18px 18px 40px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase" }}>Insumo</div>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 900 }}>{d?.nome || "..."}</h2>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={22} /></button>
        </div>
        {erro && <p style={{ color: "#B91C1C" }}>{erro}</p>}
        {!d && !erro && <p style={{ color: "#94A3B8" }}>Carregando...</p>}
        {d && (
          <div style={{ display: "grid", gap: "1rem", marginTop: "0.75rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              <Mini rotulo="Saldo" valor={fmtQ(d.saldo, d.unidade)} cor={d.saldo < 0 ? "#B91C1C" : undefined} />
              <Mini rotulo="Mínimo" valor={d.minimo != null ? fmtQ(d.minimo, d.unidade) : "—"} />
              <Mini rotulo={`Perdas ${d.perdas.dias} dias`} valor={d.perdas.lancamentos ? `${fmtQ(d.perdas.quantidade, d.unidade)}${d.perdas.valor != null ? ` · ${fmtR(d.perdas.valor)}` : ""}` : "nenhuma"} cor={d.perdas.lancamentos ? "#C92E09" : undefined} />
            </div>

            {veValor && precos && (
              <section>
                <h3 style={h3}>💲 Preço por compra</h3>
                {precos.compras.length === 0 ? <p style={vazio}>Nenhuma compra lançada com custo.</p> : (
                  <>
                    {precos.ultimaVariacao != null && (
                      <p style={{ margin: "0 0 6px", fontWeight: 800, color: precos.ultimaVariacao > 0 ? "#B91C1C" : precos.ultimaVariacao < 0 ? "#047857" : "#334155" }}>
                        {precos.ultimaVariacao > 0 ? "▲ Subiu" : precos.ultimaVariacao < 0 ? "▼ Caiu" : "= Igual"} {Math.abs(precos.ultimaVariacao).toLocaleString("pt-BR")}% desde a compra anterior
                        {precos.variacaoNoPeriodo != null && precos.compras.length > 2 && <span style={{ fontWeight: 600, color: "#64748B" }}> · {precos.variacaoNoPeriodo > 0 ? "+" : ""}{precos.variacaoNoPeriodo.toLocaleString("pt-BR")}% desde {diaBr(precos.compras[0].dia)}</span>}
                      </p>
                    )}
                    <LinhaDoPreco pontos={precos.compras.map((c) => c.custo)} />
                    <table style={tabela}>
                      <thead><tr><th style={thL}>Dia</th><th style={thL}>Fornecedor</th><th style={thR}>Qtde</th><th style={thR}>Custo</th><th style={thR}>Variação</th></tr></thead>
                      <tbody>
                        {[...precos.compras].reverse().map((c, i) => (
                          <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
                            <td style={td}>{diaBr(c.dia)}</td><td style={td}>{c.fornecedor || "—"}</td>
                            <td style={tdR}>{fmtQ(c.quantidade, d.unidade)}</td><td style={tdR}>{fmtR(c.custo)}</td>
                            <td style={{ ...tdR, fontWeight: 700, color: (c.variacaoPct ?? 0) > 0 ? "#B91C1C" : (c.variacaoPct ?? 0) < 0 ? "#047857" : "#94A3B8" }}>{c.variacaoPct == null ? "—" : `${c.variacaoPct > 0 ? "+" : ""}${c.variacaoPct.toLocaleString("pt-BR")}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </section>
            )}

            <section>
              <h3 style={h3}>🧾 Entra nas fichas</h3>
              {d.fichas.length === 0 && d.preparos.length === 0 ? <p style={vazio}>Não está em nenhuma ficha técnica (uso livre).</p> : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.86rem", lineHeight: 1.6 }}>
                  {d.fichas.map((f, i) => <li key={i}>{f.produto} — {fmtQ(f.quantidade, d.unidade)} por unidade</li>)}
                  {d.preparos.map((p, i) => <li key={`p${i}`}>Preparo {p.preparo} — {fmtQ(p.quantidade, d.unidade)} por lote</li>)}
                </ul>
              )}
            </section>

            <section>
              <h3 style={h3}>🔁 Movimentações recentes</h3>
              {d.movimentos.length === 0 ? <p style={vazio}>Nenhuma movimentação.</p> : (
                <table style={tabela}>
                  <thead><tr><th style={thL}>Quando</th><th style={thL}>Tipo</th><th style={thR}>Qtde</th><th style={thL}>Nota</th></tr></thead>
                  <tbody>
                    {d.movimentos.map((m, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{new Date(m.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                        <td style={td}>{ROTULO[m.tipo] || m.tipo}</td>
                        <td style={{ ...tdR, fontWeight: 700, color: m.quantidade < 0 ? "#B91C1C" : "#047857" }}>{m.quantidade > 0 ? "+" : ""}{fmtQ(m.quantidade)}</td>
                        <td style={{ ...td, color: "#64748B", fontSize: "0.76rem" }}>{(m.nota || "").slice(0, 70)}{m.quem ? ` · ${m.quem}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

const h3: React.CSSProperties = { fontSize: "0.92rem", fontWeight: 800, margin: "0 0 0.4rem" };
const vazio: React.CSSProperties = { fontSize: "0.85rem", color: "#94A3B8", margin: 0 };
const tabela: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" };
const thL: React.CSSProperties = { textAlign: "left", color: "#64748B", fontWeight: 700, padding: "4px" };
const thR: React.CSSProperties = { ...thL, textAlign: "right" };
const td: React.CSSProperties = { padding: "4px", verticalAlign: "top" };
const tdR: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

function Mini({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div style={{ background: "#FAF6F2", borderRadius: 10, padding: "8px 10px" }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase" }}>{rotulo}</div>
      <div style={{ fontWeight: 900, color: cor || "#1C1917", fontSize: "0.92rem" }}>{valor}</div>
    </div>
  );
}

/** A linha do preço nas compras (SVG, sem biblioteca). */
function LinhaDoPreco({ pontos }: { pontos: number[] }) {
  if (pontos.length < 2) return null;
  const L = 500, A = 80, min = Math.min(...pontos), max = Math.max(...pontos), faixa = max - min || 1;
  const xy = pontos.map((p, i) => [8 + (i / (pontos.length - 1)) * (L - 16), A - 10 - ((p - min) / faixa) * (A - 20)]);
  return (
    <svg viewBox={`0 0 ${L} ${A}`} width="100%" height={A} role="img" aria-label="Preço nas últimas compras" style={{ display: "block", marginBottom: 6 }}>
      <polyline points={xy.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="#C92E09" strokeWidth={2.5} strokeLinejoin="round" />
      {xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3.5} fill="#C92E09" />)}
    </svg>
  );
}
