"use client";
/**
 * USAR UMA PERGUNTA EM OUTROS PRODUTOS — as duas portas da tela.
 *
 *   - UsarPerguntaEmOutros: no painel 🧩 Complementos, leva a pergunta pronta
 *     para vários produtos de uma vez (grava na hora, pela rota
 *     api/admin/menu-products/copiar-pergunta).
 *   - TrazerPerguntaDeOutro: no formulário do produto, traz a pergunta de
 *     outro produto para a lista que está sendo editada (grava no "Salvar" de
 *     sempre).
 *
 * As regras (o que não se copia, para onde pode ir, o que vai junto) estão em
 * src/lib/copiar-pergunta.ts — as mesmas que a rota confere.
 */
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  copiaDoGrupo,
  destinosDaPergunta,
  motivoParaNaoCopiar,
  tituloNormalizado,
  type CopiaDaPergunta,
  type PerguntaParaCopiar,
  type PosicaoDaCopia,
  type ProdutoParaCopiar,
  type SeJaTiver,
} from "@/lib/copiar-pergunta";
import { ehProdutoDeIntegracao } from "@/lib/cardapio-interno";

/** "Obrigatória · 1 escolha", "Opcional · até 4" — o mesmo texto do painel 🧩. */
function regraDaPergunta(g: PerguntaParaCopiar): string {
  const max = Number(g.maxQty) || 1;
  const minimo = g.minQty === null || g.minQty === undefined ? max : Number(g.minQty);
  if (minimo <= 0) return `Opcional · até ${max}`;
  if (minimo === max) return max === 1 ? "Obrigatória · 1 escolha" : `Obrigatória · exatamente ${max}`;
  return `Obrigatória · de ${minimo} a ${max}`;
}

const opcoes = (n: number) => `${n} ${n === 1 ? "opção" : "opções"}`;

const fundo: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", backdropFilter: "blur(6px)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
};
const caixa: React.CSSProperties = {
  background: "#FFF", borderRadius: "18px", width: "100%", maxWidth: "560px", maxHeight: "90vh",
  display: "flex", flexDirection: "column", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4)", border: "1px solid #E2E8F0",
};
const botaoFechar: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%", border: "none", background: "#F1F5F9", color: "#64748B",
  cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};
const selo = (cor: string, fundoSelo: string): React.CSSProperties => ({
  fontSize: "0.64rem", fontWeight: 800, color: cor, background: fundoSelo, padding: "1px 7px", borderRadius: "20px", whiteSpace: "nowrap",
});

function Escolha<T extends string>({ valor, atual, onEscolher, children }: { valor: T; atual: T; onEscolher: (v: T) => void; children: React.ReactNode }) {
  const marcado = valor === atual;
  return (
    <button
      type="button"
      onClick={() => onEscolher(valor)}
      style={{
        padding: "6px 12px", borderRadius: "20px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer",
        border: `1.5px solid ${marcado ? "#0F766E" : "#E2E8F0"}`, background: marcado ? "#F0FDFA" : "#FFF", color: marcado ? "#0F766E" : "#475569",
      }}
    >
      {children}
    </button>
  );
}

