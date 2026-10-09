/**
 * O CARDÁPIO INTEIRO, NO MENOR TEXTO POSSÍVEL, PARA O ROBÔ DO WHATSAPP.
 *
 * O robô relê o cardápio a cada mensagem, e o cardápio era quase todo o custo
 * do prompt (13 mil a 200 mil tokens por resposta). A primeira economia
 * (lib/cardapio-citado.ts, que saiu em 09/10/2026) mandava as opções completas só do produto que a
 * conversa "citou" em texto — e quebrou de dois jeitos:
 *
 *   - Pizzaria 17, 08/10/2026: o cliente perguntou por ÁUDIO "tem pizza de
 *     camarão?". Áudio não cita palavra nenhuma, os sabores (que lá são OPÇÕES
 *     das cinco pizzas P/M/G/GG/XGG) ficaram fora do prompt e o robô respondeu
 *     que não tem camarão — a loja vende.
 *   - Pizzaria Lá Casa: a palavra "pizza" cita as 76 pizzas, cada uma com um
 *     grupo "Meio a meio?" de 75 opções "1/2 <outro sabor>", e o prompt foi a
 *     200 mil tokens.
 *
 * Aqui vai o cardápio COMPLETO, sempre, sem filtro por citação — e cabe,
 * porque o que se repete é escrito uma vez:
 *
 *   1. LISTA COMPARTILHADA: a mesma pergunta (título, quantas escolhas, regra
 *      e opções com preço) em vários produtos vai uma vez na seção LISTAS DE
 *      OPÇÕES; o produto só a cita ("perguntas: L1"). É o "Turbine seu Burger"
 *      repetido em 29 lanches da Divinos. Quando só a lista de opções coincide
 *      (os mesmos 10 sabores em "Pizza M: escolha 2 sabores" e em "Pizza XGG:
 *      escolha 4 sabores"), compartilha-se a lista e o título fica no produto.
 *   2. MATRIZ: vários produtos com o MESMO conjunto de opções e só os preços
 *      diferentes (os 51 sabores nas 5 pizzas da Pizzaria 17) viram uma tabela
 *      "sabor: P 43 | M 55 | G 68 ...", e cada produto aponta a coluna dele.
 *   3. MEIO A MEIO: pergunta cujas opções são todas outras pizzas da loja
 *      ("1/2 <nome>", ou o nome exato) vira uma linha de regra ("a outra
 *      metade é qualquer pizza de X; vale o preço da mais cara"), em vez das
 *      75 opções. Só quando TODAS as opções são pizzas que existem E o preço
 *      gravado bate com a regra (lib/meio-a-meio.ts) — senão a lista vai inteira.
 *
 * Nada se perde: todo produto, toda pergunta e toda opção estão no texto, por
 * extenso ou por referência, com o nome EXATO do cadastro — é com ele que a
 * tag do pedido casa (lib/item-do-robo.ts). Opção pausada vai listada como
 * indisponível: "tem calabresa?" merece "acabou agora", não "não conheço".
 *
 * O texto é ESTÁVEL entre mensagens (o Gemini cacheia o prompt): aqui não entra
 * hora atual, nome de cliente nem pedido. O que muda com o relógio (fora do
 * horário do produto) o chamador decide e passa pronto no contexto.
 *
 * Só funções puras: quem carrega o cardápio do banco e resolve o preço do
 * canal é chatbot-ai.ts; o teste (scripts/teste-cardapio-para-o-robo.mjs)
 * chama esta função com fixtures.
 */
import {
  bloqueiosDaOpcao,
  minimoExigidoDoGrupo,
  precoMinimoDoProduto,
  precoVariaPorEscolha,
  regraDoGrupo,
  tabelaDaOpcao,
} from "./preco-combo";
import { opcaoPausada, semOpcoesPausadas } from "./opcao-pausada";
import { ehPerguntaDeMeio, meiaNaPizza, PREFIXO_DA_MEIA, regraDoTitulo, type RegraDoMeio } from "./meio-a-meio";

export type ContextoDoCardapio = {
  /** "QUI" / "Quinta-feira" — o dia no fuso da LOJA, calculado por quem chama. */
  currentDayCode: string;
  currentDayName: string;
  tomorrowDayCode: string;
  tomorrowDayName: string;
  /** Produtos que só existem como opção de combo (lib/cardapio-interno.ts, idsSoDeOpcaoDeCombo). Ficam de fora. */
  idsSoDeOpcaoDeCombo?: Set<string>;
  /** Estoque do dia por id (lib/estoque-restante.ts): esgotado sai, "últimas N" vai na linha. */
  estoque?: Map<string, { restam: number; pausaAoZerar: boolean }>;
  /**
   * Produtos com horário (availableHours) que estão FORA dele neste momento.
   * É o único dado "de agora" que entra, e muda só quando o item abre ou
   * fecha — não a cada minuto. O chamador calcula com motivoForaDoCardapio.
   */
  idsForaDoHorarioAgora?: Set<string>;
  /** "das 09:00 às 14:00" por id, para o produto com horário (lib/cardapio-interno.ts, textoDoHorario). */
  horarioPorId?: Map<string, string>;
};

