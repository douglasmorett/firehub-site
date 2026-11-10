"use client";
import React, { useMemo, useState } from "react";
import { basesDeComplementos, opcoesDaBase, type BaseDeComplementos, type OpcaoDaBase } from "@/lib/bases-de-complementos";
import { destinosDaPergunta, tituloNormalizado } from "@/lib/copiar-pergunta";

const campo: React.CSSProperties = { padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: 8, font: "inherit", minWidth: 0 };
const botao: React.CSSProperties = { ...campo, background: "#fff", cursor: "pointer", fontWeight: 700 };
const preco = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export default function GruposDeComplementos({ produtos, catalogo, busca, categoria, onCriar, onEditarProduto, onEditarOpcao, onFeito }: {
  produtos: any[]; catalogo: any[]; busca: string; categoria: string;
  onCriar: () => void; onEditarProduto: (p: any) => void; onEditarOpcao: (p: any) => void; onFeito: (texto: string) => void;
}) {
  const bases = useMemo(() => basesDeComplementos(produtos), [produtos]);
  const [editando, setEditando] = useState<BaseDeComplementos | null>(null);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = bases.filter(b => b.membros.some(m =>
    (categoria === "TODAS" || tituloNormalizado(m.produto.category) === tituloNormalizado(categoria)) &&
    (!termo || `${b.titulo} ${m.produto.name} ${(m.grupo.items || []).map(i => i.menuProduct?.name || "").join(" ")}`.toLocaleLowerCase("pt-BR").includes(termo))));
  return <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 16, padding: 20 }}>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between", marginBottom: 18 }}>
      <div><h3 style={{ margin: 0 }}>Grupos de complementos</h3><p style={{ fontSize: 13, color: "#64748B", marginBottom: 0 }}>Edite as opções e os preços em conjunto. Mínimo, máximo e obrigatoriedade continuam próprios de cada produto.</p></div>
      <button type="button" style={botao} onClick={onCriar}>＋ Criar grupo de complementos</button>
    </div>
    {!visiveis.length && <p>Nenhum grupo encontrado.</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 12 }}>
      {visiveis.map(b => <article key={b.chave} style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: 16 }}>
        <h4 style={{ margin: "0 0 7px" }}>🧩 {b.titulo}</h4>
        <div style={{ fontSize: 13, color: "#475569" }}>{b.membros.length} {b.membros.length === 1 ? "produto vinculado" : "produtos vinculados"} · {b.membros[0].grupo.items?.length || 0} opções</div>
        <p style={{ fontSize: 12, color: "#64748B", margin: "8px 0" }}>{b.membros.slice(0, 4).map(m => m.produto.name).join(", ")}{b.membros.length > 4 ? ` e mais ${b.membros.length - 4}` : ""}</p>
        <button type="button" style={botao} onClick={() => b.editavel ? setEditando(b) : onEditarProduto(b.membros[0].produto)}>{b.editavel ? "Editar grupo e produtos" : "Editar no produto"}</button>
      </article>)}
    </div>
    {editando && <Editor key={editando.chave} base={editando} produtos={produtos} catalogo={catalogo} onFechar={() => setEditando(null)} onEditarOpcao={p => { setEditando(null); onEditarOpcao(p); }} onFeito={texto => { setEditando(null); onFeito(texto); }} />}
  </div>;
}

