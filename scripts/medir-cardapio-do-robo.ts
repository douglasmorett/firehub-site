/**
 * Mede, nas lojas REAIS, quanto o cardápio do robô passa a custar com
 * lib/cardapio-para-o-robo.ts — e compara com o cardápio que o prompt de
 * produção levava (capturado em ab/antes.json).
 *
 *   npx tsx scripts/medir-cardapio-do-robo.ts
 *   npx tsx scripts/medir-cardapio-do-robo.ts --salvar pasta/ [--antes ab/antes.json] [ids...]
 *
 * O porquê: o robô do WhatsApp reenvia o cardápio a cada mensagem, e ele era
 * de 13 mil a 200 mil tokens por resposta. A primeira economia (só as opções
 * do produto "citado" em texto) fez o robô dizer que não tem pizza de camarão
 * a quem perguntou por áudio (Pizzaria 17, 08/10/2026). A lib nova manda o
 * cardápio inteiro, compactado; este script é a prova de quanto cabe.
 *
 * SÓ LEITURA no banco. Carrega os produtos com a MESMA consulta e o mesmo
 * select de src/lib/chatbot-ai.ts (incluindo aplicarPrecoNoCardapio para
 * "delivery" e marcarTravadoPelaPausa) e monta o mesmo contexto que o
 * chatbot-ai.ts entrega à lib — o texto medido aqui é o texto que o robô vai
 * ler. Os tokens são contados pela API do Gemini (countTokens); se ela
 * falhar, vale chars/3,4 e a tabela diz que é estimativa.
 *
 * O "atual" vem de ab/antes.json: um array de casos capturados da produção,
 * cada um com req.systemInstruction.parts[].text. O cardápio é o trecho entre
 * "NOSSO CARDÁPIO COMPLETO DA LOJA:" e "════════ DAQUI PARA BAIXO". Como ele
 * varia por conversa (o filtro por citação), medem-se o menor e o maior caso
 * de cada loja. O arquivo pode estar sendo gerado: espera-se ele existir e
 * ficar com o tamanho estável por 30 s.
 *
 * Lê .env.local e .env como o Next (ENV_DIR aponta a pasta numa worktree).
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const pasta = process.env.ENV_DIR || process.cwd();
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });

import { prisma } from "../src/lib/prisma";
import { cardapioParaORobo, type EstatisticasDoCardapio } from "../src/lib/cardapio-para-o-robo";
import { aplicarPrecoNoCardapio } from "../src/lib/preco-por-canal";
import { marcarTravadoPelaPausa } from "../src/lib/opcao-pausada";
import { SEM_PRODUTO_DE_INTEGRACAO, idsSoDeOpcaoDeCombo, motivoForaDoCardapio, textoDoHorario } from "../src/lib/cardapio-interno";
import { estoqueDaLojaOuVazio } from "../src/lib/estoque-restante";

// As lojas que motivaram a medição. Quem passa ids na linha de comando mede só eles.
const LOJAS_PADRAO = [
  "cmul9klzi004olw01xymt7yxg", // PIZZARIA 17 (os sabores são opções das 5 pizzas P/M/G/GG/XGG)
  "cmuqgmsd80006qm01gbaq6t05", // Pizzaria lá casa (cada sabor é um produto com "meio a meio" de 1/2 <sabor>)
  "cmudbzcus0008ka010pmo1e0w", // Divinos burger
  "cmumscwah017mte01ujshivvz", // Map Grill
  "cmufs5onv002dk801m56rpp5b", // Deeds Delivery
  "cmp1dn60l0000l5045kpyy7rc", // Showrrascão (a conta com 165 produtos; a outra "Showrrascão" está vazia)
  "cmtkosykk01jhk601arcsnu48", // Ragnar Burger
  "cmt1hle8y0001ia04z3ss479k", // Brazza Burguer
  "cmpx96phr0000ujf0sb0qk5vr", // Hakim Centro (contatohakim@gmail.com; a outra "Hakim Centro" é conta apagada com 1 produto)
];

const INICIO_DO_CARDAPIO = "NOSSO CARDÁPIO COMPLETO DA LOJA:";
const FIM_DO_CARDAPIO = "════════ DAQUI PARA BAIXO";
const MODELO = "gemini-3.6-flash";
const CHARS_POR_TOKEN_ESTIMADO = 3.4;

const DAY_NAMES: Record<string, string> = {
  DOM: "Domingo", SEG: "Segunda-feira", TER: "Terça-feira", QUA: "Quarta-feira",
  QUI: "Quinta-feira", SEX: "Sexta-feira", SAB: "Sábado",
};

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// O mesmo cálculo de chatbot-ai.ts (getBrazilDayCode): o dia no fuso da loja.
function diaDaLoja(tz: string, offsetDays = 0): { code: string; name: string } {
  const now = new Date();
  if (offsetDays !== 0) now.setDate(now.getDate() + offsetDays);
  const brDayStr = now.toLocaleDateString("en-US", { weekday: "short", timeZone: tz });
  const EN_TO_BR: Record<string, string> = { Sun: "DOM", Mon: "SEG", Tue: "TER", Wed: "QUA", Thu: "QUI", Fri: "SEX", Sat: "SAB" };
  const code = EN_TO_BR[brDayStr] || "QUI";
  return { code, name: DAY_NAMES[code] || "Hoje" };
}

// ── tokens ───────────────────────────────────────────────────────────────────

type Contagem = { tokens: number; estimado: boolean };
let contador: ((texto: string) => Promise<number>) | null = null;
let motivoDaEstimativa = "";

async function prepararContador() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    motivoDaEstimativa = "GEMINI_API_KEY ausente";
    return;
  }
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    contador = async (texto: string) => {
      const r = await ai.models.countTokens({ model: MODELO, contents: texto });
      if (typeof r.totalTokens !== "number") throw new Error("countTokens sem totalTokens");
      return r.totalTokens;
    };
  } catch (e: any) {
    motivoDaEstimativa = `SDK indisponível: ${e?.message}`;
  }
}

async function contarTokens(texto: string): Promise<Contagem> {
  if (contador) {
    try {
      return { tokens: await contador(texto), estimado: false };
    } catch (e: any) {
      // Uma falha derruba o contador para o resto da medição: tabela com
      // metade contada e metade estimada confunde mais do que ajuda.
      motivoDaEstimativa = `countTokens falhou: ${e?.message}`;
      contador = null;
    }
  }
  return { tokens: Math.round(texto.length / CHARS_POR_TOKEN_ESTIMADO), estimado: true };
}

// ── o cardápio atual, capturado da produção ───────────────────────────────────

type CasoCapturado = { loja: string; userId: string; req?: { systemInstruction?: { parts?: { text?: string }[] } } };
type CardapioCapturado = { chars: number; texto: string; promptChars: number };

async function esperarArquivoEstavel(caminho: string, janelaMs = 30_000): Promise<boolean> {
  const inicio = Date.now();
  let ultimoTamanho = -1;
  let estavelDesde = 0;
  while (Date.now() - inicio < 10 * 60_000) {
    if (fs.existsSync(caminho)) {
      const tamanho = fs.statSync(caminho).size;
      if (tamanho === ultimoTamanho) {
        if (Date.now() - estavelDesde >= janelaMs) return true;
      } else {
        ultimoTamanho = tamanho;
        estavelDesde = Date.now();
      }
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

async function cardapiosCapturados(caminho: string): Promise<Map<string, { loja: string; menor: CardapioCapturado; maior: CardapioCapturado; casos: number }>> {
  const porLoja = new Map<string, { loja: string; menor: CardapioCapturado; maior: CardapioCapturado; casos: number }>();
  if (!caminho) return porLoja;
  const existe = await esperarArquivoEstavel(caminho);
  if (!existe) {
    console.error(`[antes] ${caminho} não apareceu ou não parou de crescer; comparação com o atual pulada.`);
    return porLoja;
  }
  const casos: CasoCapturado[] = JSON.parse(fs.readFileSync(caminho, "utf8"));
  for (const c of casos) {
    const prompt = (c.req?.systemInstruction?.parts || []).map((p) => p.text || "").join("\n");
    const i = prompt.indexOf(INICIO_DO_CARDAPIO);
    const j = prompt.indexOf(FIM_DO_CARDAPIO);
    if (i < 0 || j < 0 || j <= i) continue;
    const texto = prompt.slice(i, j);
    const atual: CardapioCapturado = { chars: texto.length, texto, promptChars: prompt.length };
    const reg = porLoja.get(c.userId);
    if (!reg) porLoja.set(c.userId, { loja: c.loja, menor: atual, maior: atual, casos: 1 });
    else {
      reg.casos++;
      if (atual.chars < reg.menor.chars) reg.menor = atual;
      if (atual.chars > reg.maior.chars) reg.maior = atual;
    }
  }
  return porLoja;
}

// ── o cardápio novo, da lib ───────────────────────────────────────────────────

type Medida = {
  id: string;
  loja: string;
  carregados: { produtos: number; grupos: number; opcoes: number };
  estatisticas: EstatisticasDoCardapio;
  novo: Contagem;
  atual: { casos: number; menor: Contagem & { chars: number }; maior: Contagem & { chars: number; promptChars: number } } | null;
  texto: string;
};

async function medirLoja(id: string): Promise<Medida | null> {
  const user = await prisma.user.findUnique({ where: { id }, select: { storeName: true, storeTimezone: true } });
  if (!user) {
    console.error(`[${id}] loja não encontrada`);
    return null;
  }
  const tz = user.storeTimezone || "America/Sao_Paulo";

  // A MESMA consulta de src/lib/chatbot-ai.ts (where e select), para o texto
  // medido ser o texto que o robô lê — qualquer diferença aqui mede outra coisa.
  const produtosCrus = await prisma.menuProduct.findMany({
    where: {
      franchiseeId: id,
      active: true,
      activeDelivery: true,
      AND: [{ NOT: { apenasEmCombo: true } }, SEM_PRODUTO_DE_INTEGRACAO],
    },
    select: {
      id: true, name: true, description: true, price: true, priceDelivery: true, promoPrice: true, category: true,
      isCombo: true, isBeverage: true, availableDays: true, availableHours: true, tags: true,
      comboGroups: {
        select: {
          id: true, title: true, maxQty: true, minQty: true, priceRule: true,
          items: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              additionalPrice: true, additionalPriceDelivery: true,
              precoPorEscolha: true,
              promoAdditionalPrice: true,
              maxPerItem: true,
              menuProduct: { select: { id: true, name: true, price: true, active: true } },
            },
          },
        },
      },
    },
    orderBy: { category: "asc" },
  });

  const products = aplicarPrecoNoCardapio(produtosCrus as any[], "delivery").map((p: any) => marcarTravadoPelaPausa(p));

  // O contexto, igual ao que chatbot-ai.ts monta antes de chamar a lib.
  const soOpcaoDeCombo = idsSoDeOpcaoDeCombo(produtosCrus as any[]);
  const estoqueDoRobo = await estoqueDaLojaOuVazio(id);
  const idsForaDoHorarioAgora = new Set<string>();
  const horarioPorId = new Map<string, string>();
  for (const p of products as any[]) {
    const horarioDoItem = textoDoHorario(p.availableHours);
    if (!horarioDoItem) continue;
    horarioPorId.set(String(p.id), horarioDoItem);
    if (motivoForaDoCardapio({ availableHours: p.availableHours }, tz) === "horario") idsForaDoHorarioAgora.add(String(p.id));
  }
  const hoje = diaDaLoja(tz, 0);
  const amanha = diaDaLoja(tz, 1);

  const { texto, estatisticas } = cardapioParaORobo(products as any[], {
    currentDayCode: hoje.code, currentDayName: hoje.name, tomorrowDayCode: amanha.code, tomorrowDayName: amanha.name,
    idsSoDeOpcaoDeCombo: soOpcaoDeCombo,
    estoque: estoqueDoRobo as any,
    idsForaDoHorarioAgora,
    horarioPorId,
  });

  const grupos = produtosCrus.reduce((s, p) => s + p.comboGroups.length, 0);
  const opcoes = produtosCrus.reduce((s, p) => s + p.comboGroups.reduce((t, g) => t + g.items.length, 0), 0);

  return {
    id,
    loja: user.storeName || id,
    carregados: { produtos: produtosCrus.length, grupos, opcoes },
    estatisticas,
    novo: await contarTokens(texto),
    atual: null,
    texto,
  };
}

// ── relatório ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString("pt-BR");
const tok = (c: Contagem) => `${fmt(c.tokens)}${c.estimado ? "*" : ""}`;

function tabela(medidas: Medida[]): string {
  const linhas = [
    "| Loja | Produtos (carregados/no texto) | Grupos | Opções | Atual mín. | Atual máx. | Novo | Novo vs máx. | Listas compart. | Matrizes | Meios a meio | Chars novo |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const m of medidas) {
    const a = m.atual;
    const vsMax = a ? `${Math.round((100 * m.novo.tokens) / a.maior.tokens)}%` : "—";
    linhas.push(
      `| ${m.loja} | ${m.carregados.produtos}/${m.estatisticas.produtos} | ${m.carregados.grupos} | ${m.carregados.opcoes} | ${a ? tok(a.menor) : "sem captura"} | ${a ? tok(a.maior) : "sem captura"} | ${tok(m.novo)} | ${vsMax} | ${m.estatisticas.listasCompartilhadas} | ${m.estatisticas.matrizes} | ${m.estatisticas.meiosAMeio} | ${fmt(m.estatisticas.chars)} |`,
    );
  }
  return linhas.join("\n");
}

async function main() {
  const salvarEm = argumento("--salvar");
  const caminhoDoAntes = argumento("--antes") ?? path.join(process.cwd(), "ab", "antes.json");
  const ids = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && !(i > 0 && arr[i - 1].startsWith("--")));
  const lojas = ids.length ? ids : LOJAS_PADRAO;

  await prepararContador();
  const capturados = await cardapiosCapturados(caminhoDoAntes);

  const medidas: Medida[] = [];
  for (const id of lojas) {
    const m = await medirLoja(id);
    if (!m) continue;
    const cap = capturados.get(id);
    if (cap) {
      const menor = await contarTokens(cap.menor.texto);
      const maior = cap.maior.chars === cap.menor.chars ? menor : await contarTokens(cap.maior.texto);
      m.atual = {
        casos: cap.casos,
        menor: { ...menor, chars: cap.menor.chars },
        maior: { ...maior, chars: cap.maior.chars, promptChars: cap.maior.promptChars },
      };
    }
    medidas.push(m);
    console.error(`${m.loja}: novo ${tok(m.novo)} tokens (${fmt(m.estatisticas.chars)} chars)${m.atual ? ` · atual ${tok(m.atual.menor)}–${tok(m.atual.maior)} em ${m.atual.casos} casos` : " · sem captura em antes.json"}`);
    if (salvarEm) {
      fs.mkdirSync(salvarEm, { recursive: true });
      const base = path.join(salvarEm, `${m.loja.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}`);
      fs.writeFileSync(`${base}.novo.txt`, m.texto);
      if (cap) {
        fs.writeFileSync(`${base}.atual-menor.txt`, cap.menor.texto);
        fs.writeFileSync(`${base}.atual-maior.txt`, cap.maior.texto);
      }
    }
  }

  console.log(tabela(medidas));
  if (motivoDaEstimativa) console.log(`\n* tokens ESTIMADOS por chars/${CHARS_POR_TOKEN_ESTIMADO} (${motivoDaEstimativa}); os demais contados por ${MODELO} countTokens.`);
  else console.log(`\nTokens contados por ${MODELO} countTokens.`);
  const semCaptura = medidas.filter((m) => !m.atual).map((m) => m.loja);
  if (semCaptura.length) console.log(`Sem caso em ${caminhoDoAntes}: ${semCaptura.join(", ")}.`);

  if (salvarEm) {
    fs.writeFileSync(
      path.join(salvarEm, "medicao.json"),
      JSON.stringify(medidas.map(({ texto: _t, ...resto }) => resto), null, 1),
    );
    console.log(`Textos e medicao.json em ${salvarEm}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
