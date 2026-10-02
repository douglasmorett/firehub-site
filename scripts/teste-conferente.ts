/**
 * O revisor do robô do FireHub (src/lib/atendimento/conferente.ts) contra o
 * Gemini de verdade: o caso que o originou (Ragnar, 01/10/2026) tem que ser
 * barrado e as respostas com fonte têm que passar.
 *   GEMINI_API_KEY=... npx tsx scripts/teste-conferente.ts
 */
import { GoogleGenAI } from "@google/genai";
import { conferirResposta } from "../src/lib/atendimento/conferente";
import { CONHECIMENTO_DO_FIREHUB } from "../src/lib/atendimento/conhecimento";

const casos: { nome: string; conversa: string; ferramentas?: string; resposta: string; esperado: boolean }[] = [
  {
    nome: "Ragnar: delivery para mesa (inventado)",
    conversa: `Equipe (Douglas): Sobre a comanda com QR na impressora da pizza: era o #85, Combo Berserker com Fanta. Achei e já deixei corrigido: a bebida do combo não conta mais, a via vai pro burger.
Contato: Show
Contato: Quando o cliente está no salão e acaba fazendo o pedido pelo delivery. Dá pra mudar para mesa.?????`,
    resposta: "Pra mudar o pedido que entrou como delivery para mesa, você pode abrir o pedido no painel de *Pedidos*, clicar nele para ver os detalhes e alterar o tipo dele (ou a forma de entrega) direto por ali! Quer que eu confirme o passo a passo exato na sua tela?",
    esperado: true,
  },
  {
    nome: "Diz que não dá (também sem fonte)",
    conversa: "Contato: Dá pra dividir a conta da mesa por pessoa?",
    resposta: "Infelizmente o FireHub ainda não divide a conta por pessoa.",
    esperado: true,
  },
  {
    nome: "Segura e chama a equipe",
    conversa: "Contato: Dá pra mudar o pedido de delivery para mesa?",
    resposta: "Essa eu vou confirmar com a nossa equipe para não te passar nada errado. Alguém já te responde por aqui.",
    esperado: false,
  },
  {
    nome: "Impressora: passo da base",
    conversa: "Contato: a comanda parou de imprimir",
    ferramentas: 'estado_da_loja: {"assistente":{"ultimaConsulta":"há 3 horas"}}',
    resposta: "Vi aqui que o Assistente de Impressão não conversa com a gente há 3 horas. O computador do caixa está ligado? Confere se o ícone 🔥 está perto do relógio do Windows.",
    esperado: false,
  },
  {
    nome: "Preço da base",
    conversa: "Contato: quanto custa?",
    resposta: "É 1% do que a loja fatura no FireHub, com mínimo de R$ 100 e máximo de R$ 400 por mês. Sem taxa por pedido.",
    esperado: false,
  },
  {
    nome: "Repete o que a equipe disse",
    conversa: `Equipe (Douglas): Achei e já deixei corrigido: a bebida do combo não conta mais, a via vai pro burger. Te aviso quando estiver no ar
Contato: e a via do motoboy, já tá certa?`,
    resposta: "O Douglas já corrigiu: a bebida do combo não conta mais e a via vai pro burger. Ele te avisa quando estiver no ar!",
    esperado: false,
  },
];

async function main() {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) throw new Error("GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey: chave });
  let falhas = 0;
  for (const c of casos) {
    const v = await conferirResposta(ai, { base: CONHECIMENTO_DO_FIREHUB, conversa: c.conversa, ferramentas: c.ferramentas || "", resposta: c.resposta });
    const ok = v !== null && v.inventou === c.esperado;
    if (!ok) falhas++;
    console.log(`${ok ? "OK  " : "FALHOU"} ${c.nome} → ${JSON.stringify(v)}`);
  }
  console.log(falhas ? `${falhas} falha(s)` : "Tudo certo");
  process.exit(falhas ? 1 : 0);
}
main();
