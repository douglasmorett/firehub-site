"use client";

/**
 * O COMPARATIVO — a tela que o lojista abre toda semana.
 *
 * Douglas, 07/11/2026: "uma planilha comparativa de todos os fornecedores
 * daquele mesmo item, para ele poder comparar e comprar o mais barato… e ele
 * pode selecionar tudo o que quer comprar e a quantidade e já enviar para
 * esse fornecedor."
 *
 * Uma linha por produto, uma coluna por fornecedor. O mais barato vem marcado
 * em verde e já é o escolhido para o pedido; tocar no preço de outro
 * fornecedor troca. A quantidade digitada na linha põe o item no pedido, e a
 * barra de baixo soma tudo. "Revisar e enviar" agrupa por fornecedor (total,
 * mínimo, entrega, o texto que vai) antes de mandar.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Comparativo as DadosDoComparativo, LinhaDoComparativo } from "@/lib/cotacao/comparativo";
import { lerNumeroBr } from "@/lib/cmv/numero";
import { AMBAR, COR, COR_CLARA, Janela, S, VERDE, VERDE_CLARO, VERMELHO, haQuanto, lerReais, numero, pedir, reais, type Aviso } from "./ui";

type Rodada = { id: string; origem: string; chave: string | null; criadaEm: string; resumoApos: string | null; resumoEnviadoEm: string | null; pedidosA: string[]; responderam: string[]; naFila: number; falharam: number } | null;
type Pendente = { id: string; fornecedorId: string; produtoId: string | null; nomeLido: string; unidadeLida: string | null; preco: number; validade: string | null; confianca: number; status: string; criadoEm: string };
type Resposta = { id: string; fornecedorId: string; tipo: string; texto: string | null; status: string; linhas: number; criadaEm: string };
type Fornecedor = { id: string; nome: string; contato: string | null; telefone: string | null; pedidoMinimo: number | null };
type Dados = { comparativo: DadosDoComparativo; rodada: Rodada; pendentes: Pendente[]; respostas: Resposta[]; naFila: number; fornecedores: Fornecedor[]; categorias: string[] };
type Escolha = { fornecedorId: string | null; quantidade: string };
type Grupo = {
  fornecedor: { id: string; nome: string; pedidoMinimo: number | null };
  itens: { produtoId: string; nome: string; unidade: string; quantidade: number; preco: number | null; subtotal: number }[];
  total: number; falta: number; entrega: { texto: string }; semPreco: number; texto: string; telefone: string | null;
};

const ICONE_DA_RESPOSTA: Record<string, string> = { TEXTO: "💬", IMAGEM: "📷", PDF: "📄", AUDIO: "🎤" };

export default function Comparativo({ versao, onAviso, irPara, onMudou, lojaNome }: {
  versao: number; onAviso: (a: Aviso) => void; irPara: (a: "fornecedores" | "produtos" | "agenda" | "pedidos") => void; onMudou: () => void; lojaNome: string;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("");
  const [soPreciso, setSoPreciso] = useState(false);
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [revisao, setRevisao] = useState<Grupo[] | null>(null);
  const [precoManual, setPrecoManual] = useState<{ produtoId: string; fornecedorId: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados(await pedir<Dados>("/api/store/cotacao/comparativo"));
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar, versao]);

  // Enquanto a rodada está fresca (mensagens saindo, respostas chegando), a tela se atualiza sozinha.
  const rodadaFresca = !!dados?.rodada && Date.now() - new Date(dados.rodada.criadaEm).getTime() < 8 * 60 * 60 * 1000;
  useEffect(() => {
    if (!rodadaFresca && !(dados?.naFila)) return;
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, [rodadaFresca, dados?.naFila, carregar]);

  const colunas = dados?.comparativo.colunas || [];
  const nomeDoFornecedor = useMemo(() => new Map(colunas.map((c) => [c.id, c.nome])), [colunas]);
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (dados?.comparativo.linhas || []).filter((l) =>
      (!q || l.produto.nome.toLowerCase().includes(q)) &&
      (!categoria || l.produto.categoria === categoria) &&
      (!soPreciso || l.precisaComprar || Number(lerNumeroBr(escolhas[l.produto.id]?.quantidade || "")) > 0));
  }, [dados, busca, categoria, soPreciso, escolhas]);

  const precoDe = (l: LinhaDoComparativo, fornecedorId: string | null) => (fornecedorId ? l.precos[fornecedorId]?.preco ?? null : null);
  const fornecedorDa = (l: LinhaDoComparativo) => escolhas[l.produto.id]?.fornecedorId ?? l.menor?.fornecedorId ?? null;
  const quantidadeDa = (id: string) => { const n = lerNumeroBr(escolhas[id]?.quantidade || ""); return Number.isFinite(n) && n > 0 ? n : 0; };

  const noPedido = (dados?.comparativo.linhas || []).filter((l) => quantidadeDa(l.produto.id) > 0);
  const totalDoPedido = noPedido.reduce((s, l) => s + quantidadeDa(l.produto.id) * (precoDe(l, fornecedorDa(l)) || 0), 0);
  const fornecedoresNoPedido = new Set(noPedido.map((l) => fornecedorDa(l)).filter(Boolean));
  const semFornecedor = noPedido.filter((l) => !fornecedorDa(l)).length;

  function escolher(l: LinhaDoComparativo, fornecedorId: string) {
    setEscolhas((e) => {
      const atual = e[l.produto.id];
      const quantidade = atual?.quantidade || (l.produto.quantidadePadrao ? String(l.produto.quantidadePadrao).replace(".", ",") : "1");
      return { ...e, [l.produto.id]: { fornecedorId, quantidade } };
    });
  }
  function marcarOQuePrecisa() {
    const novas = { ...escolhas };
    let n = 0;
    for (const l of dados?.comparativo.linhas || []) {
      if (!l.precisaComprar || quantidadeDa(l.produto.id) > 0) continue;
      novas[l.produto.id] = { fornecedorId: l.menor?.fornecedorId ?? null, quantidade: String(l.produto.quantidadePadrao || 1).replace(".", ",") };
      n++;
    }
    setEscolhas(novas);
    onAviso(n ? { tipo: "ok", titulo: `${n} item${n === 1 ? "" : "s"} no pedido, no fornecedor mais barato.`, detalhe: "Confira as quantidades na coluna Comprar." } : { tipo: "info", titulo: "Nenhum item abaixo do mínimo do estoque agora." });
  }

  async function revisar() {
    const itens = noPedido.filter((l) => fornecedorDa(l)).map((l) => ({
      produtoId: l.produto.id, fornecedorId: fornecedorDa(l)!, quantidade: quantidadeDa(l.produto.id), preco: precoDe(l, fornecedorDa(l)),
    }));
    if (!itens.length) return onAviso({ tipo: "atencao", titulo: "Escolha o fornecedor dos itens", detalhe: "Toque no preço de um fornecedor na linha do produto." });
    try {
      const j = await pedir<{ grupos: Grupo[] }>("/api/store/cotacao/pedidos", "POST", { itens, enviar: false });
      setRevisao(j.grupos);
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para montar o pedido", detalhe: e.message });
    }
  }

  if (erro) return <div style={{ ...S.cartao, color: VERMELHO, fontWeight: 700 }}>{erro}</div>;
  if (!dados) return <div style={{ ...S.cartao, color: "#64748B" }}>Montando o comparativo…</div>;

  if (!colunas.length || !dados.comparativo.linhas.length) {
    return (
      <section style={{ ...S.cartao, textAlign: "center", padding: "34px 18px" }}>
        <div style={{ fontSize: 40 }}>📊</div>
        <h2 style={{ ...S.h2, marginTop: 6 }}>O comparativo aparece aqui</h2>
        <p style={{ ...S.texto, maxWidth: 520, margin: "6px auto 14px" }}>
          {!colunas.length ? "Cadastre pelo menos um fornecedor com WhatsApp" : "Cadastre os produtos que você compra"} e peça a cotação: cada
          preço que chegar entra na tabela, com o mais barato marcado.
        </p>
        <button type="button" style={S.botao} onClick={() => irPara(!colunas.length ? "fornecedores" : "produtos")}>
          {!colunas.length ? "Cadastrar fornecedores" : "Cadastrar produtos"}
        </button>
      </section>
    );
  }

  const comPreco = dados.comparativo.linhas.filter((l) => Object.keys(l.precos).length > 0).length;
  const precisam = dados.comparativo.linhas.filter((l) => l.precisaComprar).length;

  return (
    <>
      <Rodada dados={dados} nomeDoFornecedor={nomeDoFornecedor} />
      {dados.pendentes.length > 0 && (
        <Pendentes pendentes={dados.pendentes} produtos={dados.comparativo.linhas.map((l) => l.produto)} nomeDoFornecedor={nomeDoFornecedor}
          onAviso={onAviso} onMudou={() => { carregar(); onMudou(); }} />
      )}

      <section style={{ ...S.cartao, marginTop: 12, padding: 0, overflow: "hidden" }}>
        <div className="cot-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid #F1F5F9" }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar produto" aria-label="Buscar produto" style={{ ...S.campo, flex: "1 1 180px", width: "auto", height: 40, padding: "0 12px" }} />
          {dados.categorias.length > 0 && (
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria" style={{ ...S.campo, width: "auto", height: 40, padding: "0 10px" }}>
              <option value="">Todas as categorias</option>
              {dados.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 700, color: "#334155", cursor: "pointer" }}>
            <input type="checkbox" checked={soPreciso} onChange={(e) => setSoPreciso(e.target.checked)} style={{ width: 17, height: 17, accentColor: COR }} />
            Só o que preciso comprar{precisam ? ` (${precisam})` : ""}
          </label>
          <span style={{ flex: 1 }} />
          {precisam > 0 && <button type="button" style={{ ...S.botaoPequeno, borderColor: AMBAR, color: AMBAR }} onClick={marcarOQuePrecisa}>⚡ Pôr no pedido o que está acabando</button>}
          <a href="/api/store/cotacao/comparativo?formato=xlsx" style={{ ...S.botaoPequeno, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>⬇️ Excel</a>
          <button type="button" style={S.botaoPequeno} onClick={() => window.print()}>🖨️ Imprimir</button>
        </div>

        <div className="cot-so-impressao" style={{ display: "none", padding: "8px 0", fontWeight: 900 }}>Cotação — {lojaNome} — {new Date().toLocaleDateString("pt-BR")}</div>

        <div className="cot-tabela-rolagem" style={{ overflow: "auto", maxHeight: "68vh" }}>
          <table className="cot-tabela">
            <thead>
              <tr>
                <th className="fixa" style={{ minWidth: 190 }}>Produto <span style={{ fontWeight: 600, color: "#94A3B8" }}>· {comPreco} de {dados.comparativo.linhas.length} com preço</span></th>
                {colunas.map((c) => (
                  <th key={c.id} style={{ minWidth: 118 }}>
                    <div style={{ fontWeight: 900, color: "#0F172A" }}>{c.nome}</div>
                    <div style={{ fontWeight: 600, fontSize: 11.5, color: c.respondeu === false ? AMBAR : "#94A3B8" }}>
                      {c.respondeu === true ? "✓ respondeu" : c.respondeu === false ? "⏳ aguardando" : `atualizado ${haQuanto(c.ultimaAtualizacao)}`}
                    </div>
                  </th>
                ))}
                <th className="cot-sem-impressao" style={{ minWidth: 150 }}>Comprar</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr><td colSpan={colunas.length + 2} style={{ padding: 18, color: "#64748B", textAlign: "center" }}>Nenhum produto com esse filtro.</td></tr>
              )}
              {linhas.map((l) => {
                const escolhido = fornecedorDa(l);
                const q = escolhas[l.produto.id]?.quantidade ?? "";
                const marcado = quantidadeDa(l.produto.id) > 0;
                return (
                  <tr key={l.produto.id} className={marcado ? "marcada" : ""}>
                    <td className="fixa">
                      <div style={{ fontWeight: 800, color: "#0F172A" }}>{l.produto.nome}</div>
                      <div style={{ fontSize: 11.5, color: "#64748B" }}>
                        por {l.produto.unidade}{l.produto.categoria ? ` · ${l.produto.categoria}` : ""}
                        {l.economia ? <> · <span style={{ color: VERDE, fontWeight: 800 }}>economia de {reais(l.economia)}</span></> : null}
                      </div>
                      {l.precisaComprar && (
                        <div style={{ ...S.chip, background: "#FEF3C7", color: "#92400E", marginTop: 4 }}>
                          ⚠ estoque {numero(l.produto.saldo || 0)} {l.produto.unidadeDoInsumo || ""} (mín. {numero(l.produto.minimo || 0)})
                        </div>
                      )}
                    </td>
                    {colunas.map((c) => {
                      const cel = l.precos[c.id];
                      const melhor = l.menor?.fornecedorId === c.id;
                      const selecionado = marcado && escolhido === c.id;
                      if (!cel) {
                        return (
                          <td key={c.id}>
                            <button type="button" className="cot-sem-impressao cot-vazio" title="Digitar o preço deste fornecedor"
                              onClick={() => setPrecoManual({ produtoId: l.produto.id, fornecedorId: c.id })}>+ preço</button>
                            <span className="cot-so-impressao" style={{ display: "none" }}>—</span>
                          </td>
                        );
                      }
                      return (
                        <td key={c.id}>
                          <button type="button" onClick={() => escolher(l, c.id)} title={`${cel.validade ? `Validade: ${cel.validade}. ` : ""}${cel.velho ? "Tabela antiga. " : ""}Tocar para comprar deste fornecedor`}
                            className={`cot-preco${melhor ? " melhor" : ""}${selecionado ? " escolhido" : ""}${cel.velho ? " velho" : ""}`}>
                            <span className="valor">{reais(cel.preco)}</span>
                            <span className="info">
                              {cel.variacao !== null && cel.variacao !== 0 && (
                                <span style={{ color: cel.variacao > 0 ? VERMELHO : VERDE, fontWeight: 800 }}>
                                  {cel.variacao > 0 ? "▲" : "▼"} {Math.abs(cel.variacao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                                </span>
                              )}
                              <span>{haQuanto(cel.em)}</span>
                            </span>
                            {melhor && <span className="selo">mais barato</span>}
                          </button>
                        </td>
                      );
                    })}
                    <td className="cot-sem-impressao">
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input value={q} inputMode="decimal" placeholder={l.produto.quantidadePadrao ? numero(l.produto.quantidadePadrao) : "qtd"}
                          aria-label={`Quantidade de ${l.produto.nome}`}
                          onChange={(e) => setEscolhas((x) => ({ ...x, [l.produto.id]: { fornecedorId: x[l.produto.id]?.fornecedorId ?? l.menor?.fornecedorId ?? null, quantidade: e.target.value.replace(/[^\d,.]/g, "") } }))}
                          style={{ ...S.campo, width: 70, height: 36, padding: "0 8px", textAlign: "center", borderColor: marcado ? COR : "#CBD5E1" }} />
                        <span style={{ fontSize: 12, color: "#64748B" }}>{l.produto.unidade}</span>
                      </div>
                      {marcado && (
                        <div style={{ fontSize: 11.5, marginTop: 3, color: escolhido ? "#334155" : VERMELHO, fontWeight: 700 }}>
                          {escolhido ? `de ${nomeDoFornecedor.get(escolhido)}` : "toque num preço"}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Respostas respostas={dados.respostas} nomeDoFornecedor={nomeDoFornecedor} />

      {noPedido.length > 0 && (
        <div className="cot-sem-impressao" style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 900, background: "#0F172A", color: "#fff",
          padding: "12px 16px", display: "flex", justifyContent: "center", boxShadow: "0 -8px 24px rgba(2,6,23,.25)",
        }}>
          <div style={{ width: "100%", maxWidth: 1200, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>🛒 {noPedido.length} item{noPedido.length === 1 ? "" : "s"} · {fornecedoresNoPedido.size} fornecedor{fornecedoresNoPedido.size === 1 ? "" : "es"} · {reais(totalDoPedido)}</div>
              {semFornecedor > 0 && <div style={{ fontSize: 12.5, color: "#FCD34D" }}>{semFornecedor} sem fornecedor escolhido: toque num preço na linha.</div>}
            </div>
            <button type="button" onClick={() => setEscolhas({})} style={{ ...S.botaoLeve, background: "transparent", color: "#CBD5E1", borderColor: "#475569" }}>Limpar</button>
            <button type="button" onClick={revisar} style={{ ...S.botao, background: "#22C55E", height: 46, fontSize: 15.5 }}>Revisar e enviar pedido →</button>
          </div>
        </div>
      )}

      {revisao && (
        <Revisao grupos={revisao} onFechar={() => setRevisao(null)} onAviso={onAviso}
          onEnviou={() => { setRevisao(null); setEscolhas({}); onMudou(); }} />
      )}
      {precoManual && (
        <PrecoManual alvo={precoManual} produto={dados.comparativo.linhas.find((l) => l.produto.id === precoManual.produtoId)?.produto.nome || ""}
          fornecedor={nomeDoFornecedor.get(precoManual.fornecedorId) || ""} onFechar={() => setPrecoManual(null)} onAviso={onAviso}
          onSalvou={() => { setPrecoManual(null); carregar(); }} />
      )}
      <style>{CSS_DA_TABELA}</style>
    </>
  );
}

// ─── A rodada da vez ─────────────────────────────────────────────────────

function Rodada({ dados, nomeDoFornecedor }: { dados: Dados; nomeDoFornecedor: Map<string, string> }) {
  const r = dados.rodada;
  if (!r) return null;
  const quando = new Date(r.criadaEm).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const total = r.pedidosA.length;
  const ok = r.responderam.length;
  const pct = total ? Math.round((ok / total) * 100) : 0;
  return (
    <section className="cot-sem-impressao" style={{ ...S.cartao, marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ ...S.h2, fontSize: 16 }}>Cotação de {quando}</h2>
        <span style={{ ...S.chip, background: ok === total && total ? VERDE_CLARO : COR_CLARA, color: ok === total && total ? VERDE : COR }}>{ok} de {total} responderam</span>
        {r.naFila > 0 && <span style={{ ...S.chip, background: "#F1F5F9", color: "#475569" }}>📨 enviando: faltam {r.naFila}</span>}
        {r.falharam > 0 && <span style={{ ...S.chip, background: "#FEF2F2", color: VERMELHO }} title="O WhatsApp da loja não aceitou: confira a conexão do robô">⚠ {r.falharam} não saíram</span>}
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "#F1F5F9", marginTop: 10, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${COR}, ${VERDE})`, transition: "width .4s ease" }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {r.pedidosA.map((id) => {
          const respondeu = r.responderam.includes(id);
          return (
            <span key={id} style={{ ...S.chip, background: respondeu ? VERDE_CLARO : "#FFFBEB", color: respondeu ? "#065F46" : "#92400E", fontWeight: 700 }}>
              {respondeu ? "✓" : "⏳"} {nomeDoFornecedor.get(id) || "Fornecedor"}
            </span>
          );
        })}
      </div>
      {r.resumoApos && !r.resumoEnviadoEm && (
        <div style={{ fontSize: 12.5, color: "#64748B", marginTop: 8 }}>
          O resumo vai para o seu WhatsApp às {new Date(r.resumoApos).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} (ou antes, se todos responderem).
        </div>
      )}
    </section>
  );
}

// ─── Preços em dúvida ────────────────────────────────────────────────────

function Pendentes({ pendentes, produtos, nomeDoFornecedor, onAviso, onMudou }: {
  pendentes: Pendente[]; produtos: { id: string; nome: string }[]; nomeDoFornecedor: Map<string, string>; onAviso: (a: Aviso) => void; onMudou: () => void;
}) {
  const [escolhido, setEscolhido] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aberto, setAberto] = useState(true);
  const ordenados = [...produtos].sort((a, b) => a.nome.localeCompare(b.nome));
  async function agir(p: Pendente, acao: "confirmar" | "criar" | "ignorar") {
    const produtoId = escolhido[p.id] ?? p.produtoId ?? "";
    if (acao === "confirmar" && !produtoId) return onAviso({ tipo: "atencao", titulo: "Escolha qual produto é esse." });
    setOcupado(p.id);
    try {
      await pedir("/api/store/cotacao/precos", "PUT", { id: p.id, acao, produtoId });
      if (acao === "confirmar") onAviso({ tipo: "ok", titulo: "Preço confirmado.", detalhe: `Da próxima vez, "${p.nomeLido}" entra sozinho.` });
      onMudou();
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setOcupado(null);
    }
  }
  return (
    <section className="cot-sem-impressao" style={{ ...S.cartao, marginTop: 12, borderColor: "#FDE68A", background: "#FFFDF5" }}>
      <button type="button" onClick={() => setAberto((a) => !a)} style={{ border: 0, background: "none", padding: 0, width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 20 }}>🤔</span>
        <h2 style={{ ...S.h2, fontSize: 16, flex: 1 }}>{pendentes.length} preço{pendentes.length === 1 ? "" : "s"} para você conferir</h2>
        <span style={{ color: "#92400E", fontWeight: 800, fontSize: 13 }}>{aberto ? "Esconder" : "Mostrar"}</span>
      </button>
      {aberto && (
        <>
          <p style={{ ...S.texto, fontSize: 13, marginTop: 4 }}>O fornecedor escreveu de um jeito que a loja não teve certeza de qual produto é. Confirme uma vez e ela aprende.</p>
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {pendentes.slice(0, 30).map((p) => (
              <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "#fff", border: "1px solid #FDE68A", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: "#0F172A" }}>“{p.nomeLido}” · {reais(p.preco)}{p.unidadeLida ? `/${p.unidadeLida}` : ""}</div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>{nomeDoFornecedor.get(p.fornecedorId) || "Fornecedor"} · {haQuanto(p.criadoEm)}{p.validade ? ` · ${p.validade}` : ""}</div>
                </div>
                <select value={escolhido[p.id] ?? p.produtoId ?? ""} onChange={(e) => setEscolhido((x) => ({ ...x, [p.id]: e.target.value }))}
                  aria-label="Qual produto é" style={{ ...S.campo, width: "auto", maxWidth: 230, height: 36, padding: "0 8px", fontSize: 14 }}>
                  <option value="">Qual produto é?</option>
                  {ordenados.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.id === p.produtoId ? " (sugestão)" : ""}</option>)}
                </select>
                <button type="button" disabled={ocupado === p.id} onClick={() => agir(p, "confirmar")} style={{ ...S.botaoPequeno, background: VERDE, color: "#fff", border: 0 }}>Confirmar</button>
                <button type="button" disabled={ocupado === p.id} onClick={() => agir(p, "criar")} style={S.botaoPequeno} title="Cadastrar como produto novo">+ Novo produto</button>
                <button type="button" disabled={ocupado === p.id} onClick={() => agir(p, "ignorar")} style={{ ...S.botaoPequeno, color: "#64748B" }}>Não compro</button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ─── As últimas mensagens ────────────────────────────────────────────────

function Respostas({ respostas, nomeDoFornecedor }: { respostas: Resposta[]; nomeDoFornecedor: Map<string, string> }) {
  if (!respostas.length) return null;
  const status = (r: Resposta) =>
    r.status === "LIDA" ? <span style={{ color: VERDE, fontWeight: 800 }}>{r.linhas} preço{r.linhas === 1 ? "" : "s"} lido{r.linhas === 1 ? "" : "s"}</span>
      : r.status === "LENDO" ? <span style={{ color: COR, fontWeight: 800 }}>lendo…</span>
      : r.status === "FALHOU" ? <span style={{ color: VERMELHO, fontWeight: 800 }}>não consegui ler — confira no WhatsApp</span>
      : <span style={{ color: "#94A3B8" }}>sem preço</span>;
  return (
    <details className="cot-sem-impressao" style={{ ...S.cartao, marginTop: 12 }}>
      <summary style={{ fontWeight: 800, color: "#0F172A", cursor: "pointer" }}>💬 Últimas mensagens dos fornecedores ({respostas.length})</summary>
      <div style={{ marginTop: 8 }}>
        {respostas.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid #F1F5F9", fontSize: 13.5 }}>
            <span style={{ fontSize: 18 }}>{ICONE_DA_RESPOSTA[r.tipo] || "💬"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><b>{nomeDoFornecedor.get(r.fornecedorId) || "Fornecedor"}</b> · {new Date(r.criadaEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {status(r)}</div>
              {r.texto && <div style={{ color: "#64748B", whiteSpace: "pre-line", overflow: "hidden", maxHeight: 60 }}>{r.texto.slice(0, 220)}</div>}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

// ─── Revisar e enviar ────────────────────────────────────────────────────

function Revisao({ grupos, onFechar, onAviso, onEnviou }: { grupos: Grupo[]; onFechar: () => void; onAviso: (a: Aviso) => void; onEnviou: () => void }) {
  const [textos, setTextos] = useState<Record<string, string>>(() => Object.fromEntries(grupos.map((g) => [g.fornecedor.id, g.texto])));
  const [enviando, setEnviando] = useState(false);
  const total = grupos.reduce((s, g) => s + g.total, 0);
  const abaixo = grupos.filter((g) => g.falta > 0);
  const semWhats = grupos.filter((g) => !g.telefone);
  async function enviar() {
    setEnviando(true);
    try {
      const itens = grupos.flatMap((g) => g.itens.map((i) => ({ produtoId: i.produtoId, fornecedorId: g.fornecedor.id, quantidade: i.quantidade, preco: i.preco })));
      const j = await pedir("/api/store/cotacao/pedidos", "POST", { itens, textos, enviar: true });
      onAviso({ tipo: "ok", titulo: `${j.pedidos} pedido${j.pedidos === 1 ? "" : "s"} na fila do WhatsApp da loja.`, detalhe: "Saem um de cada vez, em poucos segundos. Acompanhe na aba Pedidos." });
      onEnviou();
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para enviar", detalhe: e.message });
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Janela titulo="Revisar o pedido" subtitulo={`${grupos.length} fornecedor${grupos.length === 1 ? "" : "es"} · ${reais(total)} · confira o texto que vai para cada um`} onFechar={onFechar} largura={760}
      rodape={<>
        <button type="button" style={S.botaoLeve} onClick={onFechar} disabled={enviando}>Voltar</button>
        <button type="button" style={{ ...S.botao, background: "#16A34A" }} onClick={enviar} disabled={enviando || semWhats.length > 0}>
          {enviando ? "Enviando…" : `📨 Enviar ${grupos.length} pedido${grupos.length === 1 ? "" : "s"} pelo WhatsApp`}
        </button>
      </>}>
      {abaixo.length > 0 && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 12, padding: "10px 12px", fontSize: 13.5, marginBottom: 12 }}>
          ⚠ {abaixo.map((g) => `${g.fornecedor.nome}: faltam ${reais(g.falta)} para o mínimo de ${reais(g.fornecedor.pedidoMinimo || 0)}`).join(" · ")}. Dá para mandar assim mesmo, ou voltar e juntar mais itens.
        </div>
      )}
      {semWhats.length > 0 && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", borderRadius: 12, padding: "10px 12px", fontSize: 13.5, marginBottom: 12 }}>
          Sem WhatsApp cadastrado: {semWhats.map((g) => g.fornecedor.nome).join(", ")}. Cadastre o número na aba Fornecedores.
        </div>
      )}
      <div style={{ display: "grid", gap: 14 }}>
        {grupos.map((g) => (
          <div key={g.fornecedor.id} style={{ border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", background: "#F8FAFC" }}>
              <b style={{ fontSize: 15.5, color: "#0F172A", flex: 1 }}>{g.fornecedor.nome}</b>
              <span style={{ ...S.chip, background: COR_CLARA, color: COR }}>🚚 {g.entrega.texto}</span>
              <span style={{ ...S.chip, background: g.falta > 0 ? "#FEF3C7" : VERDE_CLARO, color: g.falta > 0 ? "#92400E" : "#065F46" }}>
                {reais(g.total)}{g.fornecedor.pedidoMinimo ? ` · mín. ${reais(g.fornecedor.pedidoMinimo)}` : ""}
              </span>
            </div>
            <div style={{ padding: "8px 12px", fontSize: 13.5 }}>
              {g.itens.map((i) => (
                <div key={i.produtoId} style={{ display: "flex", gap: 8, padding: "3px 0" }}>
                  <span style={{ flex: 1 }}>{numero(i.quantidade)} {i.unidade} · {i.nome}</span>
                  <span style={{ color: "#64748B" }}>{i.preco !== null ? `${reais(i.preco)} = ${reais(i.subtotal)}` : "sem preço"}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: "0 12px 12px" }}>
              <label style={S.rotulo}>Mensagem que vai pelo WhatsApp (pode mexer)</label>
              <textarea value={textos[g.fornecedor.id] || ""} onChange={(e) => setTextos((t) => ({ ...t, [g.fornecedor.id]: e.target.value }))} rows={Math.min(14, (textos[g.fornecedor.id] || "").split("\n").length + 1)}
                style={{ ...S.campo, fontSize: 13.5, lineHeight: 1.5, background: "#F0FDF4", borderColor: "#BBF7D0", resize: "vertical" }} />
            </div>
          </div>
        ))}
      </div>
    </Janela>
  );
}

// ─── Preço digitado à mão ────────────────────────────────────────────────

function PrecoManual({ alvo, produto, fornecedor, onFechar, onAviso, onSalvou }: {
  alvo: { produtoId: string; fornecedorId: string }; produto: string; fornecedor: string; onFechar: () => void; onAviso: (a: Aviso) => void; onSalvou: () => void;
}) {
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    const preco = lerReais(valor);
    if (preco === null) return onAviso({ tipo: "atencao", titulo: "Digite o preço, por exemplo 42,90." });
    setSalvando(true);
    try {
      await pedir("/api/store/cotacao/precos", "POST", { ...alvo, preco });
      onAviso({ tipo: "ok", titulo: "Preço anotado." });
      onSalvou();
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Janela titulo="Anotar preço" subtitulo={`${produto} · ${fornecedor}`} onFechar={onFechar} largura={420}
      rodape={<><button type="button" style={S.botaoLeve} onClick={onFechar}>Cancelar</button><button type="button" style={S.botao} onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar preço"}</button></>}>
      <p style={{ ...S.texto, marginBottom: 10 }}>O fornecedor passou por telefone ou na visita? Anote aqui e ele entra no comparativo.</p>
      <label style={S.rotulo}>Preço (R$)</label>
      <input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00"
        onKeyDown={(e) => { if (e.key === "Enter") salvar(); }} style={{ ...S.campo, fontSize: 20, fontWeight: 800 }} />
    </Janela>
  );
}

const CSS_DA_TABELA = `
.cot-tabela { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 14px; }
.cot-tabela th { position: sticky; top: 0; z-index: 2; background: #F8FAFC; text-align: left; padding: 10px 10px; font-size: 12.5px; color: #475569; border-bottom: 1px solid #E2E8F0; vertical-align: bottom; }
.cot-tabela td { padding: 6px 8px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; background: #fff; }
.cot-tabela .fixa { position: sticky; left: 0; z-index: 1; background: #fff; box-shadow: 1px 0 0 #E2E8F0; }
.cot-tabela th.fixa { z-index: 3; background: #F8FAFC; }
.cot-tabela tr.marcada td, .cot-tabela tr.marcada td.fixa { background: #FAFAFF; }
.cot-tabela tr:hover td { background: #FCFCFD; }
.cot-preco { position: relative; width: 100%; min-height: 50px; border: 1.5px solid transparent; border-radius: 10px; background: transparent; padding: 6px 8px; text-align: left; cursor: pointer; font-family: inherit; display: flex; flex-direction: column; gap: 1px; transition: border-color .15s ease, background .15s ease; }
.cot-preco:hover { border-color: #C7D2FE; background: ${COR_CLARA}; }
.cot-preco .valor { font-weight: 800; font-size: 15px; color: #0F172A; }
.cot-preco .info { display: flex; gap: 6px; font-size: 11.5px; color: #94A3B8; }
.cot-preco.melhor { background: ${VERDE_CLARO}; border-color: #A7F3D0; }
.cot-preco.melhor .valor { color: ${VERDE}; }
.cot-preco .selo { position: absolute; top: -7px; right: 6px; font-size: 10px; font-weight: 900; background: ${VERDE}; color: #fff; border-radius: 999px; padding: 1px 6px; }
.cot-preco.escolhido { border-color: ${COR}; box-shadow: 0 0 0 2px ${COR} inset; }
.cot-preco.velho { opacity: .5; }
.cot-vazio { width: 100%; min-height: 50px; border: 1.5px dashed #E2E8F0; border-radius: 10px; background: none; color: #CBD5E1; font-weight: 700; cursor: pointer; font-family: inherit; font-size: 12px; }
.cot-vazio:hover { color: ${COR}; border-color: #C7D2FE; }
@media print {
  .cot-so-impressao { display: block !important; }
  .cot-tabela th, .cot-tabela .fixa { position: static !important; }
  .cot-preco { min-height: 0; border: 0 !important; box-shadow: none !important; }
  .cot-preco .selo { position: static; }
}
`;