export type EstatisticasDoCardapio = {
  produtos: number;
  grupos: number;
  opcoes: number;
  listasCompartilhadas: number;
  matrizes: number;
  meiosAMeio: number;
  chars: number;
};

const DAY_NAMES: Record<string, string> = {
  DOM: "Domingo", SEG: "Segunda-feira", TER: "Terça-feira", QUA: "Quarta-feira",
  QUI: "Quinta-feira", SEX: "Sexta-feira", SAB: "Sábado",
};
const TODOS_OS_DIAS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

/** "43" / "10,90": sem os centavos quando são zero — na matriz de 255 preços isso é 1/3 do texto. */
export function brl(n: number): string {
  const v = Math.round(Math.abs(n) * 100) / 100;
  const inteiro = Math.floor(v);
  const centavos = Math.round((v - inteiro) * 100);
  return centavos === 0 ? String(inteiro) : `${inteiro},${String(centavos).padStart(2, "0")}`;
}

const perto = (a: number, b: number) => Math.abs(a - b) < 0.011;
const nomeLimpo = (p: any) => String(p?.name || "").split("|")[0].trim();
const nomeDaOpcao = (i: any) => String(i?.menuProduct?.name || "").trim();

function descricaoCurta(d: unknown, limite = 120): string {
  const t = String(d ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= limite) return t;
  const corte = t.lastIndexOf(" ", limite - 1);
  return `${t.slice(0, corte > 60 ? corte : limite - 1)}…`;
}

function tagsDoProduto(p: any): string[] {
  try {
    const t = typeof p?.tags === "string" ? JSON.parse(p.tags) : p?.tags;
    return Array.isArray(t) ? t.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function diasDoProduto(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((d) => String(d).toUpperCase());
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map((d) => String(d).toUpperCase());
    } catch {
      return val.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    }
  }
  return [];
}

const nomesDosDias = (dias: string[]) =>
  dias.length === 7 ? "todos os dias" : TODOS_OS_DIAS.filter((d) => dias.includes(d)).map((d) => DAY_NAMES[d] || d).join(", ");

// As mesmas regras do chatbot-ai.ts para combo e promoção, para o robô não
// mudar de ideia sobre o que é o quê só porque o texto ficou menor. Uma
// diferença: "kit" e "pack" só no COMEÇO da palavra — "Sukita Uva 2L" entrava
// como combo por conter "kit".
const ehImportadoDeCanal = (p: any) => /jotaja|ifood|online/i.test(String(p?.category || ""));
const ehCombo = (p: any, nome: string) =>
  p?.isCombo === true || /\b(combo|kit|pack)/i.test(nome) || /combo|oferta/i.test(String(p?.category || ""));
function ehPromocao(p: any, nome: string, tags: string[]): boolean {
  if (ehImportadoDeCanal(p)) return false;
  return (
    Number(p?.precoDe) > 0 ||
    tags.some((t) => /promo|promoção|promocao|oferta/i.test(t)) ||
    /promo|promoção|promocao|oferta do dia|do dia/i.test(nome) ||
    /promo|promoção|promocao|oferta/i.test(String(p?.category || ""))
  );
}

// ── A PERGUNTA, PREPARADA ─────────────────────────────────────────────────────

type Opcao = { nome: string; acrescimo: number; valor: number; tabela: [string, number][] };

type Pergunta = {
  titulo: string;
  /** "1 obrig." / "até 3, opcional" / "2 a 4" */
  quantas: string;
  /** "; é 1 pizza: vale o sabor mais caro" ou "" */
  regra: string;
  /** Preço escrito como "= R$ X" (tamanho, uma pizza) ou como "+R$ X" (adicional). */
  absoluto: boolean;
  /** Opções que se podem escolher agora (sem as pausadas). `valor` já está no modo do grupo. */
  opcoes: Opcao[];
  pausadas: string[];
  /** Nenhuma opção acresce nada: o nome basta, o preço é o do produto. */
  semAcrescimo: boolean;
  /** Linha de regra do meio a meio, quando a pergunta inteira cabe numa regra. */
  meioAMeio: string | null;
  /** Preenchido na passagem da matriz. */
  matriz: { id: string; coluna: string } | null;
  totalDeOpcoes: number;
};