export default function UsarPerguntaEmOutros({ grupo, origem, produtos, onFechar, onFeito }: {
  grupo: PerguntaParaCopiar & { id: string };
  origem: ProdutoParaCopiar;
  /** O cardápio que a tela já tem (com as perguntas de cada produto). */
  produtos: ProdutoParaCopiar[];
  onFechar: () => void;
  /** Gravou: a tela mostra o aviso e recarrega o cardápio. */
  onFeito: (texto: string) => void;
}) {
  const trava = motivoParaNaoCopiar(grupo, origem);
  const destinos = useMemo(() => destinosDaPergunta(produtos, origem, grupo), [produtos, origem, grupo]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [verOutras, setVerOutras] = useState(false);
  const [seJaTiver, setSeJaTiver] = useState<SeJaTiver>("pular");
  const [posicao, setPosicao] = useState<PosicaoDaCopia>("fim");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const visiveis = verOutras ? [...destinos.mesmaCategoria, ...destinos.outras] : destinos.mesmaCategoria;
  const todosMarcados = visiveis.length > 0 && visiveis.every((d) => marcados.has(d.produto.id));
  const marcadosQueJaTem = [...destinos.mesmaCategoria, ...destinos.outras].filter((d) => d.jaTem && marcados.has(d.produto.id)).length;

  const alternar = (id: string) => setMarcados((antes) => {
    const novo = new Set(antes);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });
  const alternarTodos = () => setMarcados((antes) => {
    const novo = new Set(antes);
    for (const d of visiveis) { if (todosMarcados) novo.delete(d.produto.id); else novo.add(d.produto.id); }
    return novo;
  });

  // Outras categorias aparecem agrupadas, na ordem em que surgem no cardápio.
  const porCategoria = useMemo(() => {
    const mapa = new Map<string, typeof destinos.outras>();
    for (const d of destinos.outras) {
      const cat = String(d.produto.category || "Sem categoria").trim();
      mapa.set(cat, [...(mapa.get(cat) || []), d]);
    }
    return [...mapa.entries()];
  }, [destinos]);

  const confirmar = async () => {
    if (marcados.size === 0 || gravando) return;
    setGravando(true); setErro(null);
    try {
      const res = await fetch("/api/admin/menu-products/copiar-pergunta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grupoId: grupo.id, destinoIds: [...marcados], seJaTiver, posicao }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) { setErro(dados?.error || "Não deu para copiar a pergunta. Tente de novo."); return; }
      const n = Number(dados?.copiados) || 0;
      const m = Number(dados?.pulados) || 0;
      const recusados = Array.isArray(dados?.recusados) ? dados.recusados.length : 0;
      onFeito(
        `✅ Pergunta adicionada a ${n} ${n === 1 ? "produto" : "produtos"}` +
        (m > 0 ? ` (${m} ${m === 1 ? "pulado" : "pulados"})` : "") +
        (recusados > 0 ? ` · ${recusados} não ${recusados === 1 ? "pôde" : "puderam"} receber` : "")
      );
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setGravando(false);
    }
  };

  const linha = (d: { produto: ProdutoParaCopiar; jaTem: boolean }) => {
    const marcado = marcados.has(d.produto.id);
    return (
      <label key={d.produto.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px", borderRadius: "10px", cursor: "pointer", background: marcado ? "#F0FDFA" : "#FFF", border: `1px solid ${marcado ? "#99F6E4" : "#E2E8F0"}` }}>
        <input type="checkbox" checked={marcado} onChange={() => alternar(d.produto.id)} style={{ width: 16, height: 16, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: "0.84rem", fontWeight: 700, color: d.produto.active === false ? "#94A3B8" : "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.produto.name}
        </span>
        {d.produto.active === false && <span style={selo("#B45309", "#FEF3C7")}>Pausado</span>}
        {d.jaTem && <span title="Este produto já tem uma pergunta com este título" style={selo("#1D4ED8", "#DBEAFE")}>já tem uma pergunta “{grupo.title}”</span>}
      </label>
    );
  };

  return (
    <div style={{ ...fundo, zIndex: 99999 }} onClick={onFechar}>
      <div style={caixa} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "16px 18px 12px", borderBottom: "1px solid #F1F5F9" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#0F766E", background: "#F0FDFA", padding: "2px 9px", borderRadius: "20px" }}>📋 Usar em outros produtos</span>
            <h3 style={{ margin: "6px 0 2px", fontSize: "1.05rem", fontWeight: 800, color: "#0F172A" }}>{grupo.title}</h3>
            <p style={{ margin: 0, fontSize: "0.76rem", color: "#64748B" }}>
              {regraDaPergunta(grupo)} · {opcoes((grupo.items || []).length)} · de <strong>{origem.name}</strong>
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={botaoFechar}><X size={16} /></button>
        </div>

        {trava ? (
          <div style={{ padding: "16px 18px" }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#7C2D12", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: "10px", padding: "10px 12px", lineHeight: 1.5 }}>
              ⚠️ Esta pergunta não pode ser copiada. {trava}
            </p>
          </div>
        ) : (
          <>
            <div style={{ padding: "12px 18px", overflowY: "auto", flex: 1 }}>
              <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "#475569", lineHeight: 1.5 }}>
                A pergunta vai com as <strong>mesmas opções e preços</strong>. As opções são as mesmas: pausar uma pausa em todos os produtos.
              </p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", margin: "10px 0 6px" }}>
                <span style={{ fontSize: "0.76rem", fontWeight: 800, color: "#334155" }}>
                  {verOutras ? "Produtos do cardápio" : `Produtos de “${String(origem.category || "").trim() || "Sem categoria"}”`}
                </span>
                {visiveis.length > 0 && (
                  <button type="button" onClick={alternarTodos} style={{ background: "none", border: "none", color: "#0F766E", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", padding: 0 }}>
                    {todosMarcados ? "Desmarcar todos" : "Selecionar todos"}
                  </button>
                )}
              </div>

              <div style={{ display: "grid", gap: "5px" }}>
                {destinos.mesmaCategoria.length === 0 && (
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#94A3B8", fontStyle: "italic" }}>Nenhum outro produto nesta categoria.</p>
                )}
                {destinos.mesmaCategoria.map(linha)}
                {verOutras && porCategoria.map(([cat, lista]) => (
                  <div key={cat} style={{ display: "grid", gap: "5px", marginTop: "6px" }}>
                    <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.4px" }}>{cat}</span>
                    {lista.map(linha)}
                  </div>
                ))}
              </div>

              {destinos.outras.length > 0 && (
                <button type="button" onClick={() => {
                  // Escondidas não seguem marcadas: o botão contaria produto que o lojista não vê.
                  if (verOutras) setMarcados((antes) => new Set([...antes].filter((id) => destinos.mesmaCategoria.some((d) => d.produto.id === id))));
                  setVerOutras((v) => !v);
                }} style={{ marginTop: "10px", background: "none", border: "none", color: "#475569", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                  {verOutras ? "Esconder outras categorias" : `Mostrar outras categorias (${destinos.outras.length})`}
                </button>
              )}
              {destinos.bloqueados.length > 0 && (
                <p style={{ margin: "8px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>
                  {destinos.bloqueados.length} {destinos.bloqueados.length === 1 ? "item não aparece" : "itens não aparecem"} aqui: opções de combo e produtos de integração não recebem pergunta.
                </p>
              )}

              {marcadosQueJaTem > 0 && (
                <div style={{ marginTop: "14px" }}>
                  <span style={{ display: "block", fontSize: "0.76rem", fontWeight: 800, color: "#334155", marginBottom: "6px" }}>
                    {marcadosQueJaTem} {marcadosQueJaTem === 1 ? "produto já tem" : "produtos já têm"} uma pergunta “{grupo.title}”:
                  </span>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <Escolha valor="pular" atual={seJaTiver} onEscolher={setSeJaTiver}>Pular esses</Escolha>
                    <Escolha valor="substituir" atual={seJaTiver} onEscolher={setSeJaTiver}>Substituir pela desta</Escolha>
                  </div>
                </div>
              )}

              <div style={{ marginTop: "14px" }}>
                <span style={{ display: "block", fontSize: "0.76rem", fontWeight: 800, color: "#334155", marginBottom: "6px" }}>Onde a pergunta entra:</span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <Escolha valor="fim" atual={posicao} onEscolher={setPosicao}>No fim</Escolha>
                  <Escolha valor="inicio" atual={posicao} onEscolher={setPosicao}>No começo</Escolha>
                </div>
              </div>

              {erro && (
                <p style={{ margin: "12px 0 0", fontSize: "0.8rem", fontWeight: 700, color: "#C92E09" }}>⚠️ {erro}</p>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px", padding: "12px 18px 16px", borderTop: "1px solid #F1F5F9" }}>
              <button type="button" onClick={onFechar} style={{ flex: 1, padding: "10px", borderRadius: "10px", background: "#F1F5F9", color: "#64748B", border: "none", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={marcados.size === 0 || gravando}
                style={{ flex: 2, padding: "10px", borderRadius: "10px", background: "#0F766E", color: "#FFF", border: "none", fontWeight: 800, fontSize: "0.85rem", cursor: marcados.size === 0 || gravando ? "default" : "pointer", opacity: marcados.size === 0 || gravando ? 0.5 : 1 }}
              >
                {gravando ? "Copiando..." : marcados.size === 0 ? "Escolha os produtos" : `Adicionar a ${marcados.size} ${marcados.size === 1 ? "produto" : "produtos"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "Trazer pergunta de outro produto", dentro do formulário. Só monta a cópia
 * (copiaDoGrupo) e a entrega; quem grava é o "Salvar" do formulário, pelo PUT
 * de sempre — o lojista ainda pode mudar a pergunta antes.
 */
export function TrazerPerguntaDeOutro({ produtos, produtoAtualId, franchiseeId, titulosJaUsados, onEscolher, onFechar }: {
  produtos: ProdutoParaCopiar[];
  /** O produto aberto no formulário (nulo no cadastro novo): não oferece as próprias perguntas. */
  produtoAtualId: string | null;
  /** Loja do produto aberto, quando se sabe: o ADMIN em "todas" vê o cardápio de todas. */
  franchiseeId?: string | null;
  titulosJaUsados: string[];
  onEscolher: (copia: CopiaDaPergunta) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const usados = useMemo(() => new Set(titulosJaUsados.map(tituloNormalizado)), [titulosJaUsados]);
  const lista = useMemo(() => {
    const termo = tituloNormalizado(busca);
    const saida: { produto: ProdutoParaCopiar; grupo: PerguntaParaCopiar }[] = [];
    for (const p of produtos) {
      if (p.id === produtoAtualId) continue;
      if (franchiseeId && p.franchiseeId !== franchiseeId) continue;
      if (ehProdutoDeIntegracao(p.category, p.id, p.active)) continue;
      for (const g of p.comboGroups || []) {
        if (motivoParaNaoCopiar(g, p)) continue;
        if (termo && !tituloNormalizado(g.title).includes(termo) && !tituloNormalizado(p.name).includes(termo)) continue;
        saida.push({ produto: p, grupo: g });
      }
    }
    return saida;
  }, [produtos, produtoAtualId, franchiseeId, busca]);

  return (
    // Acima do formulário do produto (zIndex 99999).
    <div style={{ ...fundo, zIndex: 100001 }} onClick={onFechar}>
      <div style={caixa} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "16px 18px 12px", borderBottom: "1px solid #F1F5F9" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: "1.02rem", fontWeight: 800, color: "#0F172A" }}>Trazer pergunta de outro produto</h3>
            <p style={{ margin: "3px 0 0", fontSize: "0.76rem", color: "#64748B" }}>Vem com as mesmas opções e preços. Você ainda pode mudar antes de salvar.</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={botaoFechar}><X size={16} /></button>
        </div>
        <div style={{ padding: "12px 18px 4px" }}>
          <input
            autoFocus
            className="input-field"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pela pergunta ou pelo produto"
          />
        </div>
        <div style={{ padding: "8px 18px 16px", overflowY: "auto", flex: 1, display: "grid", gap: "5px", alignContent: "start" }}>
          {lista.length === 0 && (
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#94A3B8", fontStyle: "italic" }}>
              {busca.trim() ? "Nenhuma pergunta encontrada." : "Nenhum outro produto tem pergunta que possa ser copiada."}
            </p>
          )}
          {lista.map(({ produto, grupo }) => (
            <button
              key={`${produto.id}-${grupo.id}`}
              type="button"
              onClick={() => onEscolher(copiaDoGrupo(grupo))}
              style={{ textAlign: "left", padding: "8px 12px", borderRadius: "10px", border: "1px solid #E2E8F0", background: "#F8FAFC", cursor: "pointer", display: "grid", gap: "2px" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.86rem", fontWeight: 800, color: "#0F172A" }}>{grupo.title}</span>
                {usados.has(tituloNormalizado(grupo.title)) && <span style={selo("#1D4ED8", "#DBEAFE")}>este produto já tem</span>}
              </span>
              <span style={{ fontSize: "0.72rem", color: "#64748B" }}>
                {produto.name} · {regraDaPergunta(grupo)} · {opcoes((grupo.items || []).length)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
