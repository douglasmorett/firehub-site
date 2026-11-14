"use client";

/**
 * "Como funciona" desenhado da Roteirização, no lugar da frase da aba ROTAS
 * vazia: pedidos no mapa → seleciona e otimiza → despacha e a rota chega no
 * WhatsApp do motoboy. Os rótulos são os de RoteirizacaoModal.tsx (a barra
 * "N selecionado(s) · ⚡ Otimizar Trajeto · Criar rota", o modal
 * "🛵 Despachar Rota de Entrega" com SEQUÊNCIA DE PARADAS, troco, SELECIONE O
 * MOTOBOY, "📱 Disparar rota automaticamente no WhatsApp do Motoboy" e
 * "Despachar Rota agora"). A mensagem do celular segue
 * mensagemDaRotaParaOMotoboy (lib/despacho-da-rota.ts), que sai pelo WhatsApp
 * da loja e não leva troco. Cabe no painel lateral de 390px.
 */
import type { CSSProperties } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { Balao, Celular, Mapa, Pino } from "@/components/ilustracoes/aparelhos";

const LOJA = "#0F172A";
const pinos = (todos: boolean) => (<>
  <Pino x="44%" y="40%" cor={LOJA}>🏠</Pino>
  <Pino x="15%" y="18%">1</Pino>
  <Pino x="70%" y="14%">2</Pino>
  <Pino x="82%" y="62%">3</Pino>
  {todos && <Pino x="20%" y="70%" cor="#94A3B8">4</Pino>}
</>);
const pilula = (fundo: string): CSSProperties => ({ background: fundo, color: "#FFF", borderRadius: 20, padding: "3px 7px", fontWeight: 800, whiteSpace: "nowrap" });
const parada: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 4, fontSize: 8.5 };

export function IlustracaoDaRoteirizacao() {
  return (
    <Passos passos={[
      {
        legenda: "Os pedidos de entrega aparecem como pinos no mapa.",
        desenho: <Mapa>{pinos(true)}</Mapa>,
      },
      {
        legenda: "Você seleciona os pedidos e toca em “⚡ Otimizar Trajeto”: o sistema acha a melhor ordem.",
        desenho: (
          <Mapa>
            <svg viewBox="0 0 400 250" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
              <polyline points="188,108 72,52 292,42 340,162" fill="none" stroke="#2563EB" strokeWidth="4" strokeDasharray="8 6" />
            </svg>
            {pinos(false)}
            <div style={{ position: "absolute", left: "50%", bottom: 8, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 5, background: "#1E293B", color: "#FFF", borderRadius: 20, padding: "4px 6px", fontSize: 8.5, whiteSpace: "nowrap" }}>
              <b style={{ padding: "0 3px" }}>3 selecionado(s)</b>
              <span className="ilu-pula" style={pilula("#0F766E")}>⚡ Otimizar Trajeto</span>
              <span style={pilula("#1C1917")}>Criar rota</span>
            </div>
          </Mapa>
        ),
      },
      {
        legenda: "Toca em “Criar rota”, escolhe o motoboy e despacha: o troco de cada parada aparece na tela e a rota chega no WhatsApp dele, com o GPS.",
        desenho: (<>
          <div style={{ width: 130, background: "#FFF", borderRadius: 10, padding: 8, color: "#111", fontSize: 9, lineHeight: 1.35, boxShadow: "0 12px 26px rgba(15,23,42,.16)", display: "grid", gap: 5, textAlign: "left" }}>
            <b style={{ fontSize: 10 }}>🛵 Despachar Rota de Entrega</b>
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: 4, display: "grid", gap: 2 }}>
              <b style={{ fontSize: 7.5, color: "#475569" }}>SEQUÊNCIA DE PARADAS:</b>
              <div style={parada}><span>1 #41 Ana</span><b style={{ color: "#C92E09" }}>💵 Troco: R$ 14,10</b></div>
              <div style={parada}><span>2 #42 Leo</span><b style={{ color: "#0F766E" }}>✅ Pago Online</b></div>
              <div style={parada}><span>3 #43 Bia</span><b>💳 Cartão</b></div>
            </div>
            <b style={{ fontSize: 7.5, color: "#334155" }}>SELECIONE O MOTOBOY:</b>
            <div style={{ border: "1.5px solid #CBD5E1", borderRadius: 5, padding: "3px 5px", fontWeight: 700 }}>🛵 João ▾</div>
            <div style={{ fontWeight: 700, fontSize: 8.5 }}>☑ 📱 Disparar rota automaticamente no WhatsApp do Motoboy</div>
            <div style={{ background: "#1C1917", color: "#FFF", borderRadius: 6, padding: 5, textAlign: "center", fontWeight: 800 }}>Despachar Rota agora</div>
          </div>
          <Celular titulo="Burger da Vila" sub="no celular do João">
            <Balao>
              🚀 <b>NOVA ROTA ATRIBUÍDA: Rota #3</b><br />
              📦 <b>Total de Pedidos:</b> 3<br />
              📍 <b>Paradas da Rota:</b><br />
              1️⃣ <b>Pedido #41</b>: Ana<br />🏠 Rua das Flores, 120<br />
              2️⃣ <b>Pedido #42</b>: Leo<br />🏠 Av. Brasil, 88<br />
              3️⃣ <b>Pedido #43</b>: Bia<br />🏠 Rua 7, 45<br />
              🗺️ <b>Navegação GPS (Google Maps):</b><br /><span style={{ color: "#0284C7" }}>maps.google.com/…</span>
            </Balao>
          </Celular>
        </>),
      },
    ]} />
  );
}
