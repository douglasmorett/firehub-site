"use client";

/**
 * "Como funciona" desenhado do Cashback, no lugar do antigo "Simulador de
 * Exemplo" da configuração (components/LoyaltyConfigForm.tsx): os quadros
 * recalculam com a %, o pedido mínimo, o limite de resgate e a expiração que
 * o lojista digitou. A regra é a de lib/cashback.ts: o crédito entra quando o
 * pedido é concluído (entregue), é a % do que se pagou pelos produtos (a
 * entrega fica fora), só vale nesta loja, e pedido cancelado não gera — o
 * saldo que ele usou volta. Os rótulos do celular são os do cardápio
 * (customer/CustomerStorePage.tsx): o selo 💰 do saldo, "Finalizar Pedido",
 * "Usar meu cashback: R$ … de saldo", "Subtotal:", "Entrega:",
 * "Desconto Cashback:", "✓ Finalizar Pedido • R$ …".
 * Pedido, loja e valores de produto são de exemplo.
 */
import { Passos } from "@/components/ilustracoes/Passos";
import { Celular, Linha, Painel, Selo } from "@/components/ilustracoes/aparelhos";

const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const pct = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const centavos = (n: number) => Math.round(n * 100) / 100;
const ENTREGA = 6;
const PROXIMO = 45;

export function IlustracaoDoCashback({ taxa, minimo, limiteDeResgate, validadeDias, site, whatsapp }: {
  taxa: number; minimo: number; limiteDeResgate: number; validadeDias: number; site: boolean; whatsapp: boolean;
}) {
  // Sem % ainda: desenha com 5% e avisa que é exemplo.
  const t = taxa > 0 ? taxa : 5;
  // O pedido do exemplo passa do mínimo (senão não geraria nada).
  const pedido = Math.max(60, Math.ceil(minimo / 10) * 10);
  const ganho = centavos((pedido * t) / 100);
  // O cardápio trata limite vazio/0 como 50% (o mesmo do campo).
  const limite = limiteDeResgate || 50;
  const usa = centavos(Math.min(ganho, (PROXIMO * limite) / 100));
  const total = centavos(PROXIMO + ENTREGA - usa);
  const canal = site && whatsapp ? "pelo site ou pelo robô do WhatsApp" : site ? "pelo site" : whatsapp ? "pelo robô do WhatsApp" : "pelo site ou pelo robô";

  return (
    <Passos passos={[
      {
        legenda: `O cliente pede ${canal}. Quando o pedido é entregue, ganha ${pct(t)}% dos produtos de volta${taxa > 0 ? "" : " (exemplo: ponha a sua %)"} — a entrega fica fora da conta${minimo > 0 ? `, e só gera a partir de ${reais(minimo)} em produtos` : ""}.`,
        desenho: (
          <Painel titulo="Pedido #301 entregue ✓" largura={260}>
            <Linha><span>Produtos</span><b>{reais(pedido)}</b></Linha>
            <Linha style={{ color: "#64748B" }}><span>Entrega (fora da conta)</span><span>{reais(ENTREGA)}</span></Linha>
            <Selo cor="verde">+ {reais(ganho)} de cashback ({pct(t)}%)</Selo>
          </Painel>
        ),
      },
      {
        legenda: `O saldo fica guardado no telefone dele e só vale nesta loja${validadeDias > 0 ? `. Vence ${validadeDias} dia${validadeDias === 1 ? "" : "s"} depois de entrar` : ", sem vencer"}.`,
        desenho: (
          <Celular titulo="Burger da Vila" sub="cardápio" tipo="app">
            <div style={{ alignSelf: "flex-end", background: "linear-gradient(135deg,#10B981,#059669)", color: "#FFF", borderRadius: 8, padding: "3px 7px", fontWeight: 800 }}>💰 {reais(ganho)}</div>
            <div style={{ textAlign: "center", padding: "14px 0" }}>
              <span style={{ color: "#64748B", fontSize: 9.5 }}>Seu saldo de cashback acumulado nesta loja</span>
              <b style={{ display: "block", fontSize: 24, fontWeight: 900, color: "#16A34A" }}>{reais(ganho)}</b>
              {validadeDias > 0 && <span style={{ color: "#64748B", fontSize: 9.5 }}>vence em {validadeDias} dia{validadeDias === 1 ? "" : "s"}</span>}
            </div>
          </Celular>
        ),
      },
      {
        legenda: `No próximo pedido, ele marca "Usar meu cashback" e o saldo desconta até ${pct(limite)}% dos produtos. Pedido cancelado não gera saldo, e o que ele usou volta.`,
        desenho: (
          <Celular titulo="Finalizar Pedido" sub="Burger da Vila" tipo="app">
            <div style={{ border: "1.5px solid #7C3AED", background: "#F5F3FF", borderRadius: 8, padding: 6, color: "#4C1D95" }}>
              <b>☑ Usar meu cashback: {reais(ganho)} de saldo</b>
              <span style={{ display: "block", color: "#6D28D9", fontSize: 9 }}>
                {usa < ganho ? `Neste pedido dá para usar até ${reais(usa)} (${pct(limite)}% dos produtos).` : `Abate ${reais(usa)} deste pedido.`}
              </span>
            </div>
            <div style={{ background: "#F1F5F9", borderRadius: 8, padding: 6, display: "grid", gap: 2, color: "#475569" }}>
              <Linha><span>Subtotal:</span><b>{reais(PROXIMO)}</b></Linha>
              <Linha><span>Entrega:</span><b>{reais(ENTREGA)}</b></Linha>
              <Linha style={{ color: "#7C3AED", fontWeight: 700 }}><span>Desconto Cashback:</span><span style={{ whiteSpace: "nowrap" }}>- {reais(usa)}</span></Linha>
            </div>
            <div style={{ marginTop: "auto", background: "linear-gradient(135deg,#059669,#047857)", color: "#FFF", borderRadius: 8, padding: 6, textAlign: "center", fontWeight: 800 }}>✓ Finalizar Pedido • {reais(total)}</div>
          </Celular>
        ),
      },
    ]} />
  );
}
