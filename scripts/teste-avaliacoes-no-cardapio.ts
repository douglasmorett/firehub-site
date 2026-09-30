/**
 * Trava o mínimo de estrelas das avaliações no cardápio (lib/avaliacoes-no-cardapio.ts).
 *
 *   npx tsx scripts/teste-avaliacoes-no-cardapio.ts
 *
 * Pedido do dono (29/09/2026), a partir da Ragnar: a loja escolhe a partir de
 * quantas estrelas a avaliação aparece e conta no cardápio.
 */
import { entraNoCardapio, filtroDoCardapio, minimoDeEstrelas, notaDasAvaliacoes } from "../src/lib/avaliacoes-no-cardapio";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

confere("nulo = todas", minimoDeEstrelas(null), null);
confere("1 = todas (1 estrela ou mais é tudo)", minimoDeEstrelas(1), null);
confere("4 vale", minimoDeEstrelas(4), 4);
confere("texto \"3\" vale", minimoDeEstrelas("3"), 3);
confere("6 ou lixo = todas", [minimoDeEstrelas(6), minimoDeEstrelas("x")], [null, null]);
confere("filtro do Prisma com 4", filtroDoCardapio(4), { rating: { gte: 4 } });
confere("filtro do Prisma sem mínimo", filtroDoCardapio(null), {});
confere("a de 1 estrela sai com mínimo 3", entraNoCardapio(1, 3), false);
confere("a de 3 entra com mínimo 3", entraNoCardapio(3, 3), true);

// Loja com 26 avaliações de 5 estrelas e uma de 1 (a da batata fria).
const loja = [...Array(26).fill({ rating: 5 }), { rating: 1 }];
confere("nota com todas", notaDasAvaliacoes(loja), { media: 4.9, total: 27 });
confere("nota no cardápio com mínimo 4", notaDasAvaliacoes(loja.filter((r) => entraNoCardapio(r.rating, 4))), { media: 5, total: 26 });
confere("sem avaliação: 5,0 como sempre foi", notaDasAvaliacoes([]), { media: 5, total: 0 });

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
