"use client";

import { useEffect, useState } from "react";
import { PLANOS } from "./planos";

/**
 * Preço com seletor de lojas, e a barra fixa do celular.
 *
 * Não é uma tabela de quatro planos de propósito: o lojista não ESCOLHE
 * quantas lojas tem — ele tem. Tabela de quatro colunas só adiciona ruído
 * para os que têm uma loja só (a maioria). O seletor mostra o preço por
 * loja, que é o número que faz quem tem três lojas subir de faixa.
 */


const LARANJA = "#FF5722";

/**
 * A Cakto soma uma taxa de serviço fixa de R$ 0,99 à cobrança, e ela só
 * aparece no resumo do checkout — conferido em 09/09/2026 nas ofertas de
 * 1 e de 5 lojas, no cartão e no Pix. A página inteira defende que não
 * infla número; então ela também não pode esconder um. Dizer o total aqui
 * custa uma linha e evita a única surpresa que existe no caminho.
 *
 * Se um dia essa taxa for desligada no painel da Cakto, apague daqui.
 */
const TAXA_CAKTO = 99; // centavos

function reais(centavos: number) {
  return "R$ " + (centavos / 100).toFixed(2).replace(".", ",");
}

function porLoja(centavos: number, lojas: number) {
  return "R$ " + (centavos / lojas / 100).toFixed(2).replace(".", ",");
}

export function SeletorDePlano() {
  const [i, setI] = useState(0);

  // A extensão manda o lojista para cá quando ele estoura a cota de lojas
  // (botão "Adicionar mais lojas" no popup), com ?lojas=N. Chegar já na faixa
  // certa evita o passo em que ele precisa lembrar quantas lojas contratou.
  useEffect(() => {
    const pedido = Number(new URLSearchParams(window.location.search).get("lojas"));
    if (!Number.isFinite(pedido) || pedido < 2) return;
    // A menor faixa que atende: quem pede 4 cai na de 5, não na de 3.
    const alvo = PLANOS.findIndex((op) => op.lojas >= pedido);
    if (alvo >= 0) setI(alvo);
  }, []);

  const p = PLANOS[i];

  return (
    <div style={{ background: "#0B1220", border: "1px solid #334155", borderRadius: 18, padding: "1.5rem 1.25rem", maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: ".72rem", color: "#94A3B8", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
        Quantas lojas você tem?
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 18, flexWrap: "wrap" }}>
        {PLANOS.map((op, idx) => (
          <button
            key={op.lojas}
            onClick={() => setI(idx)}
            style={{
              border: `1px solid ${i === idx ? LARANJA : "#334155"}`,
              background: i === idx ? "rgba(255,87,34,.15)" : "transparent",
              color: "#fff", borderRadius: 10, padding: "9px 18px",
              fontWeight: 800, fontSize: ".95rem", cursor: "pointer", minWidth: 54,
            }}
          >
            {op.lojas}
          </button>
        ))}
      </div>

      <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1 }}>{p.preco}</div>
      <div style={{ color: "#CBD5E1", fontSize: ".95rem", marginTop: 4 }}>por mês, no total</div>
      {p.lojas > 1 && (
        <div style={{ color: "#34D399", fontWeight: 800, fontSize: "1rem", marginTop: 8 }}>
          {porLoja(p.centavos, p.lojas)} por loja
        </div>
      )}
      <div style={{ color: "#94A3B8", fontSize: ".85rem", marginTop: 10 }}>
        {/* 29,90 ÷ 30 = 0,9967. Arredondar para "R$ 1,00" jogava fora o melhor
            argumento de preço que a página tem — em low ticket, cruzar para
            baixo de um real vale mais que os centavos. */}
        {p.centavos / 100 / 30 < 1
          ? "Dá menos de R$ 1 por dia."
          : `Dá R$ ${(p.centavos / 100 / 30).toFixed(2).replace(".", ",")} por dia.`}{" "}
        Um pedido cancelado custa mais que isso.
      </div>

      <a href={p.url} style={{
        display: "block", marginTop: 18, background: `linear-gradient(135deg, ${LARANJA}, #E64A19)`,
        color: "#fff", fontWeight: 900, padding: "16px 22px", borderRadius: 12,
        textDecoration: "none", fontSize: "1.05rem", boxShadow: "0 10px 28px rgba(255,87,34,.35)",
      }}>
        Assinar por {p.preco}/mês
      </a>
      <div style={{ color: "#94A3B8", fontSize: ".78rem", marginTop: 12, lineHeight: 1.6 }}>
        7 dias de garantia · sem fidelidade · cancele quando quiser
        <br />
        No checkout a Cakto soma R$ 0,99 de taxa de serviço: o total dessa cobrança fica{" "}
        <b style={{ color: "#CBD5E1" }}>{reais(p.centavos + TAXA_CAKTO)}</b>. Falamos antes para você não
        levar susto lá.
      </div>
    </div>
  );
}

/** Barra fixa no celular: some no topo da página e aparece quando o hero sai. */
export function BarraFixa() {
  return (
    <>
      <div className="barra-fixa">
        <div>
          <div style={{ fontWeight: 900, fontSize: "1rem", lineHeight: 1 }}>R$ 29,90<span style={{ fontSize: ".7rem", fontWeight: 700, color: "#94A3B8" }}>/mês</span></div>
          <div style={{ fontSize: ".64rem", color: "#94A3B8" }}>7 dias de garantia</div>
        </div>
        <a href={PLANOS[0].url} style={{
          background: `linear-gradient(135deg, ${LARANJA}, #E64A19)`, color: "#fff", fontWeight: 900,
          padding: "11px 18px", borderRadius: 10, textDecoration: "none", fontSize: ".9rem", whiteSpace: "nowrap",
        }}>
          Assinar agora
        </a>
      </div>
      <style>{`
        .barra-fixa { display: none; }
        @media (max-width: 760px) {
          .barra-fixa {
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
            background: rgba(15,23,42,.97); border-top: 1px solid #334155;
            padding: 10px 14px; backdrop-filter: blur(8px);
            /* sem isto o preço herda o #0F172A do <main> e some no fundo escuro */
            color: #fff;
          }
          body { padding-bottom: 74px; }
        }
      `}</style>
    </>
  );
}
