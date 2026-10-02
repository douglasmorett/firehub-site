import { ThinkingLevel, type Content, type Part } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { gravarMensagem, mensagensDoContato } from "@/lib/crm/mensagens";
import { ROTULO_DA_ETAPA, type Etapa } from "@/lib/crm/etapas";
import { configDoAtendimento } from "./config";
import { clienteDoGemini } from "./gemini";
import { CONHECIMENTO_DO_FIREHUB } from "./conhecimento";
import { DECLARACOES, FERRAMENTAS_COM_EFEITO, chamarPessoa, executarFerramenta } from "./ferramentas";
import { enviarTexto } from "./whatsapp";

/**
 * O ROBÔ DO FIREHUB — atende no número do próprio FireHub: suporte para quem
 * já é loja, venda (até o teste grátis ou uma demonstração) para quem não é.
 *
 * ── Quando ele fala ─────────────────────────────────────────────────────────
 *
 * Só com TUDO isto verdadeiro (qualquer um falso = silêncio, e a conversa fica
 * na tela para uma pessoa):
 *   - o interruptor "Robô ligado" da tela (nasce desligado);
 *   - o contato não está com o robô desligado nem pausado (alguém respondeu
 *     pela tela ou pelo celular) nem esperando uma pessoa;
 *   - a última mensagem da conversa é do contato, e é recente — ligar o robô
 *     de manhã não faz ele responder o que chegou de madrugada;
 *   - menos de 15 respostas dele nesta conversa em 24 h (depois chama pessoa).
 *
 * ── Espera o contato terminar de digitar ───────────────────────────────────
 *
 * Quem escreve "oi" / "tudo bem?" / "queria saber do sistema" em três
 * mensagens recebe UMA resposta: cada mensagem nova reinicia a espera.
 */

const ESPERA_MS = 6_000;
const MAXIMO_EM_24H = 15;
const MENSAGEM_VELHA_MS = 20 * 60_000;
const MODELOS = ["gemini-3.6-flash", "gemini-2.5-flash"];

type Estado = { timers: Map<string, ReturnType<typeof setTimeout>>; rodando: Set<string>; deNovo: Set<string> };
function estado(): Estado {
  const g = globalThis as any;
  if (!g.__roboDoFireHub) g.__roboDoFireHub = { timers: new Map(), rodando: new Set(), deNovo: new Set() };
  return g.__roboDoFireHub;
}

export function agendarRespostaDoRobo(contatoId: string) {
  const e = estado();
  const anterior = e.timers.get(contatoId);
  if (anterior) clearTimeout(anterior);
  e.timers.set(contatoId, setTimeout(() => {
    e.timers.delete(contatoId);
    void rodar(contatoId);
  }, ESPERA_MS));
}

async function rodar(contatoId: string) {
  const e = estado();
  if (e.rodando.has(contatoId)) {
    e.deNovo.add(contatoId);
    return;
  }
  e.rodando.add(contatoId);
  try {
    await responder(contatoId);
  } catch (err: any) {
    console.error(`[Atendimento] Robô falhou no contato ${contatoId}: ${err?.message}`);
  } finally {
    e.rodando.delete(contatoId);
    if (e.deNovo.delete(contatoId)) agendarRespostaDoRobo(contatoId);
  }
}

function agoraEmBrasilia(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date());
}

