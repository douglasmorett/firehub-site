"use client";
/**
 * A CONTAGEM DE ESTOQUE no celular da cozinha.
 *
 * - Às cegas: enquanto conta, a tela NÃO mostra o saldo do sistema. Quem vê o
 *   número tende a "achar" o número.
 * - Pelo caminho da cozinha: agrupada pelo local do insumo (freezer,
 *   geladeira, estoque seco).
 * - Em kg e litro: o insumo em g se conta em kg (2,5 kg, não 2500 g), o em ml
 *   em litro. A tela converte.
 * - Cada item grava ao sair do campo: fechou o app no meio, nada se perde.
 * - Completa (toda semana, tudo) ou rápida (fim do dia, só os itens marcados
 *   "contar todo dia"): com a rápida, o CMV da semana anda a cada dia.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtReais, fmtQtd } from "@/lib/relatorios/base";
import { lerNumeroBr } from "@/lib/cmv/numero";

type Resumo = { id: string; dia: string; tipo: string; status: string; itens: number; contados: number; valorTotal: number | null };
type Lista = { hoje: string; diaSugerido: string; diaDaCompleta: string; hojeEDiaDaCompleta: boolean; veDadosSensiveis: boolean; marcadosNoDia: number; totalDeInsumos: number; contagens: Resumo[] };
type Item = {
  stockItemId: string; nome: string; unidade: string; local: string; preparo: boolean; contado: number | null;
  quantidade?: number | null; origem?: string | null; saldoSistema?: number | null; diferenca?: number | null; valor?: number | null; foraDoCmv?: boolean;
};
type Detalhe = { id: string; dia: string; tipo: string; status: string; valorTotal: number | null; veDadosSensiveis: boolean; itens: Item[]; outros: { stockItemId: string; nome: string; unidade: string; local: string }[] };

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const nomeDoDia = (dia: string) => `${DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** A unidade em que se conta: g → kg, ml → L. */
function unidadeDeContagem(u: string): { rotulo: string; fator: number } {
  const x = u.trim().toLowerCase();
  if (x === "g") return { rotulo: "kg", fator: 1000 };
  if (x === "ml") return { rotulo: "L", fator: 1000 };
  return { rotulo: u, fator: 1 };
}
const paraTela = (v: number | null, fator: number) => (v == null ? "" : String(Math.round((v / fator) * 1000) / 1000).replace(".", ","));

