"use client";
import { useEffect, useMemo, useState } from "react";

/**
 * Lista dos itens das integrações e o vínculo de cada um com o produto real.
 * Busca tudo em /api/store/cardapio/integracoes (GET), grava com PATCH e
 * desfaz com DELETE — a lista se atualiza no lugar, sem recarregar a página.
 */

type Item = {
  id: string;
  name: string;
  origemIntegracao: string | null;
  codigoExterno: string | null;
  category: string;
  vinculadoA: string | null;
  nomeVinculado: string | null;
  pedidos60d: number;
};
type Produto = { id: string; name: string; category: string };

const ROTA = "/api/store/cardapio/integracoes";

/** Como o selo mostra cada origem (`ORIGENS` em lib/espelho-de-integracao.ts). */
const NOME_DA_ORIGEM: Record<string, string> = {
  IFOOD: "iFood", "99FOOD": "99Food", KEETA: "Keeta", AIQFOME: "aiqfome", ANOTAAI: "Anota AI",
  CARDAPIOWEB: "CardápioWeb", WABIZ: "Wabiz", BRENDI: "Brendi", JOTAJA: "JotaJá", RESTAURADO: "Restaurado",
};

export default function ListaDeIntegracoes() {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => {
    fetch(ROTA)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setItens(d.itens);
        setProdutos(d.produtos);
      })
      .catch((e) => setErro(e.message || "Não deu para carregar os itens"));
  }, []);

  // O filtro de texto reduz as opções de TODOS os selects de uma vez: a loja
  // digita "x-salada" e só sobram os x-salada para escolher em cada linha.
  const opcoes = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    return t ? produtos.filter((p) => p.name.toLowerCase().includes(t) || p.category.toLowerCase().includes(t)) : produtos;
  }, [produtos, filtro]);

  async function chamar(metodo: "PATCH" | "DELETE", body: object) {
    const r = await fetch(ROTA, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Não deu para salvar");
    return d;
  }

  async function vincular(item: Item) {
    const produtoId = escolha[item.id];
    if (!produtoId) return;
    setSalvando(item.id);
    setErro("");
    try {
      const d = await chamar("PATCH", { espelhoId: item.id, produtoId });
      setItens((lista) => (lista || []).map((i) => (i.id === item.id ? { ...i, vinculadoA: produtoId, nomeVinculado: d.nomeVinculado } : i)));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(null);
    }
  }

  async function desfazer(item: Item) {
    setSalvando(item.id);
    setErro("");
    try {
      await chamar("DELETE", { espelhoId: item.id });
      setItens((lista) => (lista || []).map((i) => (i.id === item.id ? { ...i, vinculadoA: null, nomeVinculado: null } : i)));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(null);
    }
  }

  if (erro && !itens) return <p style={{ color: "#B91C1C" }}>{erro}</p>;
  if (!itens) return <p className="text-muted">Carregando…</p>;
  if (itens.length === 0) return <p className="text-muted">Nenhum item de integração sem vínculo.</p>;

  return (
    <div>
      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Filtrar os produtos do seu cardápio…"
        style={{ width: "100%", maxWidth: 420, padding: "8px 12px", borderRadius: 10, border: "1px solid #CBD5E1", fontSize: "0.9rem", marginBottom: "1rem" }}
      />
      {erro && <p style={{ color: "#B91C1C", margin: "0 0 0.75rem" }}>{erro}</p>}

      <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, background: "#FFF", overflow: "hidden" }}>
        {itens.map((item, i) => {
          const ocupado = salvando === item.id;
          return (
            <div key={item.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: i ? "1px solid #F1F5F9" : "none" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: "#F1F5F9", color: "#334155", flexShrink: 0 }}>
                {NOME_DA_ORIGEM[item.origemIntegracao || ""] || item.origemIntegracao}
              </span>
              <span style={{ flex: "1 1 200px", minWidth: 0, fontWeight: 600, color: "#1E293B", fontSize: "0.92rem" }}>
                {item.name}
                <span className="text-muted" style={{ fontWeight: 400, fontSize: "0.8rem", marginLeft: 8 }}>
                  {item.pedidos60d} pedido{item.pedidos60d === 1 ? "" : "s"} em 60 dias
                </span>
              </span>

              {item.vinculadoA ? (
                <>
                  <span style={{ fontSize: "0.9rem", color: "#15803D", fontWeight: 700 }}>→ {item.nomeVinculado || "produto removido"}</span>
                  <button type="button" onClick={() => desfazer(item)} disabled={ocupado} className="btn btn-outline" style={{ fontSize: "0.8rem", padding: "4px 10px", color: "#64748B", borderColor: "#CBD5E1" }}>
                    Desfazer
                  </button>
                </>
              ) : (
                <>
                  <select
                    value={escolha[item.id] || ""}
                    onChange={(e) => setEscolha((s) => ({ ...s, [item.id]: e.target.value }))}
                    style={{ flex: "1 1 220px", maxWidth: 320, padding: "6px 8px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }}
                  >
                    <option value="">Qual produto seu é este?</option>
                    {opcoes.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — {p.category}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => vincular(item)} disabled={ocupado || !escolha[item.id]} className="btn btn-primary" style={{ fontSize: "0.8rem", padding: "4px 12px" }}>
                    {ocupado ? "Salvando…" : "Vincular"}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
