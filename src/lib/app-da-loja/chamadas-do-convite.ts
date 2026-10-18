/**
 * As chamadas do convite "Baixe o app" no site da loja — uma por visita, em
 * rodízio (components/customer/clube/ConviteDoApp.tsx).
 *
 * Douglas, 18/10/2026: "garanta o nosso clube, quinze por cento de desconto em
 * todas as compras… promoções especiais imperdíveis, o cara fica curioso e
 * baixa o aplicativo para ver… mais de uma chamada que vai trocando cada vez
 * que ele entrar."
 *
 * `curto` é o texto do celular (o cartão baixo cabe ~40 letras em 2 linhas).
 * A do Clube só existe com o Clube ligado, e é a primeira da fila.
 */
export type Chamada = { id: string; selo: string; titulo: string; curto: string; sub: string };

const pct = (n: number) => `${Number.isInteger(n) ? n : String(n).replace(".", ",")}%`;

export function chamadasDoConvite(nomeDaLoja: string, clube: { nome: string; percentual: number } | null): Chamada[] {
  const loja = nomeDaLoja.trim();
  const lista: Chamada[] = [];
  if (clube && clube.percentual > 0) {
    lista.push({
      id: "clube",
      selo: clube.nome,
      titulo: `Garanta o ${clube.nome}: ${pct(clube.percentual)} OFF em todas as compras`,
      curto: `Garanta ${pct(clube.percentual)} OFF em todas as compras`,
      sub: `Exclusivo do app ${loja}. Baixe e assine pelo celular.`,
    });
  }
  lista.push(
    {
      id: "promocoes",
      selo: "Só no app",
      titulo: `Promoções especiais e imperdíveis no app ${loja}`,
      curto: "Promoções imperdíveis só no app",
      sub: "Ofertas que só quem tem o app vê. Baixe e confira.",
    },
    {
      id: "descontos",
      selo: `Novo · app ${loja}`,
      titulo: "Baixe o app e ganhe descontos exclusivos",
      curto: "Baixe o app e ganhe descontos exclusivos",
      sub: "Peça mais rápido e acompanhe a entrega no celular.",
    },
  );
  return lista;
}

/** A chamada da visita número `vez` (0, 1, 2…): roda a lista. */
export function chamadaDaVez(lista: Chamada[], vez: number): Chamada {
  const n = Math.max(0, Math.floor(Number(vez) || 0));
  return lista[n % lista.length];
}
