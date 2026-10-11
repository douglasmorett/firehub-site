"use client";
/**
 * COMPRAS — a compra lançada UMA vez entra no estoque, no CMV e nas contas a
 * pagar (lib/cmv/lancar-compra.ts).
 *
 *   - Com nota: foto na aba "Entrada com IA" do Estoque.
 *   - Sem nota (mercado, feira, açougue): o formulário daqui.
 *   - Lançou errado: "Desfazer" estorna o estoque e apaga as contas não pagas.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, ChevronDown, ChevronUp, Plus, Undo2, X } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtQtd, fmtReais, somarDias } from "@/lib/relatorios/base";
import { lerNumeroBr } from "@/lib/cmv/numero";
import PagamentoDaCompra, { pagamentoInicial, pagamentoParaApi, type EstadoDoPagamento } from "@/components/cmv/PagamentoDaCompra";

type Compra = {
  id: string; dia: string; origem: string; fornecedor: string | null; numero: string | null; valor: number | null; valorNoEstoque: number | null;
  imagem: string | null; cancelada: boolean; antiga: boolean;
  contas: { quantidade: number; pago: number; aPagar: number; proximoVencimento: string | null };
  itens: { nome: string; unidade: string; quantidade: number; valor: number | null }[];
};
type Insumo = { id: string; name: string; unit: string };
type Linha = { stockItemId: string; newItemName: string; newItemUnit: string; quantidade: string; unidade: string; valorTotal: string };

const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const linhaVazia = (): Linha => ({ stockItemId: "", newItemName: "", newItemUnit: "un", quantidade: "", unidade: "", valorTotal: "" });
const UNIDADES = ["un", "g", "kg", "ml", "l"];

export default function ComprasClient() {
  const [dados, setDados] = useState<{ de: string; ate: string; hoje: string; compras: Compra[]; total: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/store/estoque/compras", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErro(j.error); return; }
    setDados(j);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const desfazer = async (id: string) => {
    setErro(null);
    const r = await fetch(`/api/store/estoque/compras?id=${id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    setDesfazendo(null);
    if (!r.ok) { setErro(j.error); return; }
    setMsg(`Compra desfeita: ${j.estornos} item(ns) saíram do estoque${j.contasApagadas ? `, ${j.contasApagadas} conta(s) a pagar apagada(s)` : ""}${j.contasPagasMantidas ? `. ${j.contasPagasMantidas} conta já paga ficou no Financeiro` : ""}.`);
    carregar();
  };

  return (
    <div style={{ padding: "1.25rem 1rem 4rem", maxWidth: 980, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", color: PALETA.carvao }}>
      <Link href="/store/estoque" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 700, color: PALETA.areiaTinta, textDecoration: "none", marginBottom: 10 }}>
        <ArrowLeft size={14} /> Estoque
      </Link>
      <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 900 }}>Compras</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.86rem", color: PALETA.areiaTinta, maxWidth: 640 }}>
            Toda compra de insumo e embalagem entra aqui, uma vez só: vai para o estoque, para o CMV e para as contas a pagar. Não lance a mesma compra de novo em Contas a Pagar nem em Despesas.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/store/estoque?aba=nfe" className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}><Camera size={15} /> Nota com foto</Link>
          {!novo && <button type="button" className="btn btn-outline" onClick={() => { setNovo(true); setMsg(null); }} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={15} /> Compra sem nota</button>}
        </div>
      </header>

      {erro && <Faixa cor="grave">{erro}</Faixa>}
      {msg && <Faixa cor="ok">{msg}</Faixa>}

      {novo && dados && <CompraSemNota hoje={dados.hoje} onCancelar={() => setNovo(false)} onLancada={(t) => { setNovo(false); setMsg(t); carregar(); }} />}

      <section style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "0.8rem 1rem", background: PALETA.areia, borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
          <strong>Últimos 30 dias</strong>
          {dados && <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtReais(dados.total)} no estoque</span>}
        </div>
        {!dados ? <p style={{ padding: "1rem", color: PALETA.areiaTinta }}>Carregando…</p> : dados.compras.length === 0 ? (
          <p style={{ padding: "1.5rem 1rem", color: PALETA.areiaTinta, textAlign: "center" }}>Nenhuma compra lançada nos últimos 30 dias.</p>
        ) : dados.compras.map((c) => (
          <div key={c.id} style={{ borderBottom: `1px solid ${PALETA.areia}`, opacity: c.cancelada ? 0.5 : 1 }}>
            <button type="button" onClick={() => setAberta(aberta === c.id ? null : c.id)} aria-expanded={aberta === c.id}
              style={{ width: "100%", display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 10, alignItems: "center", padding: "0.7rem 1rem", border: "none", background: "none", textAlign: "left", cursor: "pointer" }}>
              <span style={{ fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{ddmm(c.dia)}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 800, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.fornecedor || (c.origem === "SEM_NOTA" ? "Compra sem nota" : "Fornecedor não lido")}{c.numero ? ` · NF ${c.numero}` : ""}
                </span>
                <span style={{ fontSize: "0.76rem", color: PALETA.areiaTinta }}>
                  {c.cancelada ? "desfeita" : c.antiga ? "lançada antes das contas a pagar" : c.contas.quantidade === 0 ? "sem conta a pagar" : c.contas.aPagar > 0 ? `${fmtReais(c.contas.aPagar)} a pagar${c.contas.proximoVencimento ? ` · vence ${ddmm(c.contas.proximoVencimento)}` : ""}` : "paga"}
                  {" · "}{c.origem === "SEM_NOTA" ? "sem nota" : "nota com foto"}
                </span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {fmtReais(c.valor ?? c.valorNoEstoque)} {aberta === c.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </span>
            </button>
            {aberta === c.id && (
              <div style={{ padding: "0 1rem 0.9rem 4.6rem" }}>
                {c.itens.length === 0 ? <p style={{ fontSize: "0.82rem", color: PALETA.areiaTinta, margin: 0 }}>Sem itens com valor gravado (compra antiga).</p> : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                    <tbody>
                      {c.itens.map((i, k) => (
                        <tr key={k}>
                          <td style={{ padding: "0.25rem 0" }}>{i.nome}</td>
                          <td style={{ textAlign: "right", color: PALETA.areiaTinta }}>{fmtQtd(i.quantidade)} {i.unidade}</td>
                          <td style={{ textAlign: "right", width: 110, fontVariantNumeric: "tabular-nums" }}>{i.valor != null ? fmtReais(i.valor) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {c.valor != null && c.valorNoEstoque != null && Math.abs(c.valor - c.valorNoEstoque) > 0.05 && (
                  <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, margin: "0.4rem 0 0" }}>{fmtReais(c.valor - c.valorNoEstoque)} da nota não foi para o estoque (itens marcados como "não é insumo").</p>
                )}
                {!c.cancelada && !c.antiga && (
                  desfazendo === c.id ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: "0.6rem", fontSize: "0.84rem", fontWeight: 700 }}>
                      Desfazer? Os itens saem do estoque e as contas não pagas são apagadas.
                      <button type="button" onClick={() => desfazer(c.id)} style={{ border: "none", background: PALETA.grave, color: "#fff", borderRadius: 8, padding: "0.35rem 0.7rem", fontWeight: 800, cursor: "pointer" }}>Desfazer compra</button>
                      <button type="button" className="btn btn-outline" onClick={() => setDesfazendo(null)}>Voltar</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setDesfazendo(c.id)} style={{ marginTop: "0.6rem", border: "none", background: "none", color: PALETA.areiaTinta, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: 0 }}>
                      <Undo2 size={14} /> Lancei errado, desfazer
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function CompraSemNota({ hoje, onCancelar, onLancada }: { hoje: string; onCancelar: () => void; onLancada: (msg: string) => void }) {
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [dia, setDia] = useState(hoje);
  const [fornecedor, setFornecedor] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([linhaVazia()]);
  const [pagamento, setPagamento] = useState<EstadoDoPagamento>(pagamentoInicial());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    fetch("/api/store/estoque/items", { cache: "no-store" }).then((r) => r.json()).then((j) => setInsumos(j.items || [])).catch(() => {});
  }, []);

  const total = useMemo(() => Math.round(linhas.reduce((s, l) => s + (lerNumeroBr(l.valorTotal) || 0), 0) * 100) / 100, [linhas]);
  const muda = (i: number, campo: keyof Linha, v: string) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));

  const lancar = async () => {
    setErro(null);
    const itens = linhas.filter((l) => l.stockItemId || l.quantidade || l.valorTotal);
    if (!itens.length) { setErro("Adicione pelo menos um item."); return; }
    for (const l of itens) {
      if (!l.stockItemId) { setErro("Escolha o insumo de cada linha (ou \"novo insumo\")."); return; }
      if (l.stockItemId === "NEW" && !l.newItemName.trim()) { setErro("Dê nome ao insumo novo."); return; }
      if (!(lerNumeroBr(l.quantidade) > 0)) { setErro("Há uma linha sem quantidade."); return; }
      if (!(lerNumeroBr(l.valorTotal) > 0)) { setErro("Há uma linha sem valor."); return; }
    }
    setSalvando(true);
    try {
      const r = await fetch("/api/store/estoque/compras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dia, fornecedor,
          itens: itens.map((l) => {
            const insumo = insumos.find((x) => x.id === l.stockItemId);
            return { stockItemId: l.stockItemId, newItemName: l.newItemName, newItemUnit: l.newItemUnit, quantidade: l.quantidade, unidade: l.unidade || insumo?.unit || l.newItemUnit, valorTotal: l.valorTotal };
          }),
          pagamento: pagamentoParaApi(pagamento),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      onLancada(`Compra lançada: ${j.entradas} item(ns) no estoque, ${fmtReais(j.valorNoEstoque)}${j.contas ? `, ${j.contas} conta(s) em Contas a Pagar` : ""}.`);
    } catch (e: any) { setErro(e.message); } finally { setSalvando(false); }
  };

  const entrada: React.CSSProperties = { border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.45rem 0.55rem", fontSize: "0.9rem", minWidth: 0 };
  return (
    <section style={{ background: "#fff", border: `1.5px solid ${PALETA.marca}`, borderRadius: 16, padding: "1rem", marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.7rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 900 }}>Compra sem nota</h2>
        <button type="button" aria-label="Fechar" onClick={onCancelar} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={18} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.7rem", marginBottom: "0.8rem" }}>
        <label style={rotulo}>A mercadoria chegou em<input type="date" value={dia} max={hoje} min={somarDias(hoje, -60)} onChange={(e) => setDia(e.target.value)} style={entrada} /></label>
        <label style={rotulo}>Onde comprou<input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Atacadão, feira, açougue..." style={entrada} /></label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "0.8rem" }}>
        {linhas.map((l, i) => {
          const insumo = insumos.find((x) => x.id === l.stockItemId);
          return (
            <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "flex-end", paddingBottom: 6, borderBottom: `1px dashed ${PALETA.areiaBorda}` }}>
              <label style={{ ...rotulo, flex: "2 1 220px" }}>Insumo
                <select value={l.stockItemId} onChange={(e) => muda(i, "stockItemId", e.target.value)} style={entrada}>
                  <option value="">Escolha…</option>
                  {insumos.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
                  <option value="NEW">+ Novo insumo</option>
                </select>
              </label>
              <label style={{ ...rotulo, flex: "1 1 80px" }}>Quantidade<input inputMode="decimal" value={l.quantidade} onChange={(e) => muda(i, "quantidade", e.target.value)} style={{ ...entrada, textAlign: "right" }} /></label>
              <label style={{ ...rotulo, flex: "0 0 72px" }}>Unid.
                <select value={l.unidade || (l.stockItemId === "NEW" ? l.newItemUnit : insumo?.unit || "un")} onChange={(e) => muda(i, "unidade", e.target.value)} style={entrada}>
                  {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label style={{ ...rotulo, flex: "1 1 100px" }}>Valor pago (R$)<input inputMode="decimal" value={l.valorTotal} onChange={(e) => muda(i, "valorTotal", e.target.value)} style={{ ...entrada, textAlign: "right" }} /></label>
              <button type="button" aria-label="Tirar linha" disabled={linhas.length === 1} onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} style={{ flex: "0 0 28px", border: "none", background: "none", cursor: "pointer", color: PALETA.areiaTinta, paddingBottom: 8 }}><X size={15} /></button>
              {l.stockItemId === "NEW" && (
                <div style={{ flex: "1 1 100%", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input placeholder="Nome do insumo novo" value={l.newItemName} onChange={(e) => muda(i, "newItemName", e.target.value)} style={{ ...entrada, flex: "1 1 200px" }} />
                  <select aria-label="Unidade do estoque" value={l.newItemUnit} onChange={(e) => muda(i, "newItemUnit", e.target.value)} style={entrada}>
                    {UNIDADES.map((u) => <option key={u} value={u}>controla em {u}</option>)}
                  </select>
                </div>
              )}
            </div>
          );
        })}
        <button type="button" onClick={() => setLinhas((ls) => [...ls, linhaVazia()])} style={{ alignSelf: "flex-start", border: "none", background: "none", color: PALETA.marca, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}>
          <Plus size={14} /> Mais um item
        </button>
      </div>

      <div style={{ fontWeight: 900, fontSize: "1.05rem", marginBottom: "0.7rem" }}>Total: {fmtReais(total)}</div>
      <PagamentoDaCompra valor={pagamento} onChange={setPagamento} total={total} dia={dia} />

      {erro && <div style={{ marginTop: "0.7rem" }}><Faixa cor="grave">{erro}</Faixa></div>}
      <div style={{ display: "flex", gap: 8, marginTop: "0.9rem" }}>
        <button type="button" className="btn btn-primary" disabled={salvando} onClick={lancar}>{salvando ? "Lançando…" : "Lançar compra"}</button>
        <button type="button" className="btn btn-outline" onClick={onCancelar}>Cancelar</button>
      </div>
    </section>
  );
}

const rotulo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: "0.74rem", fontWeight: 800, color: PALETA.areiaTinta, minWidth: 0 };

function Faixa({ cor, children }: { cor: "grave" | "ok"; children: React.ReactNode }) {
  const c = cor === "grave" ? { t: PALETA.grave, f: PALETA.graveClaro, b: PALETA.graveBorda } : { t: PALETA.ok, f: PALETA.okClaro, b: PALETA.okBorda };
  return <div role={cor === "grave" ? "alert" : "status"} style={{ background: c.f, border: `1px solid ${c.b}`, color: c.t, borderRadius: 10, padding: "0.65rem 0.85rem", marginBottom: "0.75rem", fontWeight: 700, fontSize: "0.86rem" }}>{children}</div>;
}