export default function ContagemClient() {
  const [lista, setLista] = useState<Lista | null>(null);
  const [aberta, setAberta] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dia, setDia] = useState("");
  const [abrindo, setAbrindo] = useState(false);

  const carregarLista = useCallback(async () => {
    const r = await fetch("/api/store/estoque/contagens", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErro(j.error); return; }
    setLista(j);
    // O servidor sabe o horário da loja: antes de abrir, vale o fim de ontem.
    setDia((d) => d || j.diaSugerido);
  }, []);

  const abrirDetalhe = useCallback(async (id: string) => {
    const r = await fetch(`/api/store/estoque/contagens/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErro(j.error); return; }
    setAberta(j);
    setErro(null);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => { carregarLista(); }, [carregarLista]);

  const comecar = async (tipo: "COMPLETA" | "RAPIDA") => {
    setAbrindo(true);
    setErro(null);
    try {
      const r = await fetch("/api/store/estoque/contagens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dia, tipo }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await abrirDetalhe(j.id);
      carregarLista();
    } catch (e: any) { setErro(e.message); } finally { setAbrindo(false); }
  };

  if (aberta) {
    return (
      <Moldura>
        <button type="button" onClick={() => { setAberta(null); carregarLista(); }} style={voltar}>
          <ArrowLeft size={14} /> Contagens
        </button>
        {aberta.status === "FECHADA"
          ? <ContagemFechada c={aberta} onReabrir={async () => { await abrirDetalhe(aberta.id); carregarLista(); }} />
          : <Contando c={aberta} onFechada={() => abrirDetalhe(aberta.id)} onDescartada={() => { setAberta(null); carregarLista(); }} />}
      </Moldura>
    );
  }

  const abertas = lista?.contagens.filter((c) => c.status === "ABERTA") || [];
  return (
    <Moldura>
      <Link href="/store/estoque" style={voltar}><ArrowLeft size={14} /> Estoque</Link>
      <h1 style={{ margin: "0 0 4px", fontSize: "1.45rem", fontWeight: 900 }}>Contagem de estoque</h1>
      <p style={{ margin: "0 0 1rem", fontSize: "0.88rem", color: PALETA.areiaTinta }}>
        É a base do CMV real: o que tinha + o que comprou − o que sobrou. Conte sempre no mesmo momento: no fim do expediente, ou de manhã antes de abrir, e antes de guardar a mercadoria que chegou.
      </p>

      {erro && <Aviso cor="grave">{erro}</Aviso>}

      {abertas.map((c) => (
        <button key={c.id} type="button" onClick={() => abrirDetalhe(c.id)} style={{ ...cartao, width: "100%", textAlign: "left", cursor: "pointer", borderColor: PALETA.marca, marginBottom: "0.75rem" }}>
          <div style={{ fontWeight: 900, color: PALETA.marca }}>Continuar a contagem {c.tipo === "RAPIDA" ? "do dia" : "completa"} de {nomeDoDia(c.dia)}</div>
          <div style={{ fontSize: "0.82rem", color: PALETA.areiaTinta }}>{c.contados} de {c.itens} itens contados</div>
        </button>
      ))}

      <section style={{ ...cartao, marginBottom: "1rem" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta }}>
          Esta contagem fecha o dia
          <input type="date" value={dia} max={lista?.hoje} onChange={(e) => setDia(e.target.value)} style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.55rem", fontSize: "1rem", maxWidth: 220 }} />
          <span style={{ fontWeight: 500 }}>{dia ? <>É o que sobrou no fim do expediente de <strong>{nomeDoDia(dia)}</strong>.</> : null}</span>
        </label>
        {lista?.hojeEDiaDaCompleta && (
          <p style={{ margin: "0.8rem 0 0", fontSize: "0.86rem", fontWeight: 800, color: PALETA.marca }}>Hoje é {lista.diaDaCompleta}: dia da contagem completa.</p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.6rem", marginTop: "0.9rem" }}>
          <button type="button" disabled={abrindo || !dia} onClick={() => comecar("RAPIDA")} className={lista?.hojeEDiaDaCompleta ? "btn btn-outline" : "btn btn-primary"} style={{ padding: "0.8rem", fontSize: "0.95rem", order: lista?.hojeEDiaDaCompleta ? 2 : 1 }}>
            Contagem do dia (rápida)
            <div style={{ fontSize: "0.75rem", fontWeight: 500, opacity: 0.9 }}>{lista ? `${lista.marcadosNoDia} itens marcados "contar todo dia"` : "…"}</div>
          </button>
          <button type="button" disabled={abrindo || !dia} onClick={() => comecar("COMPLETA")} className={lista?.hojeEDiaDaCompleta ? "btn btn-primary" : "btn btn-outline"} style={{ padding: "0.8rem", fontSize: "0.95rem", order: lista?.hojeEDiaDaCompleta ? 1 : 2 }}>
            Contagem completa (toda {lista?.diaDaCompleta || "semana"})
            <div style={{ fontSize: "0.75rem", fontWeight: 500 }}>{lista ? `todos os ${lista.totalDeInsumos} insumos` : "…"}</div>
          </button>
        </div>
        {lista && lista.marcadosNoDia === 0 && (
          <p style={{ fontSize: "0.78rem", color: PALETA.atencao, margin: "0.6rem 0 0", fontWeight: 600 }}>
            Para a contagem do dia, marque "Contar todo dia" nos insumos que mais pesam (Estoque › editar insumo).
          </p>
        )}
      </section>

      <h2 style={{ fontSize: "0.95rem", fontWeight: 900, margin: "1rem 0 0.5rem" }}>Contagens fechadas</h2>
      {!lista ? <p style={{ color: PALETA.areiaTinta }}>Carregando…</p> : lista.contagens.filter((c) => c.status === "FECHADA").length === 0 ? (
        <p style={{ color: PALETA.areiaTinta, fontSize: "0.88rem" }}>Nenhuma ainda. A primeira completa é o estoque inicial.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lista.contagens.filter((c) => c.status === "FECHADA").map((c) => (
            <button key={c.id} type="button" onClick={() => abrirDetalhe(c.id)} style={{ ...cartao, display: "flex", justifyContent: "space-between", gap: 12, cursor: "pointer", textAlign: "left", padding: "0.65rem 0.9rem" }}>
              <span><strong>{nomeDoDia(c.dia)}</strong> <span style={{ color: PALETA.areiaTinta, fontSize: "0.82rem" }}>· {c.tipo === "RAPIDA" ? "do dia" : "completa"} · {c.contados} contados</span></span>
              {lista.veDadosSensiveis && c.valorTotal != null && <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtReais(c.valorTotal)}</span>}
            </button>
          ))}
        </div>
      )}
    </Moldura>
  );
}

// ── CONTANDO ───────────────────────────────────────────────────────────────

function Contando({ c, onFechada, onDescartada }: { c: Detalhe; onFechada: () => void; onDescartada: () => void }) {
  const [itens, setItens] = useState<Item[]>(c.itens);
  const [texto, setTexto] = useState<Record<string, string>>(() =>
    Object.fromEntries(c.itens.map((i) => [i.stockItemId, paraTela(i.contado, unidadeDeContagem(i.unidade).fator)])),
  );
  const [estado, setEstado] = useState<Record<string, "salvando" | "salvo" | "erro">>({});
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<null | "fechar" | "descartar">(null);
  const [fechando, setFechando] = useState(false);
  const [outros, setOutros] = useState(c.outros);
  const [extra, setExtra] = useState("");
  const ultimoSalvo = useRef<Record<string, string>>({ ...texto });

  const contados = itens.filter((i) => (texto[i.stockItemId] ?? "").trim() !== "").length;
  const grupos = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of itens) m.set(i.local, [...(m.get(i.local) || []), i]);
    return [...m.entries()];
  }, [itens]);

  const salvar = async (i: Item) => {
    const t = (texto[i.stockItemId] ?? "").trim();
    if (ultimoSalvo.current[i.stockItemId] === t) return;
    const { fator } = unidadeDeContagem(i.unidade);
    let contado: number | null = null;
    if (t) {
      const n = lerNumeroBr(t);
      if (!Number.isFinite(n) || n < 0) { setEstado((e) => ({ ...e, [i.stockItemId]: "erro" })); return; }
      contado = Math.round(n * fator * 1000) / 1000;
    }
    setEstado((e) => ({ ...e, [i.stockItemId]: "salvando" }));
    const r = await fetch(`/api/store/estoque/contagens/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itens: [{ stockItemId: i.stockItemId, contado }] }) });
    if (r.ok) { ultimoSalvo.current[i.stockItemId] = t; setEstado((e) => ({ ...e, [i.stockItemId]: "salvo" })); }
    else { const j = await r.json().catch(() => ({})); setErro(j.error || "Não salvou. Confira a internet."); setEstado((e) => ({ ...e, [i.stockItemId]: "erro" })); }
  };

  const acrescentar = () => {
    const o = outros.find((x) => x.stockItemId === extra);
    if (!o) return;
    setItens((l) => [...l, { ...o, preparo: false, contado: null }]);
    setOutros((l) => l.filter((x) => x.stockItemId !== extra));
    setExtra("");
  };

  const fechar = async () => {
    setFechando(true);
    setErro(null);
    try {
      const pendentes = itens.filter((i) => (texto[i.stockItemId] ?? "").trim() !== ultimoSalvo.current[i.stockItemId]);
      for (const i of pendentes) await salvar(i);
      const r = await fetch(`/api/store/estoque/contagens/${c.id}/fechar`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      onFechada();
    } catch (e: any) { setErro(e.message); setConfirmar(null); } finally { setFechando(false); }
  };

  const descartar = async () => {
    const r = await fetch(`/api/store/estoque/contagens/${c.id}`, { method: "DELETE" });
    if (r.ok) onDescartada();
    else { const j = await r.json().catch(() => ({})); setErro(j.error); }
  };

  return (
    <>
      <h1 style={{ margin: "0 0 2px", fontSize: "1.3rem", fontWeight: 900 }}>Contagem {c.tipo === "RAPIDA" ? "do dia" : "completa"} · {nomeDoDia(c.dia)}</h1>
      <p style={{ margin: "0 0 0.8rem", fontSize: "0.84rem", color: PALETA.areiaTinta }}>
        Conte o que está na loja e digite. Cada item grava sozinho. Item que não tem nenhum, digite 0. Em branco = não contado.
      </p>
      <div style={{ position: "sticky", top: "env(safe-area-inset-top, 0px)", zIndex: 5, background: PALETA.areia, padding: "0.5rem 0", marginBottom: "0.5rem" }}>
        <div style={{ height: 8, background: "#fff", borderRadius: 999, overflow: "hidden", border: `1px solid ${PALETA.areiaBorda}` }}>
          <div style={{ width: `${itens.length ? (contados / itens.length) * 100 : 0}%`, height: "100%", background: PALETA.ok, transition: "width .2s" }} />
        </div>
        <div style={{ fontSize: "0.8rem", fontWeight: 800, marginTop: 4 }}>{contados} de {itens.length} contados</div>
      </div>

      {erro && <Aviso cor="grave">{erro}</Aviso>}

      {grupos.map(([local, lista]) => (
        <section key={local} style={{ marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "0.78rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", color: PALETA.areiaTinta, margin: "0 0 0.4rem" }}>{local}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {lista.map((i) => {
              const u = unidadeDeContagem(i.unidade);
              const st = estado[i.stockItemId];
              return (
                <label key={i.stockItemId} style={{ ...cartao, display: "flex", alignItems: "center", gap: 10, padding: "0.55rem 0.75rem" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 800, display: "block" }}>{i.nome}</span>
                    {i.preparo && <span style={{ fontSize: "0.72rem", color: PALETA.brasaTinta, fontWeight: 700 }}>pronto (preparo)</span>}
                  </span>
                  <input
                    inputMode="decimal"
                    aria-label={`${i.nome} em ${u.rotulo}`}
                    value={texto[i.stockItemId] ?? ""}
                    onChange={(e) => setTexto((t) => ({ ...t, [i.stockItemId]: e.target.value }))}
                    onBlur={() => salvar(i)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    style={{ width: 96, textAlign: "right", border: `1.5px solid ${st === "erro" ? PALETA.grave : PALETA.areiaBorda}`, borderRadius: 8, padding: "0.5rem", fontSize: "1.05rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}
                  />
                  <span style={{ width: 28, fontSize: "0.82rem", fontWeight: 800, color: PALETA.areiaTinta }}>{u.rotulo}</span>
                  <span style={{ width: 18 }} aria-live="polite">
                    {st === "salvando" ? <Loader2 size={16} className="animate-spin" color={PALETA.areiaTinta} /> : st === "salvo" ? <CheckCircle2 size={16} color={PALETA.ok} /> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}

      {outros.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0.5rem 0 1rem" }}>
          <select value={extra} onChange={(e) => setExtra(e.target.value)} style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.5rem", flex: "1 1 200px", minWidth: 0 }}>
            <option value="">Contar mais um item…</option>
            {outros.map((o) => <option key={o.stockItemId} value={o.stockItemId}>{o.nome}</option>)}
          </select>
          <button type="button" className="btn btn-outline" disabled={!extra} onClick={acrescentar} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={15} /> Incluir</button>
        </div>
      )}

      <div style={{ ...cartao, marginTop: "1rem" }}>
        {confirmar === "fechar" ? (
          <>
            <p style={{ margin: "0 0 0.6rem", fontWeight: 700 }}>
              Fechar a contagem? O estoque do sistema passa a ser o que foi contado{itens.length - contados > 0 ? `; os ${itens.length - contados} itens em branco seguem a última contagem mais as compras` : ""}.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-primary" disabled={fechando} onClick={fechar}>{fechando ? "Fechando…" : "Fechar contagem"}</button>
              <button type="button" className="btn btn-outline" onClick={() => setConfirmar(null)}>Voltar</button>
            </div>
          </>
        ) : confirmar === "descartar" ? (
          <>
            <p style={{ margin: "0 0 0.6rem", fontWeight: 700 }}>Descartar esta contagem? O que foi digitado se perde.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={descartar} style={{ border: "none", background: PALETA.grave, color: "#fff", borderRadius: 8, padding: "0.55rem 0.9rem", fontWeight: 800, cursor: "pointer" }}>Descartar</button>
              <button type="button" className="btn btn-outline" onClick={() => setConfirmar(null)}>Voltar</button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
            <button type="button" className="btn btn-primary" disabled={contados === 0} onClick={() => setConfirmar("fechar")} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.7rem 1.1rem" }}>
              <ClipboardCheck size={16} /> Terminei, fechar contagem
            </button>
            <button type="button" onClick={() => setConfirmar("descartar")} style={{ border: "none", background: "none", color: PALETA.areiaTinta, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Trash2 size={14} /> Descartar
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── FECHADA ────────────────────────────────────────────────────────────────

function ContagemFechada({ c, onReabrir }: { c: Detalhe; onReabrir: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const contados = c.itens.filter((i) => i.origem === "CONTADO");
  const diferencas = contados.filter((i) => (i.diferenca ?? 0) !== 0).sort((a, b) => Math.abs(b.diferenca ?? 0) - Math.abs(a.diferenca ?? 0));

  const reabrir = async () => {
    const r = await fetch(`/api/store/estoque/contagens/${c.id}/reabrir`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error); setConfirmar(false); return; }
    onReabrir();
  };

  return (
    <>
      <h1 style={{ margin: "0 0 2px", fontSize: "1.3rem", fontWeight: 900 }}>Contagem {c.tipo === "RAPIDA" ? "do dia" : "completa"} · {nomeDoDia(c.dia)}</h1>
      <p style={{ margin: "0 0 0.8rem", fontSize: "0.84rem", color: PALETA.areiaTinta }}>
        Fechada. {contados.length} itens contados{c.itens.length - contados.length > 0 ? `, ${c.itens.length - contados.length} seguiram a contagem anterior` : ""}.
        {c.veDadosSensiveis && c.valorTotal != null && <> Estoque que entra no CMV: <strong style={{ color: PALETA.carvao }}>{fmtReais(c.valorTotal)}</strong>.</>}
      </p>
      {erro && <Aviso cor="grave">{erro}</Aviso>}

      <h2 style={{ fontSize: "0.95rem", fontWeight: 900, margin: "0.5rem 0" }}>Diferença entre o contado e o sistema</h2>
      <p style={{ fontSize: "0.8rem", color: PALETA.areiaTinta, margin: "0 0 0.5rem" }}>O sistema baixa pela ficha técnica e pelos lançamentos. Diferença grande é ficha errada, perda sem registro ou compra não lançada.</p>
      {diferencas.length === 0 ? <p style={{ color: PALETA.areiaTinta }}>Nenhuma diferença.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
            <thead>
              <tr>{["Insumo", "Contado", "Sistema", "Diferença", ...(c.veDadosSensiveis ? ["R$"] : [])].map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "0.35rem", fontSize: "0.72rem", textTransform: "uppercase", color: PALETA.areiaTinta, borderBottom: `1px solid ${PALETA.areiaBorda}` }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {diferencas.map((i) => {
                const custo = i.valor != null && i.quantidade ? i.valor / i.quantidade : null;
                return (
                  <tr key={i.stockItemId}>
                    <td style={{ padding: "0.4rem 0.35rem", fontWeight: 700 }}>{i.nome}</td>
                    <td style={{ textAlign: "right", padding: "0.4rem 0.35rem" }}>{fmtQtd(i.quantidade ?? 0)} {i.unidade}</td>
                    <td style={{ textAlign: "right", padding: "0.4rem 0.35rem", color: PALETA.areiaTinta }}>{fmtQtd(i.saldoSistema ?? 0)}</td>
                    <td style={{ textAlign: "right", padding: "0.4rem 0.35rem", fontWeight: 800, color: (i.diferenca ?? 0) < 0 ? PALETA.grave : PALETA.ok }}>{(i.diferenca ?? 0) > 0 ? "+" : ""}{fmtQtd(i.diferenca ?? 0)}</td>
                    {c.veDadosSensiveis && <td style={{ textAlign: "right", padding: "0.4rem 0.35rem" }}>{custo != null ? fmtReais((i.diferenca ?? 0) * custo) : "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {c.veDadosSensiveis && (
        <div style={{ ...cartao, marginTop: "1.25rem" }}>
          {confirmar ? (
            <>
              <p style={{ margin: "0 0 0.6rem", fontWeight: 700 }}>Reabrir? Os ajustes de saldo desta contagem são desfeitos e o CMV deste dia some até fechar de novo.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-primary" onClick={reabrir}>Reabrir contagem</button>
                <button type="button" className="btn btn-outline" onClick={() => setConfirmar(false)}>Voltar</button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmar(true)} style={{ border: "none", background: "none", color: PALETA.areiaTinta, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RotateCcw size={14} /> Corrigir: reabrir esta contagem (só a última)
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ── PEÇAS ──────────────────────────────────────────────────────────────────

const voltar: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 700, color: PALETA.areiaTinta, textDecoration: "none", marginBottom: 10, border: "none", background: "none", padding: 0, cursor: "pointer" };
const cartao: React.CSSProperties = { background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 12, padding: "0.9rem 1rem" };

function Moldura({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "1.25rem 1rem 4rem", maxWidth: 720, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", color: PALETA.carvao }}>{children}</div>;
}

function Aviso({ cor, children }: { cor: "grave" | "atencao"; children: React.ReactNode }) {
  const c = cor === "grave" ? { t: PALETA.grave, f: PALETA.graveClaro, b: PALETA.graveBorda } : { t: PALETA.atencao, f: PALETA.atencaoClaro, b: PALETA.atencaoBorda };
  return <div role="alert" style={{ background: c.f, border: `1px solid ${c.b}`, color: c.t, borderRadius: 10, padding: "0.65rem 0.85rem", marginBottom: "0.75rem", fontWeight: 700, fontSize: "0.86rem" }}>{children}</div>;
}
