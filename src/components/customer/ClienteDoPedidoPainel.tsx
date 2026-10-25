"use client";
import { useState } from "react";
import type { OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import {
  MAXIMO_DO_NOME,
  mesmoCliente,
  motivoParaNaoMudarOCliente,
  nomeParaGravar,
  problemaDoCliente,
  semTelefone,
  telefoneParaGravar,
} from "@/lib/cliente-do-pedido";

/**
 * "Incluir cliente" / "Corrigir cliente" — no modal Ver pedido do painel, junto
 * do endereço. É a tela da rota /api/store/orders/[id]/cliente; a regra de quem
 * pode é lib/cliente-do-pedido.ts (a mesma da rota).
 *
 * Divinos Burguer (24/10/2026): pedido lançado no balcão sem cliente e nenhum
 * jeito de incluir depois — só cancelar e lançar de novo.
 */

export type ResultadoDoCliente = { customerName: string; customerPhone: string };

/** "22999999999" → "(22) 99999-9999", para a tela. */
const foneNaTela = (d: string) => {
  const s = telefoneParaGravar(d).replace(/^55(?=\d{10,11}$)/, "");
  if (s.length === 11) return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
  if (s.length === 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  return s;
};

export default function ClienteDoPedidoPainel({
  pedido,
  operador,
  aoSalvar,
}: {
  pedido: any;
  operador: OperadorDaEdicao;
  aoSalvar: (r: ResultadoDoCliente) => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (motivoParaNaoMudarOCliente(pedido, operador)) return null;

  const nomeAtual = nomeParaGravar(pedido?.customerName);
  const temFone = !semTelefone(pedido?.customerPhone);
  // O balcão sem cliente grava "Cliente" ou "Balcão" como nome: é o mesmo que nada.
  const semCliente = (!nomeAtual || /^(cliente|balc[aã]o)$/i.test(nomeAtual)) && !temFone;

  const abrir = () => {
    setNome(/^(cliente|balc[aã]o)$/i.test(nomeAtual) ? "" : nomeAtual);
    setTelefone(temFone ? foneNaTela(pedido.customerPhone) : "");
    setErro(null);
    setAberto(true);
  };

  const salvar = async () => {
    const n = nomeParaGravar(nome);
    const t = telefoneParaGravar(telefone);
    const problema = problemaDoCliente(n, t);
    if (problema) return setErro(problema);
    if (mesmoCliente({ nome: n, telefone: t }, pedido)) return setAberto(false);
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/store/orders/${encodeURIComponent(pedido.id)}/cliente`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: n, telefone: t }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Não consegui salvar o cliente.");
      setAberto(false);
      await aoSalvar({ customerName: d.customerName, customerPhone: d.customerPhone });
    } catch (e: any) {
      setErro(e?.message || "Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  if (!aberto) {
    return (
      <div style={{ ...caixa, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "#334155", minWidth: 0, flex: "1 1 180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          👤 <b>Cliente:</b> {semCliente ? "sem cliente" : [nomeAtual, temFone ? foneNaTela(pedido.customerPhone) : ""].filter(Boolean).join(" · ")}
        </span>
        <button type="button" onClick={abrir} style={botaoLeve}>
          {semCliente ? "Incluir cliente" : "Corrigir cliente"}
        </button>
      </div>
    );
  }

  return (
    <div style={caixaAberta}>
      <label style={rotulo} htmlFor={`cli-nome-${pedido.id}`}>Nome do cliente</label>
      <input
        id={`cli-nome-${pedido.id}`}
        autoFocus
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        maxLength={MAXIMO_DO_NOME}
        style={{ ...campo, width: "100%" }}
      />
      <label style={{ ...rotulo, marginTop: 8 }} htmlFor={`cli-fone-${pedido.id}`}>Telefone (com DDD)</label>
      <input
        id={`cli-fone-${pedido.id}`}
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
        inputMode="tel"
        placeholder="(22) 99999-9999"
        style={{ ...campo, width: "100%" }}
      />
      {erro && <div style={{ fontSize: "0.76rem", color: "#B71C1C", fontWeight: 700, marginTop: 6 }}>{erro}</div>}
      <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: 6 }}>
        Campo em branco não muda. Não mexe no endereço, na taxa nem no total; fica registrado no histórico do pedido.
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" onClick={() => setAberto(false)} disabled={salvando} style={botaoLeve}>Cancelar</button>
        <button type="button" onClick={() => void salvar()} disabled={salvando} style={{ ...botaoLeve, background: "#0F766E", borderColor: "#0F766E", color: "#FFF", opacity: salvando ? 0.6 : 1 }}>
          {salvando ? "Salvando…" : "Salvar cliente"}
        </button>
      </div>
    </div>
  );
}

const caixa: React.CSSProperties = {
  marginBottom: 12, background: "#F8FAFC", padding: "8px 12px", borderRadius: 10, border: "1px solid #E2E8F0",
};
const caixaAberta: React.CSSProperties = { ...caixa, background: "#F0FDFA", border: "1.5px solid #99F6E4" };
const botaoLeve: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, border: "1.5px solid #E2E8F0",
  background: "#FFF", color: "#334155", cursor: "pointer", fontFamily: "inherit",
};
const campo: React.CSSProperties = {
  padding: "6px 8px", borderRadius: 8, border: "1.5px solid #99F6E4", fontFamily: "inherit", fontSize: "0.8rem",
  background: "#FFF", color: "#0F172A", boxSizing: "border-box",
};
const rotulo: React.CSSProperties = { display: "block", fontSize: "0.74rem", fontWeight: 800, color: "#115E59", marginBottom: 4 };
