"use client";

/**
 * "Como funciona" desenhado do Disparo oficial: escreve a mensagem e a Meta
 * aprova → escolhe o público e vê o custo → o cliente recebe do número da
 * loja → "Quero pedir" e o robô fecha. Os rótulos são os de
 * store/disparo-oficial/DisparoOficialClient.tsx (3. Mensagens, Mensagem,
 * Como o cliente vê, ↩ Quero pedir, ↩ Parar promoções, selo Aprovada,
 * 4. Disparar, Para quem, Sumidos (não pedem há…), Dias, a linha
 * "N clientes · usa até N disparos (R$) · seu saldo" e o botão Disparar).
 * `preco` é o mesmo preço por mensagem entregue que ApresentacaoDisparoOficial
 * lê de /api/store/disparo-oficial.
 */
import type { CSSProperties } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { Balao, Botao, Celular, Linha, Painel } from "@/components/ilustracoes/aparelhos";

const LOJA = "Burger da Vila ✔";
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const campo: CSSProperties = { border: "1px solid #CBD5E1", borderRadius: 5, padding: "4px 6px", background: "#FFF" };
const rotulo: CSSProperties = { fontSize: 9.5, fontWeight: 700, color: "#334155" };
const botaoDoWhats: CSSProperties = { background: "#FFF", borderRadius: 6, padding: 4, textAlign: "center", color: "#0284C7", fontWeight: 700 };

export function IlustracaoDoDisparo({ preco }: { preco: number }) {
  const clientes = 320, saldo = 500;
  const X_BACON = 29.9, ENTREGA = 6;
  const comDesconto = Math.round(X_BACON * 0.9 * 100) / 100;
  return (
    <Passos passos={[
      {
        legenda: "Você escreve a mensagem com o nome do cliente e a Meta aprova.",
        desenho: (
          <Painel titulo="3. Mensagens" largura={320}>
            <span style={rotulo}>Mensagem</span>
            <div style={{ ...campo, padding: 7 }}>Oi <b style={{ color: "#0F766E" }}>{"{nome}"}</b>, saudade de você! Hoje o X-Bacon está com 10% off. 🍔</div>
            <div style={{ background: "#E7F5EF", borderRadius: 8, padding: 7, display: "grid", gap: 3 }}>
              <span style={{ fontSize: 9, color: "#64748B", fontWeight: 700 }}>Como o cliente vê</span>
              <div style={{ background: "#FFF", borderRadius: "3px 8px 8px 8px", padding: "5px 7px" }}>Oi Maria, saudade de você! Hoje o X-Bacon está com 10% off. 🍔</div>
              <div style={botaoDoWhats}>↩ Quero pedir</div>
              <div style={botaoDoWhats}>↩ Parar promoções</div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#047857", background: "#D1FAE5", padding: "3px 8px", borderRadius: 999, justifySelf: "start" }}>Aprovada</span>
          </Painel>
        ),
      },
      {
        legenda: "Escolhe o público e vê o custo antes de mandar.",
        desenho: (
          <Painel titulo="4. Disparar" largura={320}>
            <span style={rotulo}>Para quem</span>
            <div style={campo}>Sumidos (não pedem há…) ▾</div>
            <Linha style={{ alignItems: "center" }}><span style={rotulo}>Dias</span><span style={{ ...campo, width: 60 }}>15</span></Linha>
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: 7, color: "#334155" }}>
              <b>{clientes}</b> clientes · usa até <b>{clientes}</b> disparos ({reais(clientes * preco)}) · seu saldo: <b style={{ color: "#047857" }}>{saldo}</b>
            </div>
            <Botao style={{ background: "#0F766E" }}>➤ Disparar</Botao>
          </Painel>
        ),
      },
      {
        legenda: "O cliente recebe do número oficial da loja, sem risco de banir o WhatsApp.",
        desenho: (
          <Celular titulo={LOJA} sub="conta comercial">
            <Balao botoes={["↩ Quero pedir", "↩ Parar promoções"]}>
              Oi <b>Marina</b>, saudade de você! Hoje o X-Bacon está com 10% off. 🍔
              <small style={{ display: "block", color: "#94A3B8", fontSize: 8, marginTop: 3 }}>Sua loja · toque em Parar para não receber</small>
            </Balao>
          </Celular>
        ),
      },
      {
        legenda: "Tocou em “Quero pedir”, o robô assume e fecha o pedido.",
        desenho: (
          <Celular titulo={LOJA} sub="conta comercial">
            <Balao eu>Quero pedir</Balao>
            <Balao>Oba, Marina! 😄 Aqui está o cardápio com o desconto: firehubfood.com.br/loja/burger-da-vila</Balao>
            <Balao eu>1 X-Bacon pra entrega</Balao>
            <Balao>Fechado! X-Bacon com 10% off {reais(comDesconto)} + entrega {reais(ENTREGA)} = <b>{reais(comDesconto + ENTREGA)}</b>. Te mando a chave Pix?</Balao>
          </Celular>
        ),
      },
    ]} />
  );
}