function prepararPergunta(g: any, original: any, produto: any, loja: Map<string, any>): Pergunta | null {
  const itens = (g?.items || []).filter((i: any) => nomeDaOpcao(i));
  // Em ordem alfabética: a mesma pergunta com as mesmas pausadas em outra
  // ordem é a mesma pergunta, e tem que compartilhar a lista.
  const pausadas: string[] = (original?.items || [])
    .filter((i: any) => opcaoPausada(i) && nomeDaOpcao(i))
    .map(nomeDaOpcao)
    .sort((a: string, b: string) => a.localeCompare(b, "pt-BR"));
  if (itens.length === 0 && pausadas.length === 0) return null;

  const precoBase = Number(produto.price) || 0;
  const max = Math.max(1, Number(g.maxQty) || 1);
  const min = minimoExigidoDoGrupo(g);
  const quantas = min === 0 ? (max === 1 ? "opcional" : `até ${max}, opcional`) : min === max ? `${min} obrig.` : `${min} a ${max}`;
  const regraDePreco = regraDoGrupo(g);
  const umaPizza = max > 1 && regraDePreco !== "SOMA";
  const regra = !umaPizza ? "" : regraDePreco === "MEDIA" ? "; é 1 pizza: vale a média dos sabores" : "; é 1 pizza: vale o sabor mais caro";

  // Pergunta de escolha única e obrigatória (Tamanho) vai com o preço
  // ABSOLUTO de cada opção, que é como o cliente pensa ("o Grande custa X");
  // sabores de UMA pizza (MAIOR/MÉDIA) também, senão a IA soma. Mas a
  // "Escolha a bebida" do combo, em que só a Coca acresce, é adicional: ali
  // "Pepsi = R$ 104,99 | ... | Coca = R$ 112,99" repetia o preço do combo em
  // cada lata — é absoluto só quando a maioria das opções tem acréscimo.
  const acrescimos: number[] = itens.map((i: any) => Number(i.additionalPrice) || 0);
  const comAcrescimo = acrescimos.filter((a) => a !== 0).length;
  const absoluto = umaPizza || (min > 0 && max === 1 && comAcrescimo * 2 >= itens.length);

  const opcoes: Opcao[] = itens.map((i: any, k: number) => ({
    nome: nomeDaOpcao(i),
    acrescimo: acrescimos[k],
    valor: absoluto ? precoBase + acrescimos[k] : acrescimos[k],
    tabela: tabelaDaOpcao(i),
  }));

  return {
    titulo: String(g?.title || "Opções").trim() || "Opções",
    quantas, regra, absoluto, opcoes, pausadas,
    semAcrescimo: comAcrescimo === 0 && opcoes.every((o) => o.tabela.length === 0),
    meioAMeio: regraDoMeioAMeio(g, itens, produto, loja),
    matriz: null,
    totalDeOpcoes: itens.length + pausadas.length,
  };
}

/**
 * A pergunta de meio a meio que cabe numa frase.
 *
 * Só quando TODAS as opções são outras pizzas desta loja — "1/2 <nome>" (o
 * molde de lib/meio-a-meio.ts) ou o nome exato (a NIK) — e o preço gravado em
 * cada uma bate com uma regra: sem custo, a média das duas metades ou a mais
 * cara, conferido com a mesma conta que grava a meia (`meiaNaPizza`). Aí o
 * nome exato de cada opção é dedutível do nome do produto, que está na lista
 * de PRODUTOS, e o preço sai da regra. Preço que não bate com regra nenhuma
 * (acréscimo avulso) vai na lista inteira, como qualquer outra pergunta.
 *
 * Se a lista cobre só parte de uma categoria, a frase diz quais faltam; se
 * cobre menos da metade, não há frase.
 */
