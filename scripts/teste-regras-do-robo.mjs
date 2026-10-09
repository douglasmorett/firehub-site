/**
 * As regras do robô comprimidas (src/lib/regras-do-robo.ts) contra o bloco
 * "REGRAS ABSOLUTAS" original.
 *
 *   node scripts/teste-regras-do-robo.mjs
 *
 * O original saiu de chatbot-ai.ts na integração (09/10/2026); o teste o lê
 * do último commit que ainda o tinha (ORIGEM, abaixo) via `git show`, para
 * não morrer junto com a integração.
 *
 * O teste renderiza as duas versões com OS MESMOS valores, em dois cenários
 * (loja física que anota pedido; loja só delivery com o pedido desligado), e
 * confere que o texto novo:
 *  - fica abaixo do TETO de caracteres do original (fonte crua e renderizado);
 *  - mantém todas as marcas, os campos do JSON do pedido e as frases do
 *    original que os verificadores pediram de volta;
 *  - cita os nomes de seção que o resto do prompt monta HOJE — os do cardápio
 *    conferidos na fonte de lib/cardapio-para-o-robo.ts, os de status na de
 *    lib/status-para-o-cliente.ts, as palavras de prometeuCozinha na de
 *    chatbot-ai.ts;
 *  - não ensina a anotar pedido quando o módulo está desligado.
 * Com GEMINI_API_KEY no .env, conta os tokens dos dois pelo countTokens.
 */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import ts from "typescript";

/** Último commit em que o bloco original ainda vivia em chatbot-ai.ts. */
const ORIGEM = "9fbf43e9";
/**
 * Alvo da compressão: a fração do original que o texto novo pode ocupar.
 * A primeira versão (09/10/2026) ficou em 54%; repor o que os verificadores
 * apontaram (frases do motoboy, do pedido desligado, da taxa cadastrada, o
 * "procure nas opções" do caso da Pizzaria 17) custou 4 pontos.
 */
// 09/10/2026, depois do A/B v2: "você TEM acesso em tempo real aos pedidos" (o
// Lite dizia que não via o status), "nunca o link e o arquivo do cardápio na
// mesma resposta" e "texto não leva [[TRANSCRICAO]]" custaram mais 2 pontos. O
// que importa é a conta em tokens, logo abaixo (~58%).
const TETO = 0.62;

const transpilar = (fonte) =>
  ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const importar = (js) => import("data:text/javascript," + encodeURIComponent(js));

const { regrasDoRobo, REGRA_DO_PEDIDO } = await importar(transpilar(readFileSync("src/lib/regras-do-robo.ts", "utf8")));
const { servicosSemFonte } = await importar(transpilar(readFileSync("src/lib/afirmacao-sem-fonte.ts", "utf8")));

