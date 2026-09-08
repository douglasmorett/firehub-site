"use client";

import { useState } from "react";

/**
 * Kanban de mentira para testar a extensão sem ter loja.
 *
 * O que importa aqui é a ESTRUTURA, não a beleza: cada coluna tem um
 * cabeçalho com o nome e um contador, e os cards são irmãos dentro de um
 * contêiner. É assim que o painel de um sistema de verdade é montado, e é
 * disso que o leitor da extensão precisa para marcar e contar.
 */

const NOMES = ["Ana", "Lucas", "Bia", "Caio", "Dani", "Edu", "Flávia", "Gui", "Hugo", "Ivo", "Júlia", "Kau", "Lia", "Nina", "Otto", "Paulo"];
const ITENS = ["X-burguer", "Pastel de carne", "Esfiha de queijo", "Combo família", "Pizza calabresa", "Açaí 500ml", "Coxinha", "Batata frita"];

type Pedido = { n: number; nome: string; item: string };

function criar(n: number, base: number): Pedido[] {
  return Array.from({ length: n }, (_, i) => ({
    n: base + i,
    nome: NOMES[(base + i) % NOMES.length],
    item: ITENS[(base + i) % ITENS.length],
  }));
}

export default function KanbanDeDemonstracao() {
  const [novos, setNovos] = useState<Pedido[]>(criar(2, 40));
  const [preparo, setPreparo] = useState<Pedido[]>(criar(4, 10));
  const [entrega, setEntrega] = useState<Pedido[]>(criar(3, 70));

  const proximo = () => 100 + preparo.length + novos.length + entrega.length;

  const coluna: React.CSSProperties = {
    background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 12,
    padding: 10, minWidth: 230, flex: 1, minHeight: 340,
  };
  const cabecalho: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    fontWeight: 800, fontSize: ".92rem", marginBottom: 10,
  };
  const contador: React.CSSProperties = {
    background: "#0F172A", color: "#fff", borderRadius: 999,
    minWidth: 24, height: 24, display: "grid", placeItems: "center", fontSize: ".78rem", fontWeight: 800,
  };
  const cartao: React.CSSProperties = {
    background: "#fff", border: "1px solid #E2E8F0", borderRadius: 9,
    padding: "8px 10px", marginBottom: 7, fontSize: ".85rem", lineHeight: 1.35,
  };
  const botao = (fundo: string): React.CSSProperties => ({
    background: fundo, color: "#fff", border: "none", borderRadius: 9,
    padding: "9px 16px", fontWeight: 800, fontSize: ".88rem", cursor: "pointer",
  });

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", background: "#F8FAFC", minHeight: "100vh", color: "#0F172A" }}>
      <div style={{ background: "linear-gradient(135deg,#0F172A,#1E293B)", color: "#fff", padding: "1.4rem 1.25rem" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#FF5722,#F44336)", display: "grid", placeItems: "center" }}>🔥</div>
            <b>Painel de demonstração</b>
          </div>
          <div style={{ color: "#CBD5E1", fontSize: ".95rem", lineHeight: 1.55, maxWidth: 720 }}>
            Este é um painel de pedidos de mentira, para você testar a extensão sem precisar de loja.
            Abra o popup do FireHub Prazos, clique em <b style={{ color: "#fff" }}>Marcar coluna na aba atual</b> e
            clique na coluna <b style={{ color: "#fff" }}>Em preparo</b>. Depois use os botões abaixo para
            encher e esvaziar a cozinha, e veja a contagem mudar no popup.
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <button style={botao("#FF5722")} onClick={() => setPreparo((p) => [...p, ...criar(1, proximo())])}>
            + 1 pedido em preparo
          </button>
          <button style={botao("#334155")} onClick={() => setPreparo((p) => [...p, ...criar(5, proximo())])}>
            + 5 pedidos
          </button>
          <button style={botao("#64748B")} onClick={() => setPreparo((p) => p.slice(0, Math.max(0, p.length - 1)))}>
            − 1 pedido
          </button>
          <button style={botao("#94A3B8")} onClick={() => { setPreparo(criar(4, 10)); setNovos(criar(2, 40)); setEntrega(criar(3, 70)); }}>
            Recomeçar
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { titulo: "Novos", lista: novos },
            { titulo: "Em preparo", lista: preparo },
            { titulo: "Saiu para entrega", lista: entrega },
          ].map((c) => (
            <div key={c.titulo} style={coluna}>
              <div style={cabecalho}>
                <span>{c.titulo}</span>
                <span style={contador}>{c.lista.length}</span>
              </div>
              <div>
                {c.lista.map((p) => (
                  <div key={p.n} style={cartao}>
                    <b>#{p.n} {p.nome}</b>
                    <div style={{ color: "#64748B" }}>{p.item}</div>
                  </div>
                ))}
                {c.lista.length === 0 && <div style={{ color: "#94A3B8", fontSize: ".85rem", padding: "8px 2px" }}>Nenhum pedido</div>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ color: "#64748B", fontSize: ".85rem", marginTop: 18, lineHeight: 1.6 }}>
          Nenhum pedido aqui é real e nada é enviado para lugar nenhum. Esta página existe só para
          demonstrar a leitura de colunas. <a href="/prazos" style={{ color: "#FF5722", fontWeight: 700 }}>Voltar para a página do FireHub Prazos</a>
        </div>
      </div>
    </main>
  );
}
