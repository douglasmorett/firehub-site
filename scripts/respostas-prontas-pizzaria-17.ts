/**
 * Respostas prontas do robô da PIZZARIA 17 e da PIZZARIA 17 AEROPORTO (e só
 * delas), pedidas pelo Antonio em 12/10/2026 (lib/respostas-prontas.ts).
 * Os textos são os que a loja já usava no WhatsApp, copiados como vieram;
 * as fotos estão em public/robo/pizzaria-17/.
 *
 *   npx tsx scripts/respostas-prontas-pizzaria-17.ts            mostra o que gravaria
 *   npx tsx scripts/respostas-prontas-pizzaria-17.ts --gravar   grava (mescla no chatbotConfig)
 */
import { PrismaClient } from "@prisma/client";
import { lerRespostasProntas, type RespostaPronta } from "../src/lib/respostas-prontas";

const LOJAS = ["pizzaria-17", "pizzaria-17-aeroporto"];

export const RESPOSTAS: RespostaPronta[] = [
  {
    id: "combos",
    assunto: "o cliente pergunta de combo ou combo promocional, quer pedir um combo, ou pergunta quais sabores de pizza (salgada ou doce) ou quais refrigerantes entram no combo",
    imagens: ["/robo/pizzaria-17/combos-promocionais.jpg", "/robo/pizzaria-17/sabores-dos-combos.jpg"],
    textoDepois: "⚠️ Importante: os combos promocionais são válidos somente para os sabores indicados acima 👆🏻",
  },
  {
    id: "tamanhos",
    assunto: "o cliente pergunta o tamanho das pizzas, quantos centímetros, quantas fatias, quantos sabores cabem em cada tamanho, ou qual tamanho serve quantas pessoas",
    texto: `Dúvidas sobre tamanho?!

P- 25cm (4 fatias) 1 sabor

M- 30cm (6 fatias) até 2 Sabores

G- 35cm (8 fatias) até 2 Sabores

GG- 40cm (10 fatias) até 2 Sabores

XGG- 45cm (16 fatias) até 4 Sabores`,
  },
  {
    id: "vale-refeicao",
    assunto: "o cliente pergunta se aceita vale-refeição, vale-alimentação, cartão refeição ou alimentação, ou cita VR, Ticket, Sodexo, Pluxee ou Alelo (atenção: Alelo é SOMENTE refeição; VR, Ticket e Sodexo/Pluxee são refeição E alimentação)",
    texto: `Aceitamos as Bandeiras:

*VR* 👉🏻 Refeição e Alimentação
*Ticket* 👉🏻 Refeição e Alimentação
*Sodexo/Pluxee* 👉🏻 Refeição e Alimentação
*Alelo* 👉🏻 Somente Refeição`,
  },
  {
    id: "rodizio",
    assunto: "o cliente pergunta do rodízio: se tem, como funciona, valor, dias, preço para criança ou bariátrico, refil ou a gratuidade do aniversariante",
    texto: `RODÍZIO DA 17 🍟Entrada com batata frita e nuggets à vontade.

🍕Escolha 8 sabores de pizza salgada e receba 2 pizzas inteiras na mesa, podendo repetir quantas vezes quiser.

🍫Mesma regra para pizzas doces, incluindo 1 sabor premium na doce

🤑Valor: R$59,99 (segunda a quinta).

🥤Refil de refrigerante: R$9,99 (Guaraná Antártica e Coca-Cola).

🪪Bariátricos (até 2 anos de cirurgia): R$29,99 (com carteirinha).

👧Crianças: Até 4 anos grátis, de 5 a 9 anos R$35,90.

 🎉Grátis para você ao levar 5 convidados pagantes. (Promoção de gratuidade somente de seg a quinta )`,
  },
  {
    id: "reserva-festa",
    assunto: "o cliente quer fazer uma reserva para festa, aniversário, comemoração ou evento, ou pergunta das regras de reserva, decoração, o que pode levar (bolo, doces, salgados, bebidas), duração da festa ou área kids",
    texto: `Olá, para reservas temos as seguintes regras:

-Reservas durante a semana tem horário flexível, aos finais de semana somente para as 18h, com duração máxima de 2h30 (até as 20h30), com tolerância de 15 minutinhos após o horário marcado , sugerimos que coloque 30 minutos antes no convite.

-É Permitido levar bolo, cupcakes, docinhos e sacolinha de doces.

- *Proibido* levar qualquer alimento salgado para consumo no local como: salgadinhos, cachorro quente e outros lanches. Tambem *NÃO* pode levar qualquer bebida como, água, refrigerantes, bebida alcoólica e etc...

-Todos que estejam na festa devem estar consumindo.

-Área Kids 100% gratuita com Monitora, Crianças para entrar no parquinho devem ter até 1,30 altura, devido a estrutura do brinquedo passadas pelo fabricante menores de 3 anos pode brincar com um responsável.`,
    imagens: ["/robo/pizzaria-17/decoracao-festa-1.jpg", "/robo/pizzaria-17/decoracao-festa-2.jpg"],
    textoDepois: `Deixe aqui algumas informações:

Nome completo:
2 Telefone para contato:

Quantidade de pessoas:
Data :
Horário:

Unidade desejada :
Ornamentação:`,
    // Ficha preenchida → a conversa vai para a equipe com os dados no aviso.
    fichaParaALoja: "Reserva de festa",
  },
];

async function main() {
  const gravar = process.argv.includes("--gravar");
  // A lista passa pela mesma leitura do robô: o que ela recusaria, não grava.
  const validas = lerRespostasProntas({ respostasProntas: RESPOSTAS });
  if (validas.length !== RESPOSTAS.length) throw new Error(`Só ${validas.length} de ${RESPOSTAS.length} respostas são válidas.`);

  const prisma = new PrismaClient();
  try {
    for (const slug of LOJAS) {
      const loja = await prisma.user.findFirst({ where: { slug }, select: { id: true, storeName: true, chatbotConfig: true } });
      if (!loja) throw new Error(`Loja ${slug} não encontrada.`);
      const atual = (loja.chatbotConfig && typeof loja.chatbotConfig === "object" ? loja.chatbotConfig : {}) as Record<string, unknown>;
      console.log(`${loja.storeName} (${loja.id}): ${Array.isArray(atual.respostasProntas) ? (atual.respostasProntas as unknown[]).length : 0} → ${validas.length} respostas prontas`);
      if (!gravar) continue;
      // Relê na hora de gravar e só troca a chave: nada do resto do robô muda.
      const fresca = await prisma.user.findUnique({ where: { id: loja.id }, select: { chatbotConfig: true } });
      const base = (fresca?.chatbotConfig && typeof fresca.chatbotConfig === "object" ? fresca.chatbotConfig : {}) as Record<string, unknown>;
      await prisma.user.update({ where: { id: loja.id }, data: { chatbotConfig: { ...base, respostasProntas: validas } as object } });
      console.log("  gravado.");
    }
    if (!gravar) console.log("(nada gravado: rode com --gravar)");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /respostas-prontas-pizzaria-17/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
