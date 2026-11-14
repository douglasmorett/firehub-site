"use client";

/**
 * "Como funciona" desenhado do Chatbot IA: conectar lendo o QR → o robô
 * atende no WhatsApp da loja → fecha, manda a chave Pix e o pedido cai no
 * painel. Os rótulos são os de ChatbotHubClient.tsx (🔄 Gerar QR Code na Hora,
 * ⏱️ QR Code ativo · Expira em …s e os "Passos no Celular": Configurações ➔
 * Aparelhos conectados ➔ Conectar um aparelho). A chave Pix vai numa
 * mensagem só dela, como o webhook manda (lib/chatbot-ai.ts, [[ENVIAR_PIX]]);
 * o canal do pedido é o de lib/canal-do-pedido.ts (🤖 IA Whats).
 */
import { Passos } from "@/components/ilustracoes/Passos";
import { Balao, Botao, Celular, Linha, Painel, Qr, Seta } from "@/components/ilustracoes/aparelhos";

const LOJA = "Burger da Vila";
const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function IlustracaoDoChatbot() {
  const X_BACON = 29.9, ENTREGA = 6;
  return (
    <Passos passos={[
      {
        legenda: "No celular da loja: WhatsApp › Configurações › Aparelhos conectados › Conectar um aparelho, e aponte para o QR desta tela.",
        desenho: (<>
          <Painel largura={180} style={{ justifyItems: "center", textAlign: "center" }}>
            <b>🔄 Gerar QR Code na Hora</b>
            <Qr px={4} />
            <span style={{ fontSize: 10, fontWeight: 800, color: "#B45309" }}>⏱️ QR Code ativo · Expira em 45s</span>
          </Painel>
          <Seta para="←" />
          <Celular titulo="Aparelhos conectados" sub="WhatsApp" tipo="app">
            <div style={{ flex: 1, border: "2px solid #22C55E", borderRadius: 8, display: "grid", placeItems: "center", textAlign: "center", color: "#166534", fontWeight: 700, background: "#F0FDF4" }}>📷 Aponte para<br />o QR do painel</div>
            <Botao cor="verde">Conectar um aparelho</Botao>
          </Celular>
        </>),
      },
      {
        legenda: "O robô atende o cliente 24 h no WhatsApp da loja: manda o cardápio e tira dúvida.",
        desenho: (
          <Celular titulo={LOJA} sub="online">
            <Balao eu>boa noite, tem x-bacon?</Balao>
            <Balao>Boa noite! 😄 Tem sim: X-Bacon R$ {reais(X_BACON)}. Quer ver o cardápio completo? firehubfood.com.br/loja/burger-da-vila</Balao>
            <Balao eu>quero 1 pra entrega</Balao>
          </Celular>
        ),
      },
      {
        legenda: "Fecha o pedido, manda a chave Pix e o pedido cai no painel como qualquer outro.",
        desenho: (<>
          <Celular titulo={LOJA} sub="online">
            <Balao>Fechado! 1 X-Bacon + entrega = <b>R$ {reais(X_BACON + ENTREGA)}</b>. Segue a chave Pix 👇</Balao>
            <Balao>12.345.678/0001-90</Balao>
            <Balao eu>paguei ✅</Balao>
          </Celular>
          <Painel titulo="🔔 Novo pedido #302" sub="🤖 IA Whats · Pix" largura={220}>
            <Linha><span>1 X-Bacon</span><span>{reais(X_BACON)}</span></Linha>
            <Linha><span>Entrega</span><span>{reais(ENTREGA)}</span></Linha>
            <Linha style={{ borderTop: "1px solid #E5E7EB", paddingTop: 4 }}><b>Total</b><b>R$ {reais(X_BACON + ENTREGA)}</b></Linha>
          </Painel>
        </>),
      },
    ]} />
  );
}