function regraDoMeioAMeio(g: any, itens: any[], produto: any, loja: Map<string, any>): string | null {
  if (itens.length < 3) return null;
  const nomes = itens.map((i: any) => nomeDaOpcao(i));
  const comPrefixo = nomes.every((n) => n.startsWith(PREFIXO_DA_MEIA));
  if (!comPrefixo && !ehPerguntaDeMeio(g?.title)) return null;
  const nomeDoProduto = nomeLimpo(produto);
  const baseDe = (n: string) => (comPrefixo ? n.slice(PREFIXO_DA_MEIA.length) : n);
  const outras = nomes.map((n) => loja.get(baseDe(n)));
  if (outras.some((o) => !o || nomeLimpo(o) === nomeDoProduto)) return null;

  // Tamanho em que a casa não faz meio a meio: bloqueado em TODAS as meias
  // (a Serpa não faz na Pequena, lib/meio-a-meio.ts). Bloqueio só em algumas
  // é conta de tamanho que a outra pizza não tem, e o sistema recusa sozinho.
  const bloqueadosEmTodas = bloqueiosDaOpcao(itens[0]).filter((t) => itens.every((i: any) => bloqueiosDaOpcao(i).includes(t)));

  const bate = (regra: RegraDoMeio) =>
    itens.every((i: any, k: number) => {
      const esperado = meiaNaPizza(produto, outras[k], regra, bloqueadosEmTodas);
      if (!perto(esperado.additionalPrice, Number(i.additionalPrice) || 0)) return false;
      const gravada = new Map(tabelaDaOpcao(i));
      const calculada = Object.entries(esperado.precoPorEscolha || {}).filter(([, v]) => v !== null) as [string, number][];
      if (calculada.length === 0) return gravada.size === 0;
      return calculada.every(([t, v]) => gravada.has(t) && perto(gravada.get(t)!, v));
    });
  // A regra escrita no título vem primeiro: na pizza mais cara da casa toda
  // meia custa zero sob "vale a mais cara", e "sem custo extra" também seria
  // verdade — mas a frase da regra tem que ser a MESMA em todas as pizzas,
  // senão a lista não compartilha e o robô lê duas regras para a mesma casa.
  const FRASE: Record<RegraDoMeio, string> = { maior: "vale o preço da metade mais cara", media: "vale a média do preço das duas metades" };
  const candidatas: RegraDoMeio[] = ehPerguntaDeMeio(g?.title) ? [regraDoTitulo(g?.title), "maior", "media"] : ["maior", "media"];
  const regra = candidatas.find(bate);
  const semCusto = itens.every((i: any) => !(Number(i.additionalPrice) || 0) && tabelaDaOpcao(i).every(([, v]) => v === 0));
  const preco = regra ? FRASE[regra] : semCusto ? "sem custo extra" : null;
  if (!preco) return null;

  // Cobertura por categoria: a frase cita a categoria inteira, ou a categoria
  // com as exceções. O próprio produto não conta (a Calabresa não é meia dela mesma).
  const cobertos = new Set(nomes.map(baseDe));
  const porCategoria = new Map<string, string[]>();
  for (const [nome, p] of loja) {
    if (nome === nomeDoProduto) continue;
    const cat = String(p?.category || "").trim() || "Outros";
    if (!porCategoria.has(cat)) porCategoria.set(cat, []);
    porCategoria.get(cat)!.push(nome);
  }
  const partes: string[] = [];
  for (const [cat, lista] of porCategoria) {
    const dentro = lista.filter((n) => cobertos.has(n));
    if (dentro.length === 0) continue;
    const fora = lista.filter((n) => !cobertos.has(n));
    if (fora.length === 0) partes.push(cat);
    else if (dentro.length >= lista.length / 2 && fora.length <= 3) partes.push(`${cat} (exceto ${fora.join(", ")})`);
    else return null;
  }
  if (partes.length === 0) return null;

  const semMeio = bloqueadosEmTodas.length ? `; não tem meio a meio no tamanho ${bloqueadosEmTodas.join(" nem ")}` : "";
  const grafia = comPrefixo ? `escrita exatamente "${PREFIXO_DA_MEIA}<nome da pizza>"` : "escrita com o nome exato da pizza";

  return `a outra metade é qualquer outra pizza de ${partes.join(", ")}, ${grafia}; ${preco}${semMeio}; o sistema calcula o valor exato`;
}

/** "Bacon +R$ 4" / "Grande = R$ 79" / "1/2 Camarão +R$ 5 (Pequena) / +R$ 15 (Grande)" / "Muçarela" (sem custo). */
function textoDaOpcao(o: Opcao, q: Pergunta): string {
  if (o.tabela.length > 0) {
    const sinal = (v: number) => `${v < 0 ? "−" : "+"}R$ ${brl(v)}`;
    return `${o.nome} ${o.tabela.map(([t, v]) => `${sinal(v)} (${t})`).join(" / ")}`;
  }
  if (q.absoluto) return q.semAcrescimo ? o.nome : `${o.nome} = R$ ${brl(o.valor)}`;
  if (o.valor < 0) return `${o.nome} −R$ ${brl(o.valor)} (desconta)`;
  return o.valor > 0 ? `${o.nome} +R$ ${brl(o.valor)}` : o.nome;
}

/**
 * A pergunta em duas partes: "Título (quantas; regra)" e o corpo (opções,
 * regra do meio ou coluna da tabela). O corpo que aponta para a tabela é um
 * ponteiro do produto, não uma lista: não se compartilha.
 */