export function Editor({ base, produtos, catalogo, onFechar, onEditarOpcao, onFeito }: {
  base: BaseDeComplementos; produtos: any[]; catalogo: any[]; onFechar: () => void; onEditarOpcao: (p: any) => void; onFeito: (t: string) => void;
}) {
  const anchor = base.membros[0];
  const [titulo, setTitulo] = useState(base.titulo);
  const [opcoes, setOpcoes] = useState(opcoesDaBase(anchor.grupo));
  const [marcados, setMarcados] = useState(new Set(base.membros.map(m => m.produto.id)));
  const [regras, setRegras] = useState<Record<string, { minQty: number | null; maxQty: number }>>(Object.fromEntries(base.membros.map(m => [m.produto.id, { minQty: m.grupo.minQty ?? null, maxQty: m.grupo.maxQty || 1 }])));
  const [busca, setBusca] = useState("");
  const [novaOpcao, setNovaOpcao] = useState("");
  const [erro, setErro] = useState("");
  const [gravando, setGravando] = useState(false);
  const destinos = destinosDaPergunta(produtos, anchor.produto, anchor.grupo);
  const candidatos = [...new Map([...base.membros.map(m => m.produto), ...destinos.mesmaCategoria.map(d => d.produto), ...destinos.outras.map(d => d.produto)].map(p => [p.id, p])).values()];
  const existentes = new Set(base.membros.map(m => m.produto.id));
  const opcoesPorId = new Map(catalogo.map(p => [p.id, p]));
  const mudarOpcao = (id: string, patch: Partial<OpcaoDaBase>) => setOpcoes(antes => antes.map(i => i.menuProductId === id ? { ...i, ...patch } : i));
  const regra = (id: string) => regras[id] ?? { minQty: anchor.grupo.minQty ?? null, maxQty: anchor.grupo.maxQty || 1 };
  const salvar = async () => {
    if (gravando) return;
    if (!titulo.trim() || !marcados.size || !opcoes.length) { setErro("Informe o nome, as opções e pelo menos um produto."); return; }
    setGravando(true); setErro("");
    try {
      const r = await fetch("/api/admin/menu-products/base-de-complementos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        grupoId: anchor.grupo.id, revisao: base.revisao, titulo, opcoes,
        produtoIds: [...marcados], regras: [...marcados].map(produtoId => ({ produtoId, ...regra(produtoId) })),
      }) });
      const dados = await r.json().catch(() => null);
      if (!r.ok) { setErro(dados?.error || "Não foi possível salvar."); return; }
      onFeito(`✅ Grupo salvo em ${marcados.size} produtos${dados.removidos ? ` · removido de ${dados.removidos}` : ""}`);
    } catch { setErro("Sem conexão. Confira antes de tentar novamente."); }
    finally { setGravando(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label={`Editar grupo ${base.titulo}`} style={{ position: "fixed", inset: 0, background: "#0F172ACC", zIndex: 1400, display: "flex", justifyContent: "center", alignItems: "center", padding: 12 }}>
    <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 900, maxHeight: "94vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: 18, borderBottom: "1px solid #E2E8F0", gap: 12 }}><h3 style={{ margin: 0 }}>Editar grupo de complementos</h3><button aria-label="Fechar grupo" type="button" style={botao} disabled={gravando} onClick={onFechar}>✕</button></div>
      <div style={{ overflowY: "auto", padding: 18 }}>
        <label style={{ display: "block" }}>Nome do grupo<input aria-label="Nome do grupo" style={{ ...campo, display: "block", width: "100%", marginTop: 5 }} value={titulo} onChange={e => setTitulo(e.target.value)} /></label>
        <h4>Opções e preços em conjunto</h4><p style={{ fontSize: 12, color: "#64748B" }}>Os valores abaixo serão usados em todos os produtos marcados. A edição do cadastro da opção vale em todos os seus usos.</p>
        {opcoes.map(i => {
          const produto = opcoesPorId.get(i.menuProductId);
          return <div key={i.menuProductId} style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}><strong style={{ flex: 1 }}>{produto?.name || i.menuProductId}{produto?.active === false ? " · Pausado" : ""}</strong>
              {produto && <button type="button" style={{ ...botao, fontSize: 11 }} onClick={() => onEditarOpcao(produto)}>Editar cadastro</button>}
              <button type="button" style={{ ...botao, fontSize: 11, color: "#B91C1C" }} onClick={() => setOpcoes(antes => antes.filter(o => o.menuProductId !== i.menuProductId))}>Tirar do grupo</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{([['additionalPrice', 'Acréscimo'], ['additionalPriceSalao', 'Salão'], ['additionalPriceDelivery', 'Delivery'], ['additionalPriceTotem', 'Totem'], ['promoAdditionalPrice', 'Promoção']] as const).map(([chave, rotulo]) =>
              <label key={chave} style={{ fontSize: 11, flex: "1 1 100px", maxWidth: 145 }}>{rotulo}<input aria-label={`${rotulo} de ${produto?.name || i.menuProductId}`} type="number" min="0" step="0.01" placeholder={chave === 'additionalPrice' ? '0,00' : 'Padrão'} style={{ ...campo, width: "100%", display: "block", marginTop: 3 }} value={i[chave] ?? ""} onChange={e => mudarOpcao(i.menuProductId, { [chave]: e.target.value === "" && chave !== 'additionalPrice' ? null : Number(e.target.value) })} /></label>
            )}</div>
          </div>;
        })}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><select aria-label="Adicionar opção existente" style={{ ...campo, flex: 1 }} value={novaOpcao} onChange={e => setNovaOpcao(e.target.value)}><option value="">Escolha uma opção existente…</option>{catalogo.filter(p => p.franchiseeId === anchor.produto.franchiseeId && !opcoes.some(i => i.menuProductId === p.id) && !marcados.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button type="button" style={botao} disabled={!novaOpcao} onClick={() => { setOpcoes(antes => [...antes, { menuProductId: novaOpcao, additionalPrice: Number(opcoesPorId.get(novaOpcao)?.price) || 0, additionalPriceSalao: null, additionalPriceDelivery: null, additionalPriceTotem: null, promoAdditionalPrice: null, maxPerItem: null, optionNote: null, precoPorEscolha: null, sortOrder: antes.length }]); setNovaOpcao(""); }}>Adicionar opção</button>
        </div>
        <h4>Produtos vinculados ({marcados.size})</h4><p style={{ fontSize: 12, color: "#64748B" }}>Marque para usar; desmarque para retirar a pergunta deste produto. Ajuste as regras na própria linha.</p>
        <input aria-label="Buscar produtos vinculados" placeholder="Buscar produto ou categoria…" style={{ ...campo, width: "100%", marginBottom: 10 }} value={busca} onChange={e => setBusca(e.target.value)} />
        {candidatos.filter(p => `${p.name} ${p.category}`.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR'))).map(p => {
          const conflito = !existentes.has(p.id) && (p.comboGroups || []).some((g: any) => tituloNormalizado(g.title) === tituloNormalizado(titulo));
          const bloqueado = conflito || opcoes.some(i => i.menuProductId === p.id);
          const r = regra(p.id);
          return <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 230px", fontSize: 13 }}><input aria-label={`Usar em ${p.name}`} type="checkbox" checked={marcados.has(p.id)} disabled={bloqueado} onChange={() => setMarcados(antes => { const novo = new Set(antes); novo.has(p.id) ? novo.delete(p.id) : novo.add(p.id); return novo; })} /><span>{p.name}<small style={{ display: "block", color: "#64748B" }}>{conflito ? "Já tem outra versão deste grupo" : p.category}</small></span></label>
            {marcados.has(p.id) && <><label style={{ fontSize: 11 }}>Mínimo<input aria-label={`Mínimo de ${p.name}`} type="number" min="0" style={{ ...campo, width: 65, display: "block" }} value={r.minQty ?? r.maxQty} onChange={e => setRegras(antes => ({ ...antes, [p.id]: { ...r, minQty: Number(e.target.value) } }))} /></label><label style={{ fontSize: 11 }}>Máximo<input aria-label={`Máximo de ${p.name}`} type="number" min="1" style={{ ...campo, width: 65, display: "block" }} value={r.maxQty} onChange={e => setRegras(antes => ({ ...antes, [p.id]: { ...r, maxQty: Number(e.target.value) } }))} /></label><span style={{ fontSize: 11, width: 70 }}>{(r.minQty ?? r.maxQty) > 0 ? "Obrigatória" : "Opcional"}</span></>}
          </div>;
        })}
      </div>
      <div style={{ padding: 16, borderTop: "1px solid #E2E8F0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>{erro && <div role="alert" style={{ flex: "1 1 100%", color: "#B91C1C", fontSize: 13 }}>{erro}</div>}<span style={{ fontSize: 12 }}>{opcoes.length} opções · {marcados.size} produtos</span><button type="button" style={botao} disabled={gravando} onClick={onFechar}>Cancelar</button><button type="button" style={{ ...botao, color: "white", background: "#0F766E" }} disabled={gravando} onClick={salvar}>{gravando ? "Salvando…" : "Salvar grupo e vínculos"}</button></div>
    </div>
  </div>;
}
