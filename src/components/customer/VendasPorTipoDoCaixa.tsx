"use client";
import { useState } from "react";
import type { BlocoDoTipo, ParteDoRetrato } from "@/lib/cupom-do-caixa";

/**
 * As vendas do turno separadas por TIPO — Delivery, Retirada, Balcão, Mesas,
 * Totem —, cada uma com as formas que entraram, o valor dos produtos, as taxas,
 * o desconto e o total.
 *
 * Pedido do Douglas a partir da Delícia de Casa (02/10/2026): "no relatório
 * do caixa, sair de forma separada: mesas, vendas balcão… no fechamento do
 * caixa e no extrato de fechamento também". Os números vêm prontos do servidor
 * (lib/apuracao-do-turno.ts), a mesma apuração do papel: a tela não soma nada,
 * só mostra — e a última linha prova que os tipos somam o total faturado.
 *
 * Usado no modal de fechamento (StoreTopNav) e no Histórico de caixas.
 */
export type VendasPorTipo = {
  vendas: { qtd: number; valor: number };
  porTipo: BlocoDoTipo[];
  trocoDasMesas?: { valor: number; qtd: number };
};

const fmt = (v: number) => `${v < -0.004 ? "−" : ""}R$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ROTULO: Record<string, string> = {
  DELIVERY: "🛵 Delivery",
  RETIRADA: "🛍️ Retirada",
  BALCAO: "🧾 Balcão",
  MESA: "🍽️ Mesas",
  TOTEM: "🖥️ Totem",
};

// O papel sai em ASCII ("Debito"); a tela fala com acento.
const nomeDaForma = (nome: string) =>
  nome
    .replace(/^Debito$/, "Débito")
    .replace(/^Credito$/, "Crédito")
    .replace(/^Vale-refeicao$/, "Vale-refeição")
    .replace(/^Forma nao identificada$/, "Forma não identificada");

// A ordem da conferência: o dinheiro sempre na primeira linha.
const ORDEM = ["Dinheiro", "Debito", "Credito", "Pix", "Vale-refeicao"];
const posicao = (n: string) => {
  const i = ORDEM.indexOf(n);
  if (i >= 0) return i;
  if (n.startsWith("Pago online")) return 10;
  if (n === "Cupom da plataforma") return 20;
  if (n === "Fiado") return 30;
  return 40;
};
const naOrdem = (l: ParteDoRetrato[]) => [...l].sort((a, b) => posicao(a.nome) - posicao(b.nome) || b.valor - a.valor);

function Linha({ rotulo, valor, fraco, forte, nota }: { rotulo: string; valor: number; fraco?: boolean; forte?: boolean; nota?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0", fontSize: forte ? "0.9rem" : "0.82rem", color: fraco ? "#64748B" : "#0F172A", fontWeight: forte ? 900 : fraco ? 500 : 600 }}>
      <span style={{ minWidth: 0 }}>
        {rotulo}
        {nota && <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 500, color: "#94A3B8" }}>{nota}</span>}
      </span>
      <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmt(valor)}</span>
    </div>
  );
}

function Bloco({ b, total }: { b: BlocoDoTipo; total: number }) {
  const pct = total > 0 ? Math.round((b.valor / total) * 100) : 0;
  return (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px", background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 900, fontSize: "0.92rem", color: "#0F172A" }}>{ROTULO[b.chave] || b.nome}</span>
        <span style={{ fontSize: "0.72rem", color: "#64748B" }}>{b.qtd} {b.qtd === 1 ? "venda" : "vendas"} · {pct}%</span>
      </div>
      {naOrdem(b.formas).map((f) => (
        <Linha key={f.nome} rotulo={`${nomeDaForma(f.nome)} (${f.qtd})`} valor={f.valor}
               nota={f.nome === "Cupom da plataforma" ? "a plataforma repassa" : f.nome === "Fiado" ? "acertado fora do caixa" : undefined} />
      ))}
      <div style={{ borderTop: "1px dashed #E2E8F0", margin: "6px 0 4px" }} />
      <Linha rotulo="Valor dos produtos" valor={b.produtos} fraco />
      {b.taxaDeEntrega.valor > 0.005 && <Linha rotulo={`+ Taxa de entrega (${b.taxaDeEntrega.qtd})`} valor={b.taxaDeEntrega.valor} fraco />}
      {b.servico.valor > 0.005 && <Linha rotulo={`+ Taxa de serviço (${b.servico.qtd})`} valor={b.servico.valor} fraco />}
      {b.gorjeta > 0.005 && <Linha rotulo="+ Gorjeta" valor={b.gorjeta} fraco />}
      {b.desconto.valor > 0.005 && (
        <Linha rotulo={`− ${b.chave === "MESA" ? "Desconto no fechamento" : "Desconto da loja"} (${b.desconto.qtd})`} valor={-b.desconto.valor} fraco />
      )}
      {Math.abs(b.ajustes) > 0.005 && (
        <Linha rotulo={`${b.ajustes > 0 ? "+" : "−"} Outras taxas e ajustes`} valor={b.ajustes} fraco
               nota={b.chave === "MESA" ? "pago a mais no cartão ou no Pix" : "taxa de serviço do app e outros ajustes do pedido"} />
      )}
      <div style={{ borderTop: "1px solid #E2E8F0", margin: "6px 0 2px" }} />
      <Linha rotulo={`Total ${ROTULO[b.chave]?.replace(/^\S+\s/, "") || b.nome}`} valor={b.valor} forte />
      {b.troco.valor > 0.005 && (
        <Linha rotulo={`Troco devolvido (${b.troco.qtd})`} valor={b.troco.valor} fraco nota="já tirado do dinheiro acima" />
      )}
      {b.canais.length > 1 && (
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {b.canais.map((c) => (
            <span key={c.nome} style={{ fontSize: "0.7rem", fontWeight: 700, color: "#475569", background: "#F1F5F9", borderRadius: 999, padding: "2px 8px" }}>
              {c.nome} ({c.qtd}) {fmt(c.valor)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VendasPorTipoDoCaixa({ dados, abertoDeInicio = false }: { dados: VendasPorTipo | null; abertoDeInicio?: boolean }) {
  const [aberto, setAberto] = useState(abertoDeInicio);
  if (!dados || dados.porTipo.length === 0) return null;
  const soma = Math.round(dados.porTipo.reduce((s, b) => s + b.valor * 100, 0)) / 100;
  const bate = Math.abs(soma - dados.vendas.valor) < 0.005;

  return (
    <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px", marginBottom: "1rem", textAlign: "left" }}>
      <button type="button" onClick={() => setAberto((v) => !v)}
              style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
        <span style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.06em", color: "#64748B", textTransform: "uppercase" }}>
          Vendas por tipo
        </span>
        <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "#0F766E" }}>{aberto ? "esconder ▴" : "ver detalhado ▾"}</span>
      </button>

      {/* Fechado, uma linha por tipo — o que o lojista olha de relance. */}
      {!aberto && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {dados.porTipo.map((b) => (
            <span key={b.chave} style={{ fontSize: "0.76rem", fontWeight: 700, color: "#1E293B", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 999, padding: "3px 10px" }}>
              {ROTULO[b.chave] || b.nome} ({b.qtd}) <strong>{fmt(b.valor)}</strong>
            </span>
          ))}
        </div>
      )}

      {aberto && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8, marginTop: 10 }}>
          {dados.porTipo.map((b) => <Bloco key={b.chave} b={b} total={dados.vendas.valor} />)}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8, paddingTop: 8, borderTop: "1px dashed #E2E8F0", fontSize: "0.8rem" }}>
        <span style={{ color: "#475569" }}>
          Total faturado ({dados.vendas.qtd} {dados.vendas.qtd === 1 ? "venda" : "vendas"})
          <span style={{ display: "block", fontSize: "0.7rem", color: bate ? "#0F766E" : "#B45309" }}>
            {bate ? "✓ a soma dos tipos fecha com o total" : `a soma dos tipos dá ${fmt(soma)}`}
          </span>
        </span>
        <strong style={{ color: "#0F172A", whiteSpace: "nowrap" }}>{fmt(dados.vendas.valor)}</strong>
      </div>
      {(dados.trocoDasMesas?.valor || 0) > 0.005 && (
        <div style={{ fontSize: "0.72rem", color: "#9A3412", marginTop: 6, lineHeight: 1.45 }}>
          As mesas receberam {fmt(dados.trocoDasMesas!.valor)} de troco ({dados.trocoDasMesas!.qtd} {dados.trocoDasMesas!.qtd === 1 ? "conta" : "contas"}).
          Aqui ele já está fora do dinheiro; na conferência acima, o dinheiro esperado ainda conta a nota que o cliente entregou.
        </div>
      )}
    </div>
  );
}

/**
 * No Histórico: o caixa já fechado não tem o retrato gravado, então busca
 * (api/cash-session/por-tipo) só quando o lojista pede.
 */
export function VendasPorTipoDoHistorico({ sessionId }: { sessionId: string }) {
  const [estado, setEstado] = useState<"parado" | "carregando" | "erro">("parado");
  const [dados, setDados] = useState<VendasPorTipo | null>(null);

  const carregar = async () => {
    setEstado("carregando");
    try {
      const r = await fetch(`/api/cash-session/por-tipo?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) { setEstado("erro"); return; }
      setDados(j);
      setEstado("parado");
    } catch {
      setEstado("erro");
    }
  };

  if (dados) {
    if (dados.porTipo.length === 0) {
      return <div style={{ fontSize: "0.78rem", color: "#94A3B8", padding: "4px 0" }}>Nenhuma venda paga neste caixa.</div>;
    }
    return <VendasPorTipoDoCaixa dados={dados} abertoDeInicio />;
  }
  return (
    <button type="button" onClick={carregar} disabled={estado === "carregando"}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "#FFF", color: "#475569", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
      {estado === "carregando" ? "Somando…" : estado === "erro" ? "Não consegui somar — tentar de novo" : "📊 Vendas por tipo"}
    </button>
  );
}