function textoDaPergunta(q: Pergunta): { cabeca: string; corpo: string; listaCompartilhavel: boolean } {
  const cabeca = `${q.titulo} (${q.quantas}${q.regra})`;
  const aviso = q.pausadas.length ? ` · indisponíveis agora, não anotar: ${q.pausadas.join(", ")}` : "";
  if (q.meioAMeio) return { cabeca, corpo: `${q.meioAMeio}${aviso}`, listaCompartilhavel: true };
  if (q.matriz) return { cabeca, corpo: `sabores e preços na tabela ${q.matriz.id}, coluna ${q.matriz.coluna}${aviso}`, listaCompartilhavel: false };
  return { cabeca, corpo: `${q.opcoes.map((o) => textoDaOpcao(o, q)).join(" | ")}${aviso}`.trim(), listaCompartilhavel: true };
}

// ── A MATRIZ DE SABORES ───────────────────────────────────────────────────────

type Coluna = { produtos: string[]; valores: number[]; rotulo: string };
type Matriz = { id: string; absoluto: boolean; nomes: string[]; pausadas: string[]; colunas: Coluna[] };

/**
 * O rótulo da coluna é a palavra que distingue o produto dos outros da tabela
 * ("Pizza P (4 Fatias)" → "P"). Quando não há uma só palavra que distinga,
 * vale o número da coluna.
 */
function rotulosDasColunas(colunas: { produtos: string[] }[]): string[] {
  const palavras = (n: string) => n.split(/\s+/).map((w) => w.replace(/^[(\[]+|[)\],.:;]+$/g, "")).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const todas = colunas.map((c) => palavras(c.produtos[0]));
  const comuns = new Set(todas[0].filter((w) => todas.every((ws) => ws.includes(w))));
  const rotulos = todas.map((ws) => ws.find((w) => !comuns.has(w)) || "");
  if (rotulos.some((r) => !r) || new Set(rotulos).size !== rotulos.length) return colunas.map((_, i) => String(i + 1));
  return rotulos;
}

/**
 * Agrupa as perguntas com o MESMO conjunto de opções e o mesmo modo de preço;
 * onde os ACRÉSCIMOS diferem entre produtos nasce uma matriz. Acréscimo igual
 * em todos é lista compartilhada, não matriz (o dedupe cuida) — e é por isso
 * que a conta olha o acréscimo, não o preço final: a "Pizza P doce" dos combos
 * da Pizzaria 17 tem os mesmos 3 sabores a +R$ 0 em combos de preços
 * diferentes, e virava uma tabela de preços de combo. Opção com tabela por
 * tamanho e pergunta de meio a meio ficam de fora. Matriz com muitas colunas,
 * ou com muitos produtos por coluna, não é tabela — é lista: ali o dedupe
 * escreve melhor.
 */
function montarMatrizes(perguntas: { nome: string; q: Pergunta }[]): Matriz[] {
  const candidatas = new Map<string, { nome: string; q: Pergunta }[]>();
  for (const pq of perguntas) {
    const { q } = pq;
    if (q.meioAMeio || q.semAcrescimo || q.opcoes.length < 3 || q.opcoes.some((o) => o.tabela.length > 0)) continue;
    const chave = `${q.absoluto ? "=" : "+"}|${[...q.opcoes.map((o) => o.nome), ...q.pausadas.map((n) => `⏸${n}`)].sort().join("\u0001")}`;
    if (!candidatas.has(chave)) candidatas.set(chave, []);
    candidatas.get(chave)!.push(pq);
  }
  const matrizes: Matriz[] = [];
  for (const grupo of candidatas.values()) {
    const nomes = grupo[0].q.opcoes.map((o) => o.nome);
    const vetor = (q: Pergunta, campo: "acrescimo" | "valor") => {
      const porNome = new Map(q.opcoes.map((o) => [o.nome, o[campo]]));
      return nomes.map((n) => porNome.get(n) ?? 0);
    };
    const acrescimosDistintos = new Set(grupo.map(({ q }) => vetor(q, "acrescimo").map((v) => Math.round(v * 100)).join(",")));
    if (acrescimosDistintos.size < 2) continue;

    const colunas: Coluna[] = [];
    for (const { nome, q } of grupo) {
      const valores = vetor(q, "valor");
      const igual = colunas.find((c) => c.valores.every((v, i) => perto(v, valores[i])));
      if (igual) {
        if (!igual.produtos.includes(nome)) igual.produtos.push(nome);
      } else colunas.push({ produtos: [nome], valores, rotulo: "" });
    }
    if (colunas.length < 2 || colunas.length > 8 || colunas.some((c) => c.produtos.length > 4)) continue;

    // Da mais barata para a mais cara (P, M, G, GG, XGG), não na ordem do cadastro.
    colunas.sort((a, b) => a.valores.reduce((s, v) => s + v, 0) - b.valores.reduce((s, v) => s + v, 0));
    rotulosDasColunas(colunas).forEach((r, i) => (colunas[i].rotulo = r));
    const m: Matriz = { id: `T${matrizes.length + 1}`, absoluto: grupo[0].q.absoluto, nomes, pausadas: grupo[0].q.pausadas, colunas };
    matrizes.push(m);
    for (const { nome, q } of grupo) {
      q.matriz = { id: m.id, coluna: colunas.find((c) => c.produtos.includes(nome))!.rotulo };
    }
  }
  return matrizes;
}

