/**
 * Respostas prontas do robô da PIZZARIA 17 e da PIZZARIA 17 AEROPORTO (e só
 * delas), pedidas pelo Antonio em 12/10/2026 (lib/respostas-prontas.ts).
 * Os textos são os que a loja já usava no WhatsApp, copiados como vieram;
 * as fotos estão em public/robo/pizzaria-17/.
 *
 * Também grava, nas instruções da loja (customPrompt), a linha do SALÃO: o
 * Antonio testou às 14h41 de 12/10 e ouviu "somos só delivery, não fazemos
 * reserva" ("preciso que ele entenda que somos salão também, e temos 120
 * lugares em cada loja"; "reserva, reservar a mesa, comemorar o aniversário,
 * agendar... sempre que tiver essas palavras, mandar as mensagens de reserva").
 *
 *   npx tsx scripts/respostas-prontas-pizzaria-17.ts            mostra o que gravaria
 *   npx tsx scripts/respostas-prontas-pizzaria-17.ts --gravar   grava (mescla no chatbotConfig)
 */
import { PrismaClient } from "@prisma/client";
import { lerRespostasProntas, type RespostaPronta } from "../src/lib/respostas-prontas";

const LOJAS = ["pizzaria-17", "pizzaria-17-aeroporto"];

/**
 * Linhas das instruções da loja (customPrompt), uma linha cada, começando pela
 * marca: rodar de novo troca as linhas antigas e mantém o que a loja escreveu.
 */
const MARCA_DO_SALAO = "SALÃO E RESERVAS:";
export const LINHA_DO_SALAO = `${MARCA_DO_SALAO} a Pizzaria 17 não é só delivery. As duas lojas têm salão para comer no local, com 120 lugares cada: Pizzaria 17 Lagomar (Avenida W 24 - Lagomar, Macaé) e Pizzaria 17 Aeroporto (R. Dr. Bezerra Menezes, 55 - Jardim Aeroporto, Macaé). Fazemos reserva de mesa e de festa: sempre que o cliente falar em reserva, reservar, reservar mesa, agendar ou marcar mesa/dia/horário, comemorar aniversário, festa, evento ou vir com um grupo, mande a resposta pronta de reserva (regras, fotos e ficha) e siga a ficha. Agendar um PEDIDO de delivery ou retirada não é reserva: aí vale o horário da loja. Nunca diga que somos só delivery ou que não temos salão.`;

/**
 * O robô manda a foto dos sabores dos combos, mas não enxerga o que ela diz:
 * "ele fala que o sabor não entra, mas não fala qual que entra" (Antonio,
 * 12/10/2026). A lista é a da foto public/robo/pizzaria-17/sabores-dos-combos.jpg.
 */
const MARCA_DOS_COMBOS = "SABORES DOS COMBOS PROMOCIONAIS:";
export const LINHA_DOS_COMBOS = `${MARCA_DOS_COMBOS} nos combos promocionais (COMBO 1 ao COMBO 7) só entram estes sabores, como diz a foto dos sabores — pizzas salgadas: Mussarela, Marguerita, Presunto, Calabresa, Bacon ovos, Milho bacon e Brasileira; pizzas doces: Banana canela, Banana leite condensado e Brigadeiro; refrigerantes: Sukita uva 2l, Sukita laranja 2l, Guaraná Antártica 1,5l e Pepsi 1,5l. O cliente pediu outro sabor ou refrigerante num desses combos? Diga com educação que esse não entra no combo e diga quais entram.`;

/**
 * O Antonio contou ao robô, pelo número dele, às 17h38 de 12/10/2026: "nossa
 * área kids tem fliperama, tem cineminha, é climatizada e tem monitora, 100%
 * gratuito" — e o robô respondeu "Anotado, adicionei", sem gravar nada (o robô
 * não grava instrução). A altura e o menor de 3 anos vêm do texto de reserva.
 */
const MARCA_DA_AREA_KIDS = "ÁREA KIDS:";
export const LINHA_DA_AREA_KIDS = `${MARCA_DA_AREA_KIDS} a Pizzaria 17 tem área kids 100% gratuita, com monitora, climatizada, com fliperama e cineminha. No parquinho, criança de até 1,30 m de altura; menores de 3 anos brincam com um responsável. Perguntou da área kids, do espaço das crianças ou se dá para levar criança: responda com isso.`;

const LINHAS_DA_LOJA = [LINHA_DO_SALAO, LINHA_DOS_COMBOS, LINHA_DA_AREA_KIDS];
const MARCAS = [MARCA_DO_SALAO, MARCA_DOS_COMBOS, MARCA_DA_AREA_KIDS];

export function instrucoesDaLoja(atual: unknown): string {
  const linhas = (typeof atual === "string" ? atual : "").split("\n").filter((l) => !MARCAS.some((m) => l.trim().startsWith(m)));
  return [linhas.join("\n").trim(), ...LINHAS_DA_LOJA].filter(Boolean).join("\n\n");
}

/**
 * As REGRAS do robô das duas lojas são as mesmas (Douglas, 12/10/2026:
 * "qualquer acesso das duas lojas tem que ser a mesma regra para o robô"): a
 * Aeroporto recebe da principal tudo o que diz COMO o robô atende. Fica de
 * fora o que é de cada loja: conexão, número, endereço de retirada, a escolha
 * de loja do grupo (só a principal) e o que o sistema grava sozinho.
 */
