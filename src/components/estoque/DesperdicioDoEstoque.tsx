"use client";
/**
 * A aba "Desperdício" do Estoque: lançar o que caiu no chão, queimou ou saiu
 * errado — por PRODUTO do cardápio (baixa pela ficha técnica) ou por INSUMO — e
 * ver o desperdício do período, com os pedidos cancelados já produzidos à parte.
 *
 * A conta é de lib/cmv/desperdicio.ts (rota /api/store/estoque/desperdicio).
 * Mora dentro do EstoqueClient e usa as classes dele (form-group, items-table,
 * modal-card...), que são globais. R$ só para quem vê dados sensíveis.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

// ── Aviso que desce do topo e some sozinho (no lugar do alert()) ──────────
// Mesma interface do components/AvisoNoTopo.tsx de outra frente, que ainda não
// foi publicado: quando ele estiver no master, basta trocar este bloco pelo import.
type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: "#2563EB", fundo: "#EFF6FF" },
};
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1100,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

type Produto = { id: string; nome: string; categoria: string; temFicha: boolean; temCusto: boolean };
type Insumo = { id: string; nome: string; unidade: string };
type Lancado = {
  quando: string; item: string; tipo: "PRODUTO" | "INSUMO"; quantidade: number | null; unidade: string | null;
  motivo: string | null; quem: string | null; origem: string; valor: number | null; estimado: boolean;
};
type Cancelado = {
  pedidoId: string; numero: string; quando: string; etapaTexto: string; motivo: string | null; valor: number | null; insumos: number;
};
type Dados = {
  hoje: string; de: string; ate: string; veDadosSensiveis: boolean;
  lancados: Lancado[]; cancelados: Cancelado[];
  totais: { lancados: number; cancelados: number; total: number; semValor: number } | null;
  produtos: Produto[]; insumos: Insumo[];
};

const MOTIVOS = ["Caiu no chão", "Queimou", "Saiu errado", "Venceu", "Cliente devolveu"];

// Uma linha do lançamento: vários itens do cardápio (ou insumos) de uma vez,
// cada um com a sua quantidade (Douglas, 24/10/2026: "seleciona os itens do
// cardápio para saber a perda correta").
type LinhaDaPerda = { tipo: "PRODUTO" | "INSUMO"; id: string; rotulo: string; unidade: string; quantidade: string };

const fmtR = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const fmtQtd = (q: number | null, u: string | null) =>
  q == null ? "—" : `${q.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}${u ? ` ${u === "un" ? "un." : u}` : ""}`;
const quandoBr = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function DesperdicioDoEstoque({ onLancou, pedidoDeAbrir = 0, onAbriu }: { onLancou?: () => void; pedidoDeAbrir?: number; onAbriu?: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);

  // Lançamento
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<"PRODUTO" | "INSUMO">("PRODUTO");
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [motivo, setMotivo] = useState("");
  const [linhas, setLinhas] = useState<LinhaDaPerda[]>([]);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async (periodo?: { de: string; ate: string }) => {
    setCarregando(true);
    try {
      const q = periodo?.de && periodo?.ate ? `?de=${periodo.de}&ate=${periodo.ate}` : "";
      const r = await fetch(`/api/store/estoque/desperdicio${q}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Não deu para carregar o desperdício.");
      setDados(d);
      setDe(d.de);
      setAte(d.ate);
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Desperdício", detalhe: e?.message || "Não deu para carregar." });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const opcoes = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = tipo === "PRODUTO"
      ? (dados?.produtos || []).map((p) => ({ id: p.id, rotulo: p.categoria ? `${p.nome} · ${p.categoria}` : p.nome }))
      : (dados?.insumos || []).map((i) => ({ id: i.id, rotulo: `${i.nome} (${i.unidade})` }));
    return termo ? lista.filter((o) => o.rotulo.toLowerCase().includes(termo)) : lista;
  }, [dados, tipo, busca]);

  const produto = tipo === "PRODUTO" ? dados?.produtos.find((p) => p.id === escolhido) : undefined;
  const insumo = tipo === "INSUMO" ? dados?.insumos.find((i) => i.id === escolhido) : undefined;

  const abrir = () => {
    setTipo("PRODUTO"); setBusca(""); setEscolhido(""); setQuantidade("1"); setMotivo(""); setLinhas([]); setAberto(true);
  };

  // O botão "Lançar perda / descarte" do topo do Controle de estoque abre direto
  // aqui; o pedido volta a zero para a aba não reabrir o modal ao voltar a ela.
  useEffect(() => {
    if (pedidoDeAbrir > 0) { abrir(); onAbriu?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoDeAbrir]);

  // O item escolhido agora, como linha da lista.
  const linhaEscolhida = (): LinhaDaPerda | null => {
    if (produto) return { tipo: "PRODUTO", id: produto.id, rotulo: produto.nome, unidade: "un.", quantidade };
    if (insumo) return { tipo: "INSUMO", id: insumo.id, rotulo: insumo.nome, unidade: insumo.unidade, quantidade };
    return null;
  };
  const quantidadeValida = (q: string) => Number(q.replace(",", ".")) > 0;

  const adicionar = () => {
    const l = linhaEscolhida();
    if (!l) { setAviso({ tipo: "atencao", titulo: tipo === "PRODUTO" ? "Escolha o produto" : "Escolha o insumo" }); return; }
    if (!quantidadeValida(l.quantidade)) { setAviso({ tipo: "atencao", titulo: "Digite a quantidade" }); return; }
    setLinhas((atual) => [...atual, l]);
    setEscolhido(""); setBusca(""); setQuantidade(tipo === "PRODUTO" ? "1" : "");
  };

  const lancar = async (e: React.FormEvent) => {
    e.preventDefault();
    // O item escolhido e ainda não adicionado entra junto: lançar um só
    // continua sendo escolher e confirmar.
    const atual = linhaEscolhida();
    const todas = atual ? [...linhas, atual] : linhas;
    if (todas.length === 0) { setAviso({ tipo: "atencao", titulo: "Escolha o que foi perdido", detalhe: "Selecione os itens do cardápio (ou os insumos) e a quantidade." }); return; }
    if (atual && !quantidadeValida(atual.quantidade)) { setAviso({ tipo: "atencao", titulo: "Digite a quantidade" }); return; }
    if (motivo.trim().length < 3) { setAviso({ tipo: "atencao", titulo: "Escreva o motivo", detalhe: "Ex.: caiu no chão, queimou, saiu errado." }); return; }
    setEnviando(true);
    // Um por vez, pela mesma rota de sempre: cada item tem a sua baixa pela
    // ficha e o seu aviso (sem ficha, sem custo). O que falhou fica na lista.
    const falharam: LinhaDaPerda[] = [];
    const erros: string[] = [];
    const avisos: string[] = [];
    let lancados = 0;
    let total = 0;
    let comValor = false;
    for (const l of todas) {
      try {
        const r = await fetch("/api/store/estoque/desperdicio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(l.tipo === "PRODUTO"
            ? { tipo: l.tipo, produtoId: l.id, quantidade: l.quantidade, motivo }
            : { tipo: l.tipo, insumoId: l.id, quantidade: l.quantidade, motivo }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d) throw new Error(d?.error || "Não deu para lançar.");
        lancados += 1;
        if (d.valor != null) { total += Number(d.valor) || 0; comValor = true; }
        if (d.aviso) avisos.push(`${l.rotulo}: ${d.aviso}`);
      } catch (err: any) {
        falharam.push(l);
        erros.push(`${l.rotulo}: ${err?.message || "não lançou"}`);
      }
    }
    setEnviando(false);
    if (lancados > 0) { carregar({ de, ate }); onLancou?.(); }
    if (falharam.length > 0) {
      setLinhas(falharam); setEscolhido("");
      setAviso({ tipo: "erro", titulo: lancados > 0 ? `${lancados} lançado(s), ${falharam.length} não` : "Não lançou", detalhe: erros.join(" · ") });
      return;
    }
    setAberto(false);
    setAviso({
      tipo: avisos.length > 0 ? "atencao" : "ok",
      titulo: `Perda lançada: ${todas.length === 1 ? todas[0].rotulo : `${todas.length} itens`}${comValor ? ` · ${fmtR(total)}` : ""}`,
      detalhe: avisos.length > 0 ? avisos.join(" · ") : "Saiu do estoque pela ficha técnica e entra no CMV como desperdício.",
    });
  };

  const veValor = Boolean(dados?.veDadosSensiveis);

  return (
    <>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      <div className="filter-controls" style={{ alignItems: "flex-end" }}>
        <div className="form-group mb-0">
          <label>De</label>
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="form-group mb-0">
          <label>Até</label>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <button type="button" className="btn-secondary" onClick={() => carregar({ de, ate })} disabled={carregando}>
          {carregando ? "Carregando..." : "Ver período"}
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn-primary" onClick={abrir}>
          <Plus size={16} /> Lançar perda / descarte
        </button>
      </div>

      <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 1rem", lineHeight: 1.5 }}>
        Caiu no chão, queimou, saiu errado, venceu: selecione os <strong>itens do cardápio</strong> perdidos (saem do estoque pela ficha técnica)
        ou os <strong>insumos</strong>, vários de uma vez. O custo entra no CMV como desperdício. Pedido cancelado só vira desperdício se foi cancelado
        <strong> depois de sair da produção</strong> (produção do KDS, pronto ou saiu para entrega) — antes disso o insumo volta para o estoque.
      </p>

      {veValor && dados?.totais && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <Cartao rotulo="Desperdício no período" valor={fmtR(dados.totais.total)} />
          <Cartao rotulo="Lançado (produtos e insumos)" valor={fmtR(dados.totais.lancados)} detalhe={`${dados.lancados.length} lançamento(s)`} />
          <Cartao rotulo="Pedidos cancelados (já produzidos)" valor={fmtR(dados.totais.cancelados)} detalhe={`${dados.cancelados.length} pedido(s)`} />
        </div>
      )}
      {veValor && (dados?.totais?.semValor ?? 0) > 0 && (
        <p style={{ fontSize: "0.8rem", color: "#B45309", fontWeight: 600, margin: "-0.5rem 0 1rem" }}>
          {dados!.totais!.semValor} desperdício(s) sem valor: produto sem ficha técnica e sem custo, ou insumo sem custo. Eles ficam fora do total.
        </p>
      )}

      <h3 style={{ fontSize: "0.95rem", fontWeight: 800, margin: "0 0 0.5rem" }}>🗑️ Desperdício lançado</h3>
      {!dados || dados.lancados.length === 0 ? (
        <div className="empty-state">
          <Trash2 size={40} />
          <h3>{carregando ? "Carregando..." : "Nenhum desperdício lançado no período"}</h3>
          <p>Use “Lançar perda / descarte” quando algo for para o lixo.</p>
        </div>
      ) : (
        <div className="items-table-wrapper">
          <table className="items-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Produto / insumo</th>
                <th>Qtd.</th>
                <th>Motivo</th>
                <th>Quem</th>
                {veValor && <th style={{ textAlign: "right" }}>Valor</th>}
              </tr>
            </thead>
            <tbody>
              {dados.lancados.map((l, i) => (
                <tr key={`${l.quando}-${i}`}>
                  <td>{quandoBr(l.quando)}</td>
                  <td className="name-col">
                    {l.item}
                    <span style={{ display: "block", fontSize: "0.72rem", color: "#94A3B8", fontWeight: 600 }}>
                      {l.tipo === "PRODUTO" ? "Produto" : "Insumo"} · {l.origem}
                    </span>
                  </td>
                  <td>{fmtQtd(l.quantidade, l.unidade)}</td>
                  <td className="notes-col">{l.motivo || "—"}</td>
                  <td>{l.quem || "—"}</td>
                  {veValor && (
                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                      {l.valor == null ? <span style={{ color: "#B45309" }}>sem custo</span> : `${fmtR(l.valor)}${l.estimado ? " (estimado)" : ""}`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ fontSize: "0.95rem", fontWeight: 800, margin: "1.5rem 0 0.25rem" }}>❌ Desperdício de pedidos cancelados (já produzidos)</h3>
      <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 0.5rem" }}>
        Cancelados depois de sair da produção: o insumo da ficha técnica ficou fora do estoque como desperdício. Pelo dia do pedido.
      </p>
      {!dados || dados.cancelados.length === 0 ? (
        <p style={{ fontSize: "0.85rem", color: "#94A3B8", margin: 0 }}>{carregando ? "Carregando..." : "Nenhum pedido cancelado depois de produzido no período."}</p>
      ) : (
        <div className="items-table-wrapper">
          <table className="items-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Data</th>
                <th>Quando cancelou</th>
                <th>Motivo do cancelamento</th>
                {veValor && <th style={{ textAlign: "right" }}>Valor</th>}
              </tr>
            </thead>
            <tbody>
              {dados.cancelados.map((c) => (
                <tr key={c.pedidoId}>
                  <td className="name-col">{c.numero}</td>
                  <td>{quandoBr(c.quando)}</td>
                  <td>{c.etapaTexto}</td>
                  <td className="notes-col">{c.motivo || "—"}</td>
                  {veValor && (
                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                      {c.valor == null ? <span style={{ color: "#B45309" }} title="Os produtos deste pedido não têm ficha técnica: nada saiu do estoque">sem ficha</span> : fmtR(c.valor)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aberto && dados && (
        <div className="modal-overlay" onClick={() => setAberto(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="btn-close" onClick={() => setAberto(false)}><X size={20} /></button>
            <h2>Lançar perda / descarte</h2>
            <form onSubmit={lancar}>
              <div className="form-group">
                <label>O que foi para o lixo</label>
                <div className="radio-group-types">
                  {(["PRODUTO", "INSUMO"] as const).map((t) => (
                    <label key={t} className={`radio-label ${tipo === t ? "selected" : ""}`}>
                      <input type="radio" name="tipoDoDesperdicio" checked={tipo === t} onChange={() => { setTipo(t); setEscolhido(""); setBusca(""); setQuantidade(t === "PRODUTO" ? "1" : ""); }} />
                      {t === "PRODUTO" ? "🍕 Produto do cardápio" : "🧀 Insumo"}
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>{tipo === "PRODUTO" ? "Produto" : "Insumo"} *</label>
                <input type="text" placeholder="Pesquisar..." value={busca} onChange={(e) => setBusca(e.target.value)} />
                <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
                  <option value="">{opcoes.length ? "Selecione..." : "Nada encontrado"}</option>
                  {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
                </select>
                {produto && (
                  produto.temFicha
                    ? <small style={{ color: "#0F766E", fontWeight: 600 }}>Sai do estoque pela ficha técnica.</small>
                    : produto.temCusto
                      ? <small style={{ color: "#B45309", fontWeight: 600 }}>Sem ficha técnica: o estoque não baixa; o valor sai do custo digitado no produto.</small>
                      : <small style={{ color: "#C92E09", fontWeight: 700 }}>Sem ficha técnica e sem custo: não dá para calcular o custo deste desperdício. Ele fica registrado sem valor — monte a ficha técnica (aba Fichas Técnicas) ou digite o custo no cardápio.</small>
                )}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Quantidade *</label>
                  <input type="text" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder={tipo === "PRODUTO" ? "Ex: 1" : "Ex: 500"} />
                </div>
                <div className="form-group">
                  <label>Unidade</label>
                  <input type="text" disabled value={tipo === "PRODUTO" ? "unidade(s)" : insumo?.unidade || "—"} />
                </div>
              </div>

              <button type="button" className="btn-secondary" onClick={adicionar} style={{ width: "100%", marginBottom: "0.75rem" }}>
                <Plus size={16} /> Adicionar à lista e escolher outro item
              </button>

              {linhas.length > 0 && (
                <div className="form-group">
                  <label>Itens desta perda ({linhas.length})</label>
                  <div style={{ border: "1px solid #E7DDD3", borderRadius: 10, overflow: "hidden" }}>
                    {linhas.map((l, i) => (
                      <div key={`${l.id}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: i > 0 ? "1px solid #F1F5F9" : "none", fontSize: "0.85rem" }}>
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{l.tipo === "PRODUTO" ? "🍕" : "🧀"} {l.rotulo}</span>
                        <span style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{l.quantidade} {l.unidade === "un" ? "un." : l.unidade}</span>
                        <button type="button" aria-label={`Tirar ${l.rotulo}`} onClick={() => setLinhas((atual) => atual.filter((_, j) => j !== i))}
                          style={{ background: "none", border: "none", color: "#C92E09", cursor: "pointer", padding: 2, display: "flex" }}>
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Motivo *</label>
                <input type="text" required minLength={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: caiu no chão" />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {MOTIVOS.map((m) => (
                    <button key={m} type="button" onClick={() => setMotivo(m)}
                      style={{ fontSize: "0.75rem", fontWeight: 700, padding: "4px 10px", borderRadius: 999, border: "1px solid #E7DDD3", background: motivo === m ? "#1C1917" : "#FAF6F2", color: motivo === m ? "#fff" : "#1C1917", cursor: "pointer" }}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <button type="submit" className="btn-submit" disabled={enviando}>
                {enviando ? "Lançando..." : linhas.length + (escolhido ? 1 : 0) > 1 ? `Confirmar perda de ${linhas.length + (escolhido ? 1 : 0)} itens` : "Confirmar perda"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Cartao({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E7DDD3", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase" }}>{rotulo}</div>
      <div style={{ fontSize: "1.2rem", fontWeight: 900, color: "#C92E09", marginTop: 2 }}>{valor}</div>
      {detalhe && <div style={{ fontSize: "0.75rem", color: "#94A3B8", marginTop: 2 }}>{detalhe}</div>}
    </div>
  );
}