function textoDaMatriz(m: Matriz): string[] {
  const valor = (v: number) => (v < 0 ? `−${brl(v)}` : brl(v));
  const linhas = [
    `${m.id} · ${m.absoluto ? "preço = R$ do produto inteiro nesse sabor" : "valor = acréscimo em R$ por opção"} · colunas: ${m.colunas.map((c) => `${c.rotulo} = ${c.produtos.join(" e ")}`).join(" | ")}`,
  ];
  m.nomes.forEach((n, i) => {
    linhas.push(`  ${n}: ${m.colunas.map((c) => valor(c.valores[i])).join(" | ")}`);
  });
  if (m.pausadas.length) linhas.push(`  indisponíveis agora, não anotar: ${m.pausadas.join(", ")}`);
  return linhas;
}

// ── AS LISTAS QUE SE REPETEM ──────────────────────────────────────────────────
//
// O mesmo princípio de lib/opcoes-repetidas.ts, em dois níveis. A PERGUNTA
// inteira (título, quantas, regra, opções) é o que se repete produto a
// produto — a linha de regra do meio a meio é igual nas 76 pizzas da Lá Casa
// — e o produto fica com "perguntas: L1, L2, L3". Mas a mesma LISTA sob
// títulos diferentes ("Pizza M: escolha 2 sabores", "Pizza XGG: escolha 4
// sabores", os mesmos 10 sabores) compartilha só a lista, e o produto fica
// com o título e "opções da L4" — senão cada título ganhava uma cópia da
// lista. Junta-se só o que economiza: os N usos saem, entram N referências e
// a definição uma vez.

function registroDeListas() {
  const rotulo = new Map<string, string>();
  const definicoes: string[] = [];
  return {
    rotulo,
    definicoes,
    compartilhar(chaves: { chave: string; texto: string }[], custoDaReferencia: number) {
      const usos = new Map<string, number>();
      const ordem: { chave: string; texto: string }[] = [];
      for (const c of chaves) {
        if (!usos.has(c.chave)) ordem.push(c);
        usos.set(c.chave, (usos.get(c.chave) || 0) + 1);
      }
      for (const { chave, texto } of ordem) {
        const n = usos.get(chave) || 0;
        // Lista curtinha ("Guarana Mineiro 1,5l") não vale uma referência,
        // mesmo que a conta feche por um fio: lê-se pior do que escrita.
        if (texto.length < 30 || n * texto.length - (n * custoDaReferencia + texto.length + 8) <= 0) continue;
        const r = `L${definicoes.length + 1}`;
        rotulo.set(chave, r);
        definicoes.push(`${r} = ${texto}`);
      }
    },
  };
}

// ── O CARDÁPIO ────────────────────────────────────────────────────────────────

