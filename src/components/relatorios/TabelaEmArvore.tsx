"use client";
/**
 * A tabela que abre e fecha — categoria → produto → opção — com Quantidade,
 * Valor e %. É a do "Itens vendidos" da Saipos, e serve a qualquer relatório
 * em árvore (atendente → categoria → produto, por exemplo).
 *
 * `abertos` é controlado por fora para os botões "abrir tudo / fechar tudo".
 * A faixa do título leva o TOTAL, como na Saipos ("Itens · Total: 242").
 */
import React from "react";
import { ChevronRight } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtPct, fmtQtd, fmtReais } from "@/lib/relatorios/base";

export type NoDaArvore = {
  chave: string;
  nome: string;
  tipo: string;
  quantidade: number;
  valor: number | null;
  pct: number;
  filhos?: NoDaArvore[];
};

export default function TabelaEmArvore({
  titulo, nos, total, abertos, alternar, cor = PALETA.ok, textoVazio = "Nada no período.", rotuloPct = "%",
}: {
  titulo: string;
  nos: NoDaArvore[];
  total?: { quantidade: number; valor: number | null };
  abertos: Set<string>;
  alternar: (chave: string) => void;
  cor?: string;
  textoVazio?: string;
  rotuloPct?: string;
}) {
  const linhas: React.ReactNode[] = [];
  const desenhar = (lista: NoDaArvore[], nivel: number, prefixo: string) => {
    for (const n of lista) {
      const chave = `${prefixo}/${n.chave}`;
      const temFilhos = Boolean(n.filhos && n.filhos.length);
      const aberto = abertos.has(chave);
      const forte = nivel === 0;
      linhas.push(
        <tr key={chave}
          onClick={temFilhos ? () => alternar(chave) : undefined}
          aria-expanded={temFilhos ? aberto : undefined}
          style={{ borderBottom: `1px solid ${PALETA.areia}`, cursor: temFilhos ? "pointer" : "default", background: nivel === 0 ? "#fff" : nivel === 1 ? "#FDFBF9" : PALETA.areia }}>
          <td style={{ padding: `${forte ? 10 : 7}px 0.9rem ${forte ? 10 : 7}px ${0.9 + nivel * 1.35}rem`, fontWeight: forte ? 800 : nivel === 1 ? 700 : 500, color: nivel >= 2 ? PALETA.carvao2 : PALETA.carvao }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {temFilhos
                ? <ChevronRight size={14} style={{ flexShrink: 0, transition: "transform 0.15s", transform: aberto ? "rotate(90deg)" : "none" }} />
                : <span style={{ width: 14, flexShrink: 0 }} />}
              {n.nome}
            </span>
          </td>
          <td style={{ padding: "7px 0.9rem", textAlign: "right", fontWeight: forte ? 800 : 600, fontVariantNumeric: "tabular-nums" }}>{fmtQtd(n.quantidade)}</td>
          <td style={{ padding: "7px 0.9rem", textAlign: "right", fontWeight: forte ? 800 : 600, color: n.valor === null ? PALETA.areiaTinta : PALETA.carvao, fontVariantNumeric: "tabular-nums" }}
            title={n.valor === null ? "O pedido não trouxe o preço desta opção e o cadastro não tem um" : undefined}>
            {n.valor === null ? "—" : fmtReais(n.valor)}
          </td>
          <td style={{ padding: "7px 0.9rem", textAlign: "right", color: PALETA.areiaTinta, fontVariantNumeric: "tabular-nums", width: 80 }}>{fmtPct(n.pct)}</td>
        </tr>,
      );
      if (temFilhos && aberto) desenhar(n.filhos!, nivel + 1, chave);
    }
  };
  desenhar(nos, 0, "");

  return (
    <div className="fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 14, overflow: "hidden", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "0.7rem 0.9rem", background: cor, color: "#fff" }}>
        <strong style={{ fontSize: "0.95rem" }}>{titulo}</strong>
        {total && (
          <span style={{ fontSize: "0.85rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            Total: {fmtQtd(total.quantidade)}{total.valor !== null ? ` · ${fmtReais(total.valor)}` : ""}
          </span>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
              <th style={{ textAlign: "left", padding: "8px 0.9rem", fontWeight: 800 }}>Nome</th>
              <th style={{ textAlign: "right", padding: "8px 0.9rem", fontWeight: 800 }}>Quantidade</th>
              <th style={{ textAlign: "right", padding: "8px 0.9rem", fontWeight: 800 }}>Valor</th>
              <th style={{ textAlign: "right", padding: "8px 0.9rem", fontWeight: 800 }}>{rotuloPct}</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length ? linhas : (
              <tr><td colSpan={4} style={{ padding: "2rem", textAlign: "center", color: PALETA.areiaTinta }}>{textoVazio}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Todas as chaves de nós com filhos — para o "abrir tudo". */
export function chavesAbriveis(nos: NoDaArvore[], prefixo = ""): string[] {
  const saida: string[] = [];
  for (const n of nos) {
    const chave = `${prefixo}/${n.chave}`;
    if (n.filhos && n.filhos.length) saida.push(chave, ...chavesAbriveis(n.filhos, chave));
  }
  return saida;
}

/** Filtra a árvore pelo nome, mantendo o caminho até o que casou. */
export function filtrarArvore(nos: NoDaArvore[], termo: string): NoDaArvore[] {
  const t = termo.trim().toLowerCase();
  if (!t) return nos;
  const saida: NoDaArvore[] = [];
  for (const n of nos) {
    if (n.nome.toLowerCase().includes(t)) { saida.push(n); continue; }
    const filhos = n.filhos ? filtrarArvore(n.filhos, t) : [];
    if (filhos.length) saida.push({ ...n, filhos });
  }
  return saida;
}