function instrucoes(config: Awaited<ReturnType<typeof configDoAtendimento>>, contato: any, vendedor: string | null, linkDeCadastroEm: Date | null): string {
  const apresentacao = config.nomeDoAtendente
    ? `Você é ${config.nomeDoAtendente}, assistente virtual do atendimento do FireHub no WhatsApp.`
    : "Você é o assistente virtual do atendimento do FireHub no WhatsApp. Você não tem nome próprio: nunca invente um.";
  const ficha = [
    `- Nome: ${contato.nome || "não sabemos ainda"}`,
    `- Loja: ${contato.nomeDaLoja || "não sabemos ainda"}${contato.cidade ? ` (${contato.cidade})` : ""}`,
    contato.userId
      ? "- É LOJISTA: a loja dele foi reconhecida pelo número que está escrevendo. Modo SUPORTE."
      : "- Ainda NÃO é cliente (ou escreveu de um número que não é o da loja). Modo VENDA — mas se disser que já usa o FireHub, trate como suporte sem mexer na conta.",
    `- Etapa no funil: ${ROTULO_DA_ETAPA[contato.etapa as Etapa] || contato.etapa}`,
    vendedor ? `- Especialista que cuida dele: ${vendedor}` : "",
    contato.resumo ? `- O que já sabemos: ${contato.resumo}` : "",
    // Conferido no banco, não deixado à memória do modelo: ele mandava o link em toda resposta (01/10).
    linkDeCadastroEm
      ? `- O link de cadastro JÁ FOI ENVIADO nesta conversa (${linkDeCadastroEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}). NÃO mande de novo, a não ser que a pessoa peça o link ou diga que não achou.`
      : "- O link de cadastro ainda não foi enviado.",
  ].filter(Boolean).join("\n");

  return `${apresentacao}

# Como falar
- Escreva como uma pessoa da equipe escreve no WhatsApp: CURTO. Uma ideia por mensagem, 1 ou 2 frases, mire em até 200 caracteres. Nada de textão, parágrafo de propaganda nem lista.
- Responda primeiro, e direto, o que a pessoa perguntou ("Dá sim!" + o essencial). Detalhe só se ela pedir.
- Siga o assunto DELA. Não termine toda mensagem com oferta, convite ou link; pergunta de volta só quando ajuda a entender o negócio dela, e uma por vez.
- Não repita o que já está na conversa (preço, teste grátis, link, o que o FireHub faz).
- Negrito do WhatsApp (*assim*) só em algo muito importante. No máximo um emoji, e não em toda mensagem.
- Se perguntarem se você é robô/humano: diga que é o assistente virtual e que uma pessoa da equipe pode assumir quando precisar.

# Regras
- Só afirme o que está na BASE abaixo (ou no que as ferramentas devolverem). Não sabe? Diga que vai confirmar com a equipe e use chamar_pessoa. Nunca invente função, preço, prazo, desconto ou integração.
- Pediu atendente/pessoa/humano, está bravo, quer cancelar, contesta cobrança ou o problema não se resolve com a base → chamar_pessoa na hora e avise que alguém da equipe vai responder por aqui.
- Não fale de Checklist, Ponto nem Auditoria (é outro produto).
- Quem quer PEDIR comida (cliente final de um restaurante) não é lead: explique com gentileza que o FireHub é o sistema que os restaurantes usam e que o pedido é com o próprio restaurante. Não venda nada para essa pessoa.
- Fornecedor, parceiro ou assunto pessoal: não venda; diga que vai passar o recado e use chamar_pessoa.
- Senha: nunca mande link pelo WhatsApp; use enviar_link_de_senha (vai para o e-mail da conta).
- Sempre que descobrir algo (nome, loja, cidade, e-mail, o que a pessoa precisa), use atualizar_contato.

# Modo SUPORTE (lojista)
- Problema na conta (impressão, robô do WhatsApp, iFood, pedido não chegou): chame estado_da_loja ANTES de responder e diga o que viu. Guie um passo por vez.
- "Aguardando mensagem" ou robô da loja travado com o WhatsApp conectado: pode usar reiniciar_whatsapp_da_loja.
- Fatura em aberto: pode informar o valor e o link que estado_da_loja trouxer.

# Modo VENDA (interessado)
- O melhor atendimento é tirar as dúvidas aqui mesmo. Entenda o negócio aos poucos (tipo de loja, cidade, por onde vende hoje, se usa algum sistema, o que mais incomoda) e mostre o que do FireHub resolve ESSA dor.
- Preço só quando perguntarem (1%, mínimo R$ 100, máximo R$ 400).
- Link de cadastro (firehubfood.com.br/cadastro, teste grátis de 15 dias): UMA vez na conversa, quando a pessoa mostrar que quer começar ou testar, ou perguntar como faz. Depois, diga "pelo link que te mandei" em vez de repetir.
- Nossa grande facilidade, deixe claro quando couber: A GENTE MONTA A LOJA PARA ELE. Ele manda o link do cardápio que usa hoje (iFood, Anota AI, cardápio digital, site) e a equipe copia o cardápio inteiro (produtos, preços, fotos, adicionais) e deixa bairros, taxas e horários configurados. Ele recebe a loja pronta para usar.
- Quando ele topar a montagem: peça, um de cada vez, o link do cardápio, o nome da loja e a cidade (bairros com as taxas e os horários ajudam, mas não trave por eles). Com o link e o nome da loja, use montar_loja e avise que a equipe continua por aqui.
- Demonstração com um vendedor é a ÚLTIMA opção: só se a pessoa pedir para ver funcionando ou falar com alguém, ou se as dúvidas não se resolverem aqui. Aí use chamar_pessoa com o motivo "quer agendar demonstração" e diga que a equipe vai combinar o horário por aqui.

# BASE
${CONHECIMENTO_DO_FIREHUB}
${config.instrucoesExtras.trim() ? `\n# Recados do dono (valem mais que a base)\n${config.instrucoesExtras.trim()}\n` : ""}
# Quem está falando
${ficha}

# Agora
${agoraEmBrasilia()} (horário de Brasília).`;
}

/** A conversa no formato do Gemini: contato = user; FireHub (robô ou pessoa) = model. */
function conversaParaOModelo(historico: { direcao: string; autor: string; autorNome: string | null; texto: string }[]): Content[] {
  const conteudos: Content[] = [];
  for (const m of historico) {
    const papel = m.direcao === "ENTRADA" ? "user" : "model";
    const texto = m.direcao === "SAIDA" && m.autor !== "ROBO" ? `[${m.autorNome || "Pessoa da equipe"} respondeu]: ${m.texto}` : m.texto;
    const ultimo = conteudos[conteudos.length - 1];
    if (ultimo && ultimo.role === papel) ultimo.parts!.push({ text: texto });
    else conteudos.push({ role: papel, parts: [{ text: texto }] });
  }
  // O Gemini quer a conversa começando pelo usuário.
  while (conteudos.length && conteudos[0].role !== "user") conteudos.shift();
  return conteudos;
}

async function responder(contatoId: string) {
  const config = await configDoAtendimento();
  if (!config.roboLigado || config.conexao.conectado === false) return;

  const contato = await prisma.crmContato.findUnique({ where: { id: contatoId } });
  if (!contato || contato.roboDesligado || !contato.jid) return;
  if (contato.aguardandoHumanoDesde) return;
  if (contato.roboPausadoAte && contato.roboPausadoAte.getTime() > Date.now()) return;

  const historico = await mensagensDoContato(contato.id, 40);
  const ultima = historico[historico.length - 1];
  if (!ultima || ultima.direcao !== "ENTRADA") return;
  if (Date.now() - ultima.criadoEm.getTime() > MENSAGEM_VELHA_MS) return;

  const respostas = await prisma.crmMensagem.count({
    where: { contatoId: contato.id, autor: "ROBO", criadoEm: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
  });
  if (respostas >= MAXIMO_EM_24H) {
    await chamarPessoa(contato, `O robô já respondeu ${respostas} vezes em 24 h nesta conversa.`);
    return;
  }

  const ai = await clienteDoGemini();
  if (!ai) {
    console.error("[Atendimento] Sem chave do Gemini: o robô do FireHub não responde.");
    return;
  }

  const vendedor = contato.vendedorId
    ? (await prisma.ambassador.findUnique({ where: { id: contato.vendedorId }, select: { name: true } }))?.name || null
    : null;
  const linkEnviado = await prisma.crmMensagem.findFirst({
    where: { contatoId: contato.id, direcao: "SAIDA", status: "OK", texto: { contains: "firehubfood.com.br/cadastro" } },
    orderBy: { criadoEm: "asc" },
    select: { criadoEm: true },
  });
  const sistema = instrucoes(config, contato, vendedor, linkEnviado?.criadoEm || null);
  const conversa = conversaParaOModelo(historico);
  if (conversa.length === 0) return;

  // ── Um modelo, depois o outro — mas nunca refazer uma AÇÃO ─────────────────
  // Se o primeiro já marcou a demonstração (ou chamou pessoa, ou mandou o
  // e-mail) e caiu antes do texto, o segundo começaria do zero e faria de novo:
  // duas reuniões, dois avisos. Depois de uma ação, a resposta vem da reserva.
  const acoes: AcaoFeita[] = [];
  let resposta = "";
  for (const modelo of MODELOS) {
    try {
      resposta = await conversarComFerramentas(ai, modelo, sistema, conversa.map((c) => ({ role: c.role, parts: [...(c.parts || [])] })), contato, acoes);
      if (resposta) break;
    } catch (err: any) {
      console.warn(`[Atendimento] ${modelo} falhou: ${err?.message}`);
    }
    if (acoes.some((a) => FERRAMENTAS_COM_EFEITO.has(a.nome))) break;
  }
  resposta = resposta.trim() || respostaDeReserva(acoes);
  if (!resposta) return;

  // Alguém assumiu enquanto o modelo pensava? Não fala por cima.
  const agora = await prisma.crmContato.findUnique({ where: { id: contato.id }, select: { roboPausadoAte: true, roboDesligado: true } });
  if (!agora || agora.roboDesligado || (agora.roboPausadoAte && agora.roboPausadoAte.getTime() > Date.now())) return;
  const depois = await prisma.crmMensagem.findFirst({ where: { contatoId: contato.id }, orderBy: { criadoEm: "desc" }, select: { direcao: true, autor: true, id: true } });
  if (depois && depois.direcao === "SAIDA" && depois.autor !== "ROBO") return;
  // O contato mandou mais coisa enquanto o modelo pensava: esta resposta já
  // nasceu velha. Começa de novo com tudo (a nova mensagem já agendou o robô;
  // agendar aqui também cobre a corrida com o fim desta volta).
  const chegouOutra = !!(depois && depois.direcao === "ENTRADA" && depois.id !== ultima.id);
  if (chegouOutra && acoes.length === 0) {
    agendarRespostaDoRobo(contato.id);
    return;
  }

  // Carimbo de ANTES do envio: mensagem que chegar durante o envio fica depois
  // desta na conversa — e a próxima volta do robô a enxerga como a última. Se
  // uma já chegou enquanto o modelo agia (a confirmação da ação sai mesmo
  // assim), esta resposta entra logo depois da mensagem que ela respondeu.
  const momento = chegouOutra ? new Date(ultima.criadoEm.getTime() + 1) : new Date();
  const envio = await enviarTexto(contato.jid, resposta, { comoRobo: true });
  await gravarMensagem({
    contatoId: contato.id, direcao: "SAIDA", autor: "ROBO", autorNome: config.nomeDoAtendente || "Robô",
    texto: resposta, status: envio.ok ? "OK" : "FALHOU", criadoEm: momento,
  });
  if (!envio.ok) console.error(`[Atendimento] Resposta do robô não saiu para ${contato.id}: ${envio.erro}`);
  if (chegouOutra) agendarRespostaDoRobo(contato.id);
}

type AcaoFeita = { nome: string; resultado: Record<string, unknown> };

/**
 * O texto quando o modelo agiu mas não chegou a escrever (caiu, devolveu
 * vazio): a pessoa não pode ficar sem saber que a demonstração foi marcada.
 */
function respostaDeReserva(acoes: AcaoFeita[]): string {
  const ultima = (nome: string) => [...acoes].reverse().find((a) => a.nome === nome && (a.resultado as any)?.ok);
  const demo = ultima("marcar_demonstracao");
  if (demo) {
    const r = demo.resultado as any;
    return `Pronto! Sua demonstração do FireHub ficou marcada para ${r.quando} com ${r.comQuem}. Vamos te chamar por aqui na hora, com o link da chamada. 🔥`;
  }
  if (ultima("montar_loja")) return "Recebi o seu cardápio! Nossa equipe já vai continuar por aqui para deixar a sua loja prontinha. 🔥";
  if (ultima("chamar_pessoa")) return "Já chamei alguém da nossa equipe — em instantes te respondem por aqui. 🙏";
  const senha = ultima("enviar_link_de_senha");
  if (senha) return `Mandei o link para criar uma senha nova no e-mail ${(senha.resultado as any).email}. Ele vale por 1 hora.`;
  if (ultima("reiniciar_whatsapp_da_loja")) return "Reiniciei a conexão do WhatsApp da sua loja. Manda um \"oi\" de outro celular daqui a 1 minuto para testar?";
  return "";
}

async function conversarComFerramentas(
  ai: NonNullable<Awaited<ReturnType<typeof clienteDoGemini>>>,
  modelo: string,
  sistema: string,
  conversa: Content[],
  contato: any,
  acoes: AcaoFeita[],
): Promise<string> {
  for (let volta = 0; volta < 5; volta++) {
    const r = await ai.models.generateContent({
      model: modelo,
      contents: conversa,
      config: {
        systemInstruction: sistema,
        temperature: 0.4,
        tools: [{ functionDeclarations: DECLARACOES as any }],
        ...(modelo.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
      },
    });
    const chamadas = r.functionCalls || [];
    if (chamadas.length === 0) return r.text || "";

    const doModelo = r.candidates?.[0]?.content;
    if (doModelo) conversa.push(doModelo);
    const respostas: Part[] = [];
    for (const chamada of chamadas) {
      let resultado: Record<string, unknown>;
      try {
        resultado = await executarFerramenta(chamada.name || "", chamada.args || {}, contato);
      } catch (err: any) {
        resultado = { erro: `Falhou: ${err?.message || "erro"}` };
      }
      acoes.push({ nome: chamada.name || "", resultado });
      respostas.push({ functionResponse: { id: chamada.id, name: chamada.name, response: resultado } });
      // O que a ferramenta mudou no contato vale para a próxima chamada da mesma volta.
      if (chamada.name === "atualizar_contato" || chamada.name === "marcar_demonstracao") {
        Object.assign(contato, (await prisma.crmContato.findUnique({ where: { id: contato.id } })) || {});
      }
    }
    conversa.push({ role: "user", parts: respostas });
  }
  return "";
}