export function cardapioParaORobo(produtos: any[], ctx: ContextoDoCardapio): { texto: string; estatisticas: EstatisticasDoCardapio } {
  const hoje = String(ctx.currentDayCode || "").toUpperCase();
  const amanha = String(ctx.tomorrowDayCode || "").toUpperCase();

  // Nome → produto, para todo produto do cardápio: é por aqui que a meia
  // "1/2 Calabresa" prova que a Calabresa existe (e com que preço).
  const loja = new Map<string, any>();
  for (const p of produtos || []) {
    const nome = nomeLimpo(p);
    if (nome && !loja.has(nome)) loja.set(nome, p);
  }

  const promocoesDeHoje: string[] = [];
  const promocoesDeAmanha: string[] = [];
  // (categoria, motivo) → nomes: a NIK tem 27 pizzas "só Quarta-feira" na
  // mesma categoria, e uma linha por pizza era 27 linhas do mesmo motivo.
  const indisponiveis = new Map<string, string[]>();
  const indisponivel = (categoria: string, motivo: string, nome: string) => {
    const chave = `${categoria}\u0000${motivo}`;
    indisponiveis.set(chave, [...(indisponiveis.get(chave) || []), nome]);
  };
  const diasDaPromocao = new Map<string, string[]>();
  const vistos = new Set<string>();

  type Linha = { nome: string; categoria: string; combo: boolean; cabeca: string; perguntas: Pergunta[] };
  const linhas: Linha[] = [];
  const estat: EstatisticasDoCardapio = { produtos: 0, grupos: 0, opcoes: 0, listasCompartilhadas: 0, matrizes: 0, meiosAMeio: 0, chars: 0 };

  for (const p of produtos || []) {
    if (!p) continue;
    const id = String(p.id ?? "");
    if (ctx.idsSoDeOpcaoDeCombo?.has(id)) continue;
    const nome = nomeLimpo(p);
    if (!nome) continue;
    const categoria = String(p.category || "").trim() || "Outros";
    const rotulo = `${nome} (${categoria})`;

    if (p.perguntaTravadaPelaPausa) {
      indisponivel(categoria, `sem as opções de "${p.perguntaTravadaPelaPausa}" (pausadas)`, nome);
      continue;
    }
    const estoque = ctx.estoque?.get(id);
    let notaDeEstoque = "";
    if (estoque?.pausaAoZerar) {
      if (estoque.restam <= 0) {
        indisponivel(categoria, "esgotado hoje", nome);
        continue;
      }
      notaDeEstoque = ` [últimas ${estoque.restam} unid., não anotar mais que isso]`;
    }

    const chave = `${nome.toLowerCase()}_${p.price}`;
    const dias = diasDoProduto(p.availableDays);
    const hojeVale = dias.length === 0 || dias.includes(hoje);
    const amanhaVale = dias.length === 0 || dias.includes(amanha);
    const tags = tagsDoProduto(p);
    const promo = ehPromocao(p, nome, tags);
    const combo = ehCombo(p, nome);
    const horario = ctx.horarioPorId?.get(id) || "";
    const precoDe = Number(p.precoDe) > 0 ? ` (de R$ ${brl(Number(p.precoDe))})` : "";

    if (promo) {
      for (const d of dias.length === 0 ? TODOS_OS_DIAS : dias) {
        if (!DAY_NAMES[d]) continue;
        const item = `${nome} (R$ ${brl(Number(p.price) || 0)})`;
        diasDaPromocao.set(item, [...(diasDaPromocao.get(item) || []), d]);
      }
    }

    if (!hojeVale) {
      indisponivel(categoria, `só ${nomesDosDias(dias)}`, nome);
    } else if (ctx.idsForaDoHorarioAgora?.has(id)) {
      indisponivel(categoria, `fora do horário agora (só ${horario || "no horário do produto"}; se perguntarem, diga o horário)`, nome);
    } else if (!vistos.has(chave)) {
      vistos.add(chave);
      const precoBase = Number(p.price) || 0;
      // O que se oferece é o que se pode escolher agora: sem as opções
      // pausadas, no "a partir de" e na lista (lib/opcao-pausada.ts). O
      // "a partir de" usa o mesmo mínimo que a gravação (lib/preco-combo.ts).
      const ofertado: any = semOpcoesPausadas(p);
      const precoParaCotar = Math.max(precoBase, precoMinimoDoProduto(ofertado));
      const varia = precoVariaPorEscolha(ofertado);
      const preco = `${varia ? "a partir de " : ""}R$ ${brl(precoParaCotar)}`;

      const perguntas: Pergunta[] = [];
      for (const g of ofertado.comboGroups || []) {
        const original = g?.id ? (p.comboGroups || []).find((o: any) => o?.id === g.id) : null;
        const q = prepararPergunta(g, original, p, loja);
        if (!q) continue;
        perguntas.push(q);
        estat.grupos++;
        estat.opcoes += q.totalDeOpcoes;
        if (q.meioAMeio) estat.meiosAMeio++;
      }

      const extras = [
        tags.length ? ` [${tags.join(", ")}]` : "",
        notaDeEstoque,
        horario ? ` [só ${horario}]` : "",
        dias.length > 0 && dias.length < 7 ? ` [só ${nomesDosDias(dias)}]` : "",
      ].join("");
      const desc = descricaoCurta(p.description);
      linhas.push({ nome, categoria, combo, perguntas, cabeca: `- ${nome} · ${preco}${precoDe}${extras}${desc ? ` — ${desc}` : ""}` });
      estat.produtos++;
      if (promo) promocoesDeHoje.push(`- ${nome} · ${preco}${precoDe}`);
    }

    if (amanhaVale && promo) promocoesDeAmanha.push(`- ${rotulo} · R$ ${brl(Number(p.price) || 0)}`);
  }

  // Matrizes antes do dedupe: a pergunta que virou "tabela T1, coluna P" é
  // curta e diferente por produto, e não tem por que ir para LISTAS.
  const matrizes = montarMatrizes(linhas.flatMap((l) => l.perguntas.map((q) => ({ nome: l.nome, q }))));
  estat.matrizes = matrizes.length;

  const textos = linhas.map((l) => l.perguntas.map(textoDaPergunta));
  const todas = textos.flat();
  const chaveDaLista = (t: { corpo: string }) => `lista:${t.corpo}`;
  const chaveDaPergunta = (t: { cabeca: string; corpo: string }) => `pergunta:${t.cabeca}: ${t.corpo}`;
  // A lista que aparece sob mais de um título compartilha só a lista; o resto
  // compartilha a pergunta inteira.
  const titulosDaLista = new Map<string, Set<string>>();
  for (const t of todas) titulosDaLista.set(t.corpo, new Set([...(titulosDaLista.get(t.corpo) || []), t.cabeca]));
  const listas = registroDeListas();
  listas.compartilhar(todas.filter((t) => t.listaCompartilhavel && (titulosDaLista.get(t.corpo)?.size || 0) >= 2).map((t) => ({ chave: chaveDaLista(t), texto: t.corpo })), 12);
  listas.compartilhar(todas.filter((t) => !listas.rotulo.has(chaveDaLista(t))).map((t) => ({ chave: chaveDaPergunta(t), texto: `${t.cabeca}: ${t.corpo}` })), 5);
  const { definicoes } = listas;
  estat.listasCompartilhadas = definicoes.length;

  // A linha do produto: as perguntas compartilhadas numa linha só
  // ("perguntas: L1, L2, L3"), as demais por extenso, uma por linha.
  const porCategoria = (so: boolean) => {
    const saida: string[] = [];
    let categoriaAtual = "";
    linhas.forEach((l, idx) => {
      if (l.combo !== so) return;
      if (l.categoria !== categoriaAtual) {
        categoriaAtual = l.categoria;
        saida.push(`${categoriaAtual}:`);
      }
      saida.push(l.cabeca);
      const refs: string[] = [];
      for (const t of textos[idx]) {
        const daPergunta = listas.rotulo.get(chaveDaPergunta(t));
        if (daPergunta) {
          refs.push(daPergunta);
          continue;
        }
        const daLista = listas.rotulo.get(chaveDaLista(t));
        saida.push(`  ? ${t.cabeca}: ${daLista ? `opções da ${daLista}` : t.corpo}`);
      }
      if (refs.length) saida.push(`  perguntas: ${refs.join(", ")}`);
    });
    return saida;
  };
  const combos = porCategoria(true);
  const avulsos = porCategoria(false);

  const cronograma = [...diasDaPromocao.entries()].map(([item, dias]) => `- ${item}: ${nomesDosDias(dias)}`);

  const secoes: string[] = [
    `CARDÁPIO (dia: ${ctx.currentDayName})
Como ler: "= R$ X" é o preço do produto com essa opção; "+R$ X" soma ao preço; "−R$ X" desconta; opção sem valor não muda o preço. "a partir de" = o preço final depende das escolhas. Na tag do pedido, o nome do produto e o de cada opção vão exatamente como escritos aqui. "L1" remete à seção LISTAS DE OPÇÕES; "tabela T1" à seção TABELAS DE SABORES.`,
    `PROMOÇÕES DE HOJE (${ctx.currentDayName})\n${promocoesDeHoje.length ? promocoesDeHoje.join("\n") : "- nenhuma cadastrada para hoje"}`,
    `PROMOÇÕES DE AMANHÃ (${ctx.tomorrowDayName})\n${promocoesDeAmanha.length ? promocoesDeAmanha.join("\n") : "- nenhuma cadastrada para amanhã"}`,
    `CRONOGRAMA DE PROMOÇÕES\n${cronograma.length ? cronograma.join("\n") : "- sem cronograma cadastrado"}`,
  ];
  if (definicoes.length) secoes.push(`LISTAS DE OPÇÕES (a pergunta vale igual, com os mesmos preços, em cada produto que a cita)\n${definicoes.join("\n")}`);
  if (matrizes.length) secoes.push(`TABELAS DE SABORES (o produto diz a tabela e a coluna dele)\n${matrizes.flatMap(textoDaMatriz).join("\n")}`);
  secoes.push(`COMBOS\n${combos.length ? combos.join("\n") : "- nenhum combo cadastrado (não ofereça combo que não esteja aqui)"}`);
  secoes.push(`PRODUTOS\n${avulsos.length ? avulsos.join("\n") : "- nenhum item avulso cadastrado (não ofereça item que não esteja aqui)"}`);
  const linhasDeIndisponiveis = [...indisponiveis.entries()].map(([chave, nomes]) => {
    const [categoria, motivo] = chave.split("\u0000");
    return nomes.length === 1 ? `- ${nomes[0]} (${categoria}): ${motivo}` : `- (${categoria}) ${motivo}: ${nomes.join(", ")}`;
  });
  secoes.push(`INDISPONÍVEIS HOJE (não oferecer nem anotar)\n${linhasDeIndisponiveis.length ? linhasDeIndisponiveis.join("\n") : "- nenhum"}`);

  const texto = secoes.join("\n\n");
  estat.chars = texto.length;
  return { texto, estatisticas: estat };
}