export const REGRAS_DO_ROBO = [
  "active", "storeType", "fazReservaDeMesa", "acceptsPickup", "aiOrderingEnabled", "conferirPedidoDoRobo",
  "autoAcceptOrders", "stopOnHumanRequest", "escalateOnComplaint", "personality", "agentName",
  "sendOrderConfirmation", "googleReviewUrl", "pixDaLoja", "menuFileQuando", "externalMenuUrl",
  "instantCouponEnabled", "instantCouponCode", "instantCouponDiscount",
  "autoRecuperation7d", "autoRecuperation15d", "autoRecuperation30d", "msg7d", "msg15d", "msg30d",
  "img7d", "img15d", "img30d", "coupon7d", "coupon15d", "coupon30d",
] as const;

export function regrasDaPrincipal(principal: Record<string, unknown>): Record<string, unknown> {
  const regras: Record<string, unknown> = {};
  for (const k of REGRAS_DO_ROBO) if (k in principal) regras[k] = principal[k];
  return regras;
}

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
    // Era só "festa, aniversário, comemoração ou evento": "vcs fazem reserva?"
    // e "quero reservar" não caíam aqui (Antonio, 12/10/2026).
    assunto: "o cliente quer reservar ou agendar mesa, lugar no salão, festa, aniversário, comemoração, evento ou mesa para um grupo (fala em reserva, reservar, reservar mesa, agendar ou marcar mesa/dia/horário, comemorar), ou pergunta se a loja faz reserva, das regras de reserva, decoração, o que pode levar (bolo, doces, salgados, bebidas), duração da festa ou área kids",
    texto: `Olá, para reservas temos as seguintes regras:

-Reservas durante a semana tem horário flexível, aos finais de semana somente para as 18h, com duração máxima de 2h30 (até as 20h30), com tolerância de 15 minutinhos após o horário marcado , sugerimos que coloque 30 minutos antes no convite.

-É Permitido levar bolo, cupcakes, docinhos e sacolinha de doces.

- *Proibido* levar qualquer alimento salgado para consumo no local como: salgadinhos, cachorro quente e outros lanches. Tambem *NÃO* pode levar qualquer bebida como, água, refrigerantes, bebida alcoólica e etc...

-Todos que estejam na festa devem estar consumindo.

-Área Kids 100% gratuita com Monitora, Crianças para entrar no parquinho devem ter até 1,30 altura, devido a estrutura do brinquedo passadas pelo fabricante menores de 3 anos pode brincar com um responsável.`,
    imagens: ["/robo/pizzaria-17/decoracao-festa-1.jpg", "/robo/pizzaria-17/decoracao-festa-2.jpg"],
    // A última regra do texto completo que o Antonio mandou às 11h33 — vem
    // DEPOIS das fotos, porque "esse modelo acima" são elas.
    textoDepois: `-O tamanho da decoração permitida é esse modelo acima

Deixe aqui algumas informações:

Nome completo:
2 Telefone para contato:

Quantidade de pessoas:
Data :
Horário:

Unidade desejada :
Ornamentação:`,
    // Ficha preenchida → a conversa vai para a equipe com os dados no aviso.
    // "Reserva", não "Reserva de festa": mesa para 6 também chega por aqui.
    fichaParaALoja: "Reserva",
  },
];

async function main() {
  const gravar = process.argv.includes("--gravar");
  // A lista passa pela mesma leitura do robô: o que ela recusaria, não grava.
  const validas = lerRespostasProntas({ respostasProntas: RESPOSTAS });
  if (validas.length !== RESPOSTAS.length) throw new Error(`Só ${validas.length} de ${RESPOSTAS.length} respostas são válidas.`);

  const prisma = new PrismaClient();
  const comoObjeto = (c: unknown) => (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
  try {
    // LOJAS[0] é a principal: as regras dela valem para as duas.
    let regras: Record<string, unknown> = {};
    for (const [i, slug] of LOJAS.entries()) {
      const loja = await prisma.user.findFirst({ where: { slug }, select: { id: true, storeName: true, chatbotConfig: true } });
      if (!loja) throw new Error(`Loja ${slug} não encontrada.`);
      const atual = comoObjeto(loja.chatbotConfig);
      if (i === 0) regras = regrasDaPrincipal(atual);
      const mudaRegra = i === 0 ? [] : Object.keys(regras).filter((k) => JSON.stringify(atual[k]) !== JSON.stringify(regras[k]));
      console.log(`${loja.storeName} (${loja.id}): ${Array.isArray(atual.respostasProntas) ? (atual.respostasProntas as unknown[]).length : 0} → ${validas.length} respostas prontas`);
      console.log(`  instruções da loja: ${instrucoesDaLoja(atual.customPrompt) === atual.customPrompt ? "já estão certas" : "ganham as linhas do salão e dos combos"}`);
      if (i > 0) console.log(`  regras da principal: ${mudaRegra.length ? mudaRegra.map((k) => `${k} ${JSON.stringify(atual[k])} → ${JSON.stringify(regras[k])}`).join("; ") : "já iguais"}`);
      if (!gravar) continue;
      // Relê na hora de gravar e só troca estas chaves: conexão e o resto ficam.
      const fresca = await prisma.user.findUnique({ where: { id: loja.id }, select: { chatbotConfig: true } });
      const base = comoObjeto(fresca?.chatbotConfig);
      await prisma.user.update({
        where: { id: loja.id },
        data: {
          chatbotConfig: {
            ...base,
            ...(i === 0 ? {} : regras),
            respostasProntas: validas,
            customPrompt: instrucoesDaLoja(base.customPrompt),
          } as object,
        },
      });
      console.log("  gravado.");
    }
    if (!gravar) console.log("(nada gravado: rode com --gravar)");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /respostas-prontas-pizzaria-17/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
