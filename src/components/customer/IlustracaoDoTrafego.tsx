"use client";

/**
 * "Como funciona" desenhado do Tráfego pago: foto do cardápio + texto da IA →
 * público no raio de entrega → anúncio no Instagram/Facebook → pedido no
 * painel + a conta da semana. Os rótulos são os de TrafegoPagoClient.tsx
 * (Configure seu anúncio, Texto do anúncio, Gerar com IA, Quem vai ver,
 * o "Preview do anúncio" com Patrocinado · 🌐 e Pedir agora, e o resumo
 * Investimento semanal / Taxa de gestão FireHub / Total semanal). O canal do
 * pedido é o de lib/canal-do-pedido.ts (🟢 Online).
 */
import type { CSSProperties } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { Botao, Celular, FotoDeProduto, LARANJA, Linha, Mapa, Painel, Pino, RotuloDoMapa } from "@/components/ilustracoes/aparelhos";

const LOJA = "Burger da Vila";
const TEXTO = "Bateu a fome? O X-Bacon mais suculento da cidade chega quentinho na sua casa. Peça agora!";
const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const produto = (sel: boolean): CSSProperties => ({ background: "#F1F5F9", borderRadius: 6, padding: 5, fontSize: 9.5, outline: sel ? `2px solid ${LARANJA}` : undefined });

/** `investimento` e `gestao` são os mesmos números da tela (o investimento escolhido e a taxa de gestão por semana). */
export function IlustracaoDoTrafego({ investimento, gestao }: { investimento: number; gestao: number }) {
  const X_BACON = 29.9, ENTREGA = 6;
  return (
    <Passos passos={[
      {
        legenda: "Você escolhe a foto de um produto do cardápio. A IA escreve o texto do anúncio.",
        desenho: (
          <Painel titulo="Configure seu anúncio" largura={320}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              <div style={produto(true)}><FotoDeProduto />X-Bacon</div>
              <div style={produto(false)}><FotoDeProduto />Combo Família</div>
            </div>
            <Linha style={{ alignItems: "center" }}>
              <b>Texto do anúncio</b>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: LARANJA }}>✨ Gerar com IA</span>
            </Linha>
            <div style={{ background: "#F1F5F9", borderRadius: 6, padding: 6 }}>
              <i>“{TEXTO}”</i><span className="ilu-pisca">▍</span>
            </div>
          </Painel>
        ),
      },
      {
        legenda: "Define quem vê: só gente dentro do raio de entrega da loja.",
        desenho: (
          <Mapa>
            <div style={{ position: "absolute", left: "22%", top: "8%", width: "56%", height: "84%", borderRadius: "50%", border: `2px dashed ${LARANJA}`, background: "rgba(232,54,12,.12)" }} />
            <Pino x="calc(50% - 12px)" y="calc(50% - 20px)" cor="#0F172A">🏠</Pino>
            <RotuloDoMapa>👥 Quem vai ver: Até 4 km da loja</RotuloDoMapa>
          </Mapa>
        ),
      },
      {
        legenda: "O anúncio aparece no Instagram e no Facebook de quem está perto.",
        desenho: (
          <Celular titulo="Instagram" tipo="app">
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: LARANJA, color: "#FFF", fontWeight: 800, display: "grid", placeItems: "center", flex: "none" }}>{LOJA[0]}</span>
              <div><b>{LOJA}</b><br /><small style={{ color: "#64748B" }}>Patrocinado · 🌐</small></div>
            </div>
            <div>{TEXTO.slice(0, 52)}…</div>
            <div style={{ height: 110, borderRadius: 6, background: "linear-gradient(135deg,#FDBA74,#C2410C)", flex: "none" }} />
            <Linha style={{ alignItems: "center" }}>
              <small style={{ color: "#64748B" }}>Saiba mais</small>
              <Botao style={{ padding: "4px 8px" }}>Pedir agora</Botao>
            </Linha>
          </Celular>
        ),
      },
      {
        legenda: "Quem toca em “Pedir agora” cai no seu cardápio e o pedido chega no painel.",
        desenho: (<>
          <Painel titulo="🔔 Novo pedido #212" sub="🟢 Online · Entrega" largura={240}>
            <Linha><span>1 X-Bacon</span><span>{reais(X_BACON)}</span></Linha>
            <Linha><span>Entrega</span><span>{reais(ENTREGA)}</span></Linha>
            <Linha style={{ borderTop: "1px solid #E5E7EB", paddingTop: 4 }}><b>Total</b><b>R$ {reais(X_BACON + ENTREGA)}</b></Linha>
          </Painel>
          <Painel titulo="Resumo da semana" largura={250}>
            <Linha><span>💰 Investimento semanal</span><span>R$ {investimento}</span></Linha>
            <Linha><span>🔧 Taxa de gestão FireHub</span><span>R$ {gestao}</span></Linha>
            <Linha style={{ borderTop: "1px solid #E5E7EB", paddingTop: 4 }}><b>Total semanal</b><b>R$ {investimento + gestao}</b></Linha>
          </Painel>
        </>),
      },
    ]} />
  );
}
