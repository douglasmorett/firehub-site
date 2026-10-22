"use client";

/**
 * "Como fica a cobrança" — o quadro no alto do termo de qualquer módulo pago,
 * antes do "concordo". Douglas, 18/10/2026: "lembrando, ativando, quando acabar
 * o teste, se tiver período de teste; se não tiver, já cobra o mês". A regra de
 * desligar é a de lib/modulo-pago.ts.
 */

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ResumoDaCobranca({ preco, precoTexto, diasDeTeste, comTeste, cortesia }: {
  preco: number;
  /** O preço por extenso, quando não é fixo ("R$ 29,90 por tablet usado no mês"). */
  precoTexto?: string;
  diasDeTeste: number;
  /** Primeira ativação: tem os dias grátis. */
  comTeste: boolean;
  cortesia?: boolean;
}) {
  const valor = precoTexto ?? reais(preco);
  const hoje = new Date();
  const fimDoTeste = new Date(hoje.getTime() + diasDeTeste * 24 * 60 * 60 * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const mes = hoje.toLocaleDateString("pt-BR", { month: "long" });
  return (
    <div style={{ margin: "14px 20px 0", padding: "12px 14px", borderRadius: 12, background: comTeste || cortesia ? "#F0FDF4" : "#FFFBEB", border: `1px solid ${comTeste || cortesia ? "#BBF7D0" : "#FDE68A"}`, fontSize: 14, lineHeight: 1.55, color: "#1E293B" }}>
      <div style={{ fontWeight: 900, marginBottom: 4 }}>Como fica a cobrança</div>
      {cortesia ? (
        <div>Com o Aplicativo da loja ativo no Android e no iPhone, <b>não é cobrado</b> (cortesia).</div>
      ) : comTeste ? (
        <div>Hoje começam <b>{diasDeTeste} dias grátis, até {fimDoTeste}</b>. Se continuar ligado depois disso, o mês em que o teste acabar entra <b>inteiro</b> no boleto: <b>{valor}</b>. Para não pagar nada, desligue antes de {fimDoTeste}.</div>
      ) : (
        <div>Você já usou o teste grátis. Ligando agora, <b>{mes} já entra inteiro no boleto: {valor}</b>. Não tem valor proporcional — fica liberado o mês todo.</div>
      )}
      <div style={{ marginTop: 6, color: "#475569", fontSize: 13 }}>
        Desligar depois: no teste grátis, para na hora e não cobra; depois do teste, fica liberado até o fim do mês (que já está pago) e desliga sozinho na virada.
      </div>
    </div>
  );
}