// ── O original, recortado do template no commit de origem ───────────────────
const chatbotOriginal = execSync(`git show ${ORIGEM}:src/lib/chatbot-ai.ts`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const ini = chatbotOriginal.indexOf("REGRAS ABSOLUTAS:");
const fim = chatbotOriginal.indexOf("\nDADOS DA LOJA:", ini);
if (ini === -1 || fim === -1) throw new Error(`não achei o bloco REGRAS ABSOLUTAS em ${ORIGEM}:src/lib/chatbot-ai.ts`);
const fonteOriginal = chatbotOriginal.slice(ini, fim);
// O trecho é o miolo de um template literal com `${...}` de TypeScript: vira
// uma função que recebe as mesmas variáveis do chatbot-ai.ts.
const { original } = await importar(transpilar(
  `export function original(v: any) { const { storeLink, cardapioArquivoUrl, temCupomParaCitar, prazoDaLoja, personalityInstruction, currentDayName, currentDayCode, chatbotConfig, user, modoDaAreaDaLoja, ehRota, regraDoPixNoPrompt, pixDaLoja, aiOrderingEnabled, regraDaNota, formasEmTexto, regraDoPedidoMinimo, fatosDoMinimo, tomorrowDayName, lembreteDoMinimo, minimumOrderValue } = v; return \`${fonteOriginal}\`; }`,
));

// ── O que o resto do sistema escreve ou procura, lido da fonte de hoje ──────
const cardapioFonte = readFileSync("src/lib/cardapio-para-o-robo.ts", "utf8");
const statusFonte = readFileSync("src/lib/status-para-o-cliente.ts", "utf8");
const chatbotHoje = readFileSync("src/lib/chatbot-ai.ts", "utf8");

// ── Valores iguais para as duas versões ─────────────────────────────────────
const regraDoPrazo = `   - Diga o tempo CADASTRADO pela loja: de 30 a 50 minutos, conforme a região. Se o endereço do cliente já foi validado e a validação trouxe o tempo daquela região, diga o tempo DELA. NUNCA cite um tempo que não esteja nos dados da loja.`;
const regraDoPix = `PIX DA LOJA (cadastrada pela loja — CNPJ; titular: Pizzaria Teste):
    - Quando o cliente pedir a chave Pix, escreva uma frase curta ("Segue a chave Pix 👇") e coloque a marca [[ENVIAR_PIX]] no final. O sistema manda a chave certinha numa mensagem separada, para ele copiar.
    - É PROIBIDO digitar a chave Pix na resposta, mesmo que ela apareça no histórico: um caractere errado manda o dinheiro do cliente para outra pessoa.
    - Comprovante: quando o cliente mandar o comprovante (imagem ou PDF) ou disser que pagou, agradeça e diga que a loja confere o pagamento. NUNCA diga que o pagamento foi confirmado ou recebido — você não vê a conta da loja.`;
const regraDoMinimo = `    A) PEDIDO MÍNIMO — R$ 25,00 de SUBTOTAL (itens, sem a taxa):
       - Some os itens. Se o subtotal for MENOR que o mínimo, NÃO FECHE. Não adianta a taxa
         de entrega somar e passar do mínimo: o que conta é o subtotal dos itens.
       - Diga com simpatia quanto falta e ofereça complementar.
       - Se o cliente NÃO quiser completar, ofereça a RETIRADA NO BALCÃO — retirada não tem pedido mínimo.`;
const lembrete = ", e lembre o pedido mínimo de 25,00 reais para entrega";
const personalidade = "simpático e acolhedor, com carinho na medida (um emoji aqui e ali, como 😊, 🥰 ou 👏). Carinho não é mensagem comprida. NUNCA use emoji de comida que a loja não vende.";
const formas = "Pix, cartão ou dinheiro";

const cenarios = {
  "loja física que anota pedido": {
    novo: {
      storeLink: "https://firehubfood.com.br/loja/pizzaria-teste", cardapioArquivoUrl: "https://x/cardapio.pdf",
      temCupomParaCitar: true, regraDoPrazo, personalidade, diaDeHoje: "Quinta-feira", codigoDoDia: "QUI", diaDeAmanha: "Sexta-feira",
      lojaFisica: true, enderecoDaLoja: "Rua das Flores, 10 - Centro", fazReservaDeMesa: true, modoDaArea: "KM", ehRota: true,
      regraDoPix, anotaPedido: true, notaFiscal: { perguntar: true, obrigatorioNaEntrega: true, formas },
      regraDoMinimo, lembreteDoMinimo: lembrete,
    },
    velho: {
      storeLink: "https://firehubfood.com.br/loja/pizzaria-teste", cardapioArquivoUrl: "https://x/cardapio.pdf",
      temCupomParaCitar: true, prazoDaLoja: { regra: regraDoPrazo }, personalityInstruction: personalidade,
      currentDayName: "Quinta-feira", currentDayCode: "QUI", tomorrowDayName: "Sexta-feira",
      chatbotConfig: { storeType: "PHYSICAL", fazReservaDeMesa: true }, user: { storeAddress: "Rua das Flores, 10 - Centro" },
      modoDaAreaDaLoja: "KM", ehRota: true, regraDoPixNoPrompt: () => regraDoPix, pixDaLoja: {}, aiOrderingEnabled: true,
      regraDaNota: { perguntar: true, obrigatorioNaEntrega: true, formas: [] }, formasEmTexto: () => formas,
      regraDoPedidoMinimo: () => regraDoMinimo, fatosDoMinimo: {}, lembreteDoMinimo: () => lembrete, minimumOrderValue: 25,
    },
  },
  "só delivery, pedido desligado": {
    novo: {
      storeLink: "https://firehubfood.com.br/loja/lanches", cardapioArquivoUrl: null,
      temCupomParaCitar: false, regraDoPrazo, personalidade, diaDeHoje: "Quinta-feira", codigoDoDia: "QUI", diaDeAmanha: "Sexta-feira",
      lojaFisica: false, enderecoDaLoja: null, fazReservaDeMesa: null, modoDaArea: "BAIRRO", ehRota: false,
      regraDoPix, anotaPedido: false, notaFiscal: null, regraDoMinimo, lembreteDoMinimo: "",
    },
    velho: {
      storeLink: "https://firehubfood.com.br/loja/lanches", cardapioArquivoUrl: "",
      temCupomParaCitar: false, prazoDaLoja: { regra: regraDoPrazo }, personalityInstruction: personalidade,
      currentDayName: "Quinta-feira", currentDayCode: "QUI", tomorrowDayName: "Sexta-feira",
      chatbotConfig: { storeType: "DELIVERY" }, user: {},
      modoDaAreaDaLoja: "BAIRRO", ehRota: false, regraDoPixNoPrompt: () => regraDoPix, pixDaLoja: {}, aiOrderingEnabled: false,
      regraDaNota: { perguntar: false }, formasEmTexto: () => formas,
      regraDoPedidoMinimo: () => regraDoMinimo, fatosDoMinimo: {}, lembreteDoMinimo: () => "", minimumOrderValue: 0,
    },
  },
};

// ── O que o resto do prompt e o chatbot-ai.ts procuram no texto ─────────────
const marcas = ["[[CHAMAR_ATENDENTE]]", "[[ENVIAR_CARDAPIO]]", "[[TRANSCRICAO: ", "[[PEDIDO_IA:", "[[ENVIAR_PIX]]"];
// Seções que chatbot-ai.ts monta fora do cardápio.
const secoesDoPrompt = [
  "PEDIDOS RECENTES DESTE CLIENTE NO SEU NÚMERO", "VALIDAÇÃO DA ÁREA DE ENTREGA", "CUPOM DESTE CLIENTE",
  "CUPONS VÁLIDOS CADASTRADOS NA LOJA", "DADOS DA LOJA", "Quadro Geral de Horários", "TAXAS E REGRAS DE ENTREGA POR BAIRRO/REGIÃO",
];
// Seções e marcações do cardápio novo: cada uma tem de existir literalmente
// na fonte de cardapio-para-o-robo.ts (é ele quem as escreve).
const secoesDoCardapio = [
  "PROMOÇÕES DE HOJE (", "PROMOÇÕES DE AMANHÃ (", "CRONOGRAMA DE PROMOÇÕES", "INDISPONÍVEIS HOJE",
  "COMBOS", "PRODUTOS", "LISTAS DE OPÇÕES", "TABELAS DE SABORES", "a partir de", "= R$", "+R$",
];
// Rótulos de status que a regra 18 cita: têm de ser os que o sistema escreve.
const rotulosDeStatus = ["Em preparação na cozinha", "Pronto na loja", "Saiu para entrega com o motoboy"];
const secoesDoPedido = ["📦 PEDIDO Nº ... ENVIADO À LOJA", "ALERTA DE TELEFONE"];
const camposDoPedido = [
  '"status": "NOVO"', '"status": "CRIANDO_IA"', '"finalized": true', '"finalized": false',
  '"name"', '"quantity"', '"options"', '"notes"', '"customerPhone"', '"changeFor"', '"observation"', '"cpfCnpj"',
  '"neighborhood"', '"deliveryType": "DELIVERY"', '"deliveryType": "RETIRADA"',
  '"alteraPedido"', '"couponCode"', '"customerName"', '"address"', '"paymentMethod"', '"deliveryFee"', '"totalAmount"',
];
// Frases do original que os verificadores pediram de volta (09/10/2026).
const frases = [
  "Subtotal dos itens: R$ X,XX", "Taxa de entrega: R$ X,XX (ou Frete Grátis)", "Valor Total a pagar: R$ X,XX",
  "Recebido! Seu pedido já deu entrada na nossa cozinha 🚀",
  "Desculpe, não conseguimos atender ligações por aqui! 😅 Como posso te ajudar?",
  "TRAIN OF THOUGHT:", "150 caracteres", "Saiu para entrega com o motoboy",
  "Nunca diga que é IA, robô, assistente virtual ou modelo de linguagem",
  "Me confirma que eu já te passo a posição exata!",
  "não tem o telefone dele", '"consegui falar com ele"', '"estou verificando a posição"',
  "nada de enfeite", "endereço não quer dizer estacionamento",
  "(recuperação de cliente inativo, por exemplo)", "proibido divulgar, citar ou confirmar",
  "cidade, áudio", "a loja prefere vender pelo site",
  "procure nas OPÇÕES do produto", '"camarão" é opção da pizza',
  "preço de item; o total do pedido você soma",
  "taxa do bairro na tabela, taxa fixa, frete grátis",
];
const frasesDoPedidoLigado = [
  '"E vai pagar como: Pix, cartão ou dinheiro?"',
  '"fechado"', // prometeuCozinha também barra "pedido fechado"
  "a cozinha não fica sabendo",
  "Só a taxa cadastrada para aquele bairro/faixa",
];
const frasesDoPedidoDesligado = [
  '"já monto pra você"', '"vou finalizar"', '"não quero site"', "tempo de espera",
];
// O que o texto novo NÃO pode dizer (apontamentos de 09/10/2026).
const proibidas = [
  "Você é uma pessoa", // o original só proibia revelar que é IA
  "Sem endereço, nenhum valor", // taxa de bairro na tabela e taxa fixa podem ser ditas
  '"street"', '"number"', // campos que o sync nunca leu
  '"Em Preparação"', '"Aceito"', '"Saiu para Entrega"', // rótulos que o sistema não escreve
  "PRODUTOS/PROMOÇÕES INDISPONÍVEIS HOJE", "🌟 PROMOÇÕES DE HOJE", "DIAS DA SEMANA CADASTRADOS NA LOJA", // títulos do cardápio antigo
];

let falhas = 0;
const confere = (nome, ok, detalhe = "") => {
  console.log(`  ${ok ? "ok   " : "FALHA"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas++;
};
const temTodos = (texto, lista, rotulo) => {
  const faltam = lista.filter((s) => !texto.includes(s));
  confere(rotulo, faltam.length === 0, faltam.length ? `faltam: ${faltam.join(" | ")}` : "");
};
const naoTem = (texto, lista, rotulo) => {
  const sobram = lista.filter((s) => texto.includes(s));
  confere(rotulo, sobram.length === 0, sobram.length ? `ainda tem: ${sobram.join(" | ")}` : "");
};

console.log("o que o sistema escreve hoje");
temTodos(cardapioFonte, secoesDoCardapio, "títulos e marcações do cardápio existem em cardapio-para-o-robo.ts");
temTodos(statusFonte, rotulosDeStatus, "rótulos de status existem em status-para-o-cliente.ts");
const prometeu = chatbotHoje.match(/const prometeuCozinha =\s*\n?\s*(\/.+\/i)/)?.[1] || "";
confere("prometeuCozinha em chatbot-ai.ts barra confirmado/registrado/anotado/fechado", ["confirmado", "registrado", "anotado", "fechado"].every((p) => prometeu.includes(p)), prometeu || "regex não achada");

const renderizados = {};
for (const [nome, c] of Object.entries(cenarios)) {
  console.log(`\n${nome}`);
  const novo = regrasDoRobo(c.novo);
  const velho = original(c.velho);
  renderizados[nome] = { novo, velho };
  const proporcao = novo.length / velho.length;
  confere(`até ${TETO * 100}% dos caracteres renderizados`, proporcao <= TETO, `${novo.length} / ${velho.length} = ${(proporcao * 100).toFixed(0)}%`);
  confere("começa com REGRAS ABSOLUTAS:", novo.startsWith("REGRAS ABSOLUTAS:"));
  temTodos(novo, marcas, "marcas do sistema");
  temTodos(novo, secoesDoPrompt, "nomes de seção do prompt");
  temTodos(novo, secoesDoCardapio.map((s) => (s.endsWith("(") ? `${s}${s.includes("HOJE") ? c.novo.diaDeHoje : c.novo.diaDeAmanha})` : s)), "nomes de seção do cardápio (com o dia)");
  temTodos(novo, rotulosDeStatus, "rótulos de status reais");
  temTodos(novo, frases, "frases fixas que o original exigia (e as repostas)");
  naoTem(novo, proibidas, "nada do que os verificadores mandaram tirar");
  temTodos(novo, [c.novo.storeLink, c.novo.personalidade, regraDoPrazo, regraDoPix, "(QUI)"], "valores interpolados");
  const regrasDoLink = novo.split("\n").filter((l) => /^\d+\. /.test(l)).length;
  confere("regras numeradas em sequência", regrasDoLink === 20 && novo.includes("\n20. "), `${regrasDoLink} regras`);
  confere("títulos em uma linha (cada regra numerada tem título na própria linha)", novo.split("\n").filter((l) => /^\d+\. $/.test(l)).length === 0);
  confere("a regra 2 abre exceção para a frase fixa da regra 19", novo.includes("exceção: a frase fixa da regra 19") && /\n19\. LIGAÇÃO DE VOZ/.test(novo));

  if (c.novo.anotaPedido) {
    temTodos(novo, secoesDoPedido, "seções citadas pelo pedido");
    temTodos(novo, camposDoPedido, "campos do JSON do pedido");
    temTodos(novo, frasesDoPedidoLigado, "frases repostas no pedido ligado");
    temTodos(novo, [`${REGRA_DO_PEDIDO}. ANOTAR PEDIDO`, regraDoMinimo, lembrete, "Quer CPF ou CNPJ na nota?", formas, "Pizza Tradicional Frango I", "RESERVA DE MESA — a loja faz", "Temos loja física sim", "Rua das Flores, 10 - Centro", "percurso da moto", "localização pelo WhatsApp", "6x Sabor A", "1/2 PIZZA", "mitad"], "regra do pedido, nota, reserva, loja física, rota");
    confere("sem a frase de confirmação solta: 'enviado pra cozinha' só junto da marca", /finalized": true}]]\n\s+e \(b\) a frase "Perfeito! Pedido confirmado e enviado pra cozinha 🚀"/.test(novo));
    confere("não lista 'reserva de mesa' entre o que não sabe (a loja disse)", !novo.includes("reserva de mesa, estacionamento"));
    const fraseDaReserva = novo.match(/RESERVA DE MESA — a loja faz:[^\n]*?"(Fazemos sim![^"]+)"/)?.[1] || "";
    confere("a frase-modelo da reserva passa pela rede servicosSemFonte sem a fonte", fraseDaReserva !== "" && servicosSemFonte(fraseDaReserva, "", { soDelivery: false }).length === 0, fraseDaReserva);
  } else {
    temTodos(novo, [`${REGRA_DO_PEDIDO}. MÓDULO DE PEDIDOS DESLIGADO`, "Oba! Pra pedir é rapidinho pelo nosso cardápio", "somos só delivery no momento", "não despeje o cardápio inteiro", "reserva de mesa, estacionamento", "NÃO tem cupom público ativo"], "módulo desligado, só delivery, sem arquivo, sem cupom, reserva desconhecida");
    temTodos(novo, frasesDoPedidoDesligado, "frases repostas no pedido desligado");
    confere("não ensina a marca de finalização", !novo.includes('"finalized": true') && !novo.includes("ANOTAR PEDIDO PELO WHATSAPP"));
    confere("não pede CPF na nota", !novo.includes("CPF/CNPJ NA NOTA"));
    confere("não fala em localização pelo WhatsApp (modo BAIRRO)", !novo.includes("localização pelo WhatsApp") && !novo.includes("percurso da moto"));
    confere("áudio e [[TRANSCRICAO]] continuam valendo com o pedido desligado", novo.includes("[[TRANSCRICAO: "));
  }
}

console.log("\nfonte crua (template com ${...}, sem renderizar)");
const fonteNova = readFileSync("src/lib/regras-do-robo.ts", "utf8");
// A função inteira (ramos do pedido, reserva, nota e tudo), não só o return.
const corpoNovo = fonteNova.slice(fonteNova.indexOf("export function regrasDoRobo"));
confere(`função regrasDoRobo inteira até ${TETO * 100}% do bloco original`, corpoNovo.length / fonteOriginal.length <= TETO, `${corpoNovo.length} / ${fonteOriginal.length} = ${((corpoNovo.length / fonteOriginal.length) * 100).toFixed(0)}%`);

// ── Tokens pela API (opcional) ──────────────────────────────────────────────
const chave = existsSync(".env") ? (readFileSync(".env", "utf8").match(/^GEMINI_API_KEY=(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "") : "";
if (chave && !process.argv.includes("--sem-api")) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: chave });
  const contar = async (texto) => (await ai.models.countTokens({ model: "gemini-2.5-flash", contents: texto })).totalTokens;
  console.log("\ntokens pelo countTokens (gemini-2.5-flash)");
  for (const [nome, r] of Object.entries(renderizados)) {
    try {
      const [a, d] = await Promise.all([contar(r.velho), contar(r.novo)]);
      console.log(`  ${nome}: ${a} → ${d} (${((d / a) * 100).toFixed(0)}%)`);
    } catch (e) {
      console.log(`  ${nome}: countTokens falhou — ${e?.message || e}`);
    }
  }
} else {
  console.log("\n(sem GEMINI_API_KEY no .env: contagem de tokens pulada)");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
