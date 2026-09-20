"use client";

import { useEffect, useState } from "react";
import { PLANOS, type Plano } from "./planos";
import { SeloPequeno } from "./SeloDeGarantia";

/**
 * Preço com seletor de lojas, e a barra fixa do celular.
 *
 * Não é uma tabela de quatro planos de propósito: o lojista não ESCOLHE
 * quantas lojas tem — ele tem. Tabela de quatro colunas só adiciona ruído
 * para os que têm uma loja só (a maioria). O seletor mostra o preço por
 * loja, que é o número que faz quem tem três lojas subir de faixa.
 *
 * ── O que o seletor precisa deixar claro (corrigido em 19/09/2026) ────────
 * "Quantas lojas você tem?" mentia por omissão: quem tem 5 lojas em 5
 * endereços lia "R$ 69,50 e resolvi tudo" — e não resolve. A extensão roda
 * no Chrome DE UM computador, lendo A fila DAQUELE painel. Endereço
 * diferente = outra fila, outro computador, outra assinatura.
 *
 * A faixa multi-loja existe para o caso oposto, e é ele que o seletor
 * precisa nomear: várias marcas/CNPJs saindo da MESMA cozinha, no mesmo
 * login do Portal do Parceiro. Aí é uma fila só, e a extensão escreve o
 * prazo em todas ao mesmo tempo — por R$ 9,90 a loja extra, não R$ 29,90.
 */


const LARANJA = "#FF5722";
const WHATSAPP_REDE =
  "https://wa.me/5522981118514?text=Ol%C3%A1!%20Tenho%20lojas%20em%20endere%C3%A7os%20diferentes%20e%20quero%20o%20FireHub%20Prazos%20em%20todas.";

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
  const [i, definirFaixa] = useState(0);

  // A extensão manda o lojista para cá quando ele estoura a cota de lojas
  // (botão "Adicionar mais lojas" no popup), com ?lojas=N. Chegar já na faixa
  // certa evita o passo em que ele precisa lembrar quantas lojas contratou.
  useEffect(() => {
    const pedido = Number(new URLSearchParams(window.location.search).get("lojas"));
    if (!Number.isFinite(pedido) || pedido < 2) return;
    // A menor faixa que atende: quem pede 4 cai na de 5, não na de 3.
    const alvo = PLANOS.findIndex((op) => op.lojas >= pedido);
    if (alvo >= 0) definirFaixa(alvo);
  }, []);

  const p = PLANOS[i];
  const extras = p.lojas - 1;

  return (
    <div style={{ background: "#0B1220", border: "1px solid #334155", borderRadius: 18, padding: "1.5rem 1.25rem", maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: ".72rem", color: "#94A3B8", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>
        Quantas lojas saem da mesma cozinha?
      </div>
      <div style={{ color: "#64748B", fontSize: ".82rem", marginBottom: 12, lineHeight: 1.45 }}>
        Mesmo endereço, mesmo login do iFood
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 18, flexWrap: "wrap" }}>
        {PLANOS.map((op, idx) => (
          <button
            key={op.lojas}
            onClick={() => definirFaixa(idx)}
            aria-pressed={i === idx}
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
      {extras > 0 && (
        <>
          <div style={{ color: "#34D399", fontWeight: 800, fontSize: "1rem", marginTop: 8 }}>
            {porLoja(p.centavos, p.lojas)} por loja
          </div>
          {/* A conta aberta faz o que a porcentagem não faz: mostra que a loja
              extra custa um terço da primeira. É o argumento de quem tem duas
              marcas na mesma cozinha e acha que vai pagar duas assinaturas. */}
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginTop: 6 }}>
            R$ 29,90 a primeira {extras === 1 ? "+ mais uma" : `+ mais ${extras}`} a R$ 9,90 — a loja extra sai por um terço, e o prazo das {p.lojas} muda na mesma hora.
          </div>
        </>
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
      {/* Selos de pagamento colados no botão, não no rodapé: é ali que a
          dúvida "onde eu estou pondo o cartão" aparece. Três, nunca mais —
          fileira comprida de selo gera desconfiança em vez de tirar. */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginTop: 12 }}>
        {["⚡ Pix automático", "💳 Cartão", "🔒 Checkout Cakto"].map((t) => (
          <span key={t} style={{
            background: "#0F172A", border: "1px solid #334155", color: "#CBD5E1",
            borderRadius: 999, padding: "5px 11px", fontSize: ".72rem", fontWeight: 700,
          }}>
            {t}
          </span>
        ))}
      </div>

      {/* A medalha ao lado do botão: garantia perto do clique é o que tira o
          medo na hora em que ele existe. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginTop: 14 }}>
        <SeloPequeno />
        <div style={{ color: "#CBD5E1", fontSize: ".84rem", fontWeight: 700, lineHeight: 1.45, textAlign: "left", maxWidth: 230 }}>
          Um mês inteiro para testar no seu movimento. Não gostou, o dinheiro volta inteiro.
        </div>
      </div>

      <div style={{ color: "#94A3B8", fontSize: ".78rem", marginTop: 12, lineHeight: 1.6 }}>
        30 dias de garantia · sem fidelidade · cancele quando quiser
        <br />
        No checkout a Cakto soma R$ 0,99 de taxa de serviço: o total dessa cobrança fica{" "}
        <b style={{ color: "#CBD5E1" }}>{reais(p.centavos + TAXA_CAKTO)}</b>. Falamos antes para você não
        levar susto lá.
      </div>

      {/* O aviso que faltava. Fica DENTRO do cartão, colado no preço: é ali
          que o dono de rede decide, e é ali que ele precisa saber que o
          número na tela não cobre a loja do outro bairro. */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #1E293B", color: "#CBD5E1", fontSize: ".85rem", lineHeight: 1.6, textAlign: "left" }}>
        <b style={{ color: "#fff" }}>Suas lojas ficam em endereços diferentes?</b> Então é uma assinatura
        por endereço: cada cozinha tem a própria fila, o próprio computador e o próprio prazo — uma não
        decide pela outra.{" "}
        <a href={WHATSAPP_REDE} target="_blank" rel="noopener" style={{ color: "#4ADE80", fontWeight: 800 }}>
          Tem rede? Chama no WhatsApp
        </a>{" "}
        que a gente fecha as lojas juntas.
      </div>

      {/* A barra do celular é filha do seletor de propósito: ela mostra a
          faixa escolhida, e `position: fixed` deixa ela colada embaixo da
          tela de qualquer jeito. Como irmã (era assim até 19/09/2026) ela
          ficava presa em "R$ 29,90 / 1 loja" mesmo com 5 selecionadas — no
          celular, que é onde a maioria lê, o botão que fecha a venda levava
          para a oferta errada. */}
      <BarraFixa plano={p} />
    </div>
  );
}

/** Barra fixa no celular, sempre com a faixa que está na tela. */
function BarraFixa({ plano: p }: { plano: Plano }) {
  return (
    <>
      <div className="barra-fixa">
        <div>
          <div style={{ fontWeight: 900, fontSize: "1rem", lineHeight: 1 }}>{p.preco}<span style={{ fontSize: ".7rem", fontWeight: 700, color: "#94A3B8" }}>/mês</span></div>
          <div style={{ fontSize: ".64rem", color: "#94A3B8" }}>
            {p.lojas === 1 ? "30 dias de garantia" : `${p.lojas} lojas · 30 dias de garantia`}
          </div>
        </div>
        <a href={p.url} style={{
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
