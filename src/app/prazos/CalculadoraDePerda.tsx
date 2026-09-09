"use client";

import { useState } from "react";
import { CHECKOUT_PADRAO } from "./planos";

/**
 * "Quanto o prazo errado te custa por mês" — a calculadora da página de venda.
 *
 * Três campos, não sete: quanto mais campo, menos gente termina. E a conta
 * fica na tela, porque o que vende aqui é a honestidade da conta.
 *
 * A conta é DE PROPÓSITO mais conservadora do que a do mercado. Todo mundo
 * soma "o valor do pedido + a comida que foi pro lixo", e isso conta o
 * ingrediente duas vezes:
 *
 *   pedido entregue → você recebe o repasse e paga o ingrediente
 *   pedido cancelado → você não recebe nada e paga o ingrediente do mesmo jeito
 *   a diferença entre os dois é o REPASSE, e só.
 *
 * Repasse = valor do pedido menos 12% de comissão e 3,2% de pagamento online,
 * que são os números publicados do Plano Básico do iFood (o plano de quem
 * entrega com motoboy próprio):
 * https://parceiros.ifood.com.br/restaurante/planos-ifood
 */

const REPASSE = 1 - 0.12 - 0.032; // 84,8% — Plano Básico, pedido pago pelo app
const MENSALIDADE = 49.9;

const real = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CalculadoraDePerda() {
  const [pedidos, setPedidos] = useState(900);
  const [ticket, setTicket] = useState(55);
  const [perdaPct, setPerdaPct] = useState(2);

  const perdidos = (pedidos * perdaPct) / 100;
  const perda = perdidos * ticket * REPASSE;
  const vezes = perda / MENSALIDADE;

  const campo: React.CSSProperties = {
    width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid #CBD5E1",
    fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", background: "#fff",
    fontFamily: "inherit", boxSizing: "border-box",
  };
  const rotulo: React.CSSProperties = { fontWeight: 700, fontSize: ".92rem", marginBottom: 7, display: "block", color: "#334155" };

  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.3rem 1.4rem", boxShadow: "0 6px 20px rgba(15,23,42,.05)", marginTop: 22 }}>
      <div style={{ fontWeight: 900, fontSize: "1.15rem", marginBottom: 4 }}>Faça a conta da sua loja</div>
      <div style={{ color: "#64748B", fontSize: ".95rem", marginBottom: 18, lineHeight: 1.55 }}>
        Mexa nos três números abaixo. Ninguém precisa do seu e-mail para isso.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <div>
          <label style={rotulo} htmlFor="calc-pedidos">Pedidos por mês</label>
          <input
            id="calc-pedidos" type="number" inputMode="numeric" min={0} max={100000} step={50}
            value={pedidos}
            onChange={(e) => setPedidos(Math.max(0, Math.min(100000, Number(e.target.value) || 0)))}
            style={campo}
          />
        </div>
        <div>
          <label style={rotulo} htmlFor="calc-ticket">Ticket médio (R$)</label>
          <input
            id="calc-ticket" type="number" inputMode="decimal" min={0} max={1000} step={1}
            value={ticket}
            onChange={(e) => setTicket(Math.max(0, Math.min(1000, Number(e.target.value) || 0)))}
            style={campo}
          />
        </div>
        <div>
          <label style={rotulo} htmlFor="calc-perda">
            De cada 100 pedidos, quantos você perde por atraso? <b style={{ color: "#FF5722" }}>{perdaPct}</b>
          </label>
          <input
            id="calc-perda" type="range" min={0} max={10} step={0.5}
            value={perdaPct}
            onChange={(e) => setPerdaPct(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#FF5722", marginTop: 10 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8", fontSize: ".78rem" }}>
            <span>nenhum</span><span>10 em 100</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20, background: "#0F172A", color: "#fff", borderRadius: 14, padding: "1.15rem 1.25rem" }}>
        {perdidos < 0.5 || perda < 1 ? (
          <div style={{ lineHeight: 1.6, color: "#CBD5E1" }}>
            Zero pedido perdido por atraso? Então esta ferramenta não é para você agora —
            e a gente prefere te dizer isso do que te vender.
          </div>
        ) : (
          <>
            <div style={{ fontSize: "clamp(1.5rem, 4vw, 2.1rem)", fontWeight: 900, lineHeight: 1.15 }}>
              {real(perda)} por mês
            </div>
            <div style={{ color: "#CBD5E1", lineHeight: 1.6, marginTop: 8 }}>
              São <b style={{ color: "#fff" }}>{perdidos.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} pedidos</b> que
              não entram no mês. Dá <b style={{ color: "#fff" }}>{vezes.toFixed(0)}x a mensalidade</b> da extensão.
            </div>
            <div style={{ color: "#94A3B8", fontSize: ".85rem", marginTop: 12, lineHeight: 1.6, borderTop: "1px solid #334155", paddingTop: 12 }}>
              A conta: {perdidos.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} pedidos × {real(ticket)} × 84,8%.
              Os 84,8% são o que sobra depois da comissão de 12% e da taxa de 3,2% do pagamento pelo app, que são os
              números publicados do{" "}
              <a href="https://parceiros.ifood.com.br/restaurante/planos-ifood" target="_blank" rel="noopener" style={{ color: "#FF7A59" }}>
                Plano Básico do iFood
              </a>.
              Não somamos a comida que foi pro lixo: o ingrediente você ia gastar do mesmo jeito se o pedido
              tivesse dado certo, então somar isso seria contar duas vezes.
            </div>
          </>
        )}
      </div>

      <div style={{ color: "#475569", fontSize: ".93rem", marginTop: 14, lineHeight: 1.6 }}>
        <b>O que a extensão promete, com todas as letras:</b> ela não acaba com atraso. Ela faz o prazo que o
        cliente vê ser o que a sua fila aguenta naquele minuto. O resto é cozinha.
      </div>

      <a
        href={CHECKOUT_PADRAO}
        style={{
          display: "inline-block", marginTop: 16, background: "linear-gradient(135deg, #FF5722 0%, #E64A19 100%)",
          color: "#fff", fontWeight: 900, padding: "14px 26px", borderRadius: 12, textDecoration: "none",
          boxShadow: "0 10px 28px rgba(255,87,34,.3)",
        }}
      >
        Assinar por R$ 49,90/mês
      </a>
    </div>
  );
}
