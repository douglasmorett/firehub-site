import { ThinkingLevel, type Content, type Part } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { gravarMensagem, mensagensDoContato } from "@/lib/crm/mensagens";
import { ROTULO_DA_ETAPA, type Etapa } from "@/lib/crm/etapas";
import { configDoAtendimento } from "./config";
import { clienteDoGemini } from "./gemini";
import { CONHECIMENTO_DO_FIREHUB } from "./conhecimento";
import { conferirResposta, RESPOSTA_DE_QUEM_NAO_SABE } from "./conferente";
import { registrarEvento, AUTOR_ROBO } from "@/lib/crm/contatos";
import { DECLARACOES, FERRAMENTAS_COM_EFEITO, chamarPessoa, executarFerramenta } from "./ferramentas";
import { enviarTexto } from "./whatsapp";
import { aulaDoVideo, consertarLinksDeVideo, listaDosVideos, videosJaEnviados, videosParaAConversa } from "./videos";
import { videosNoAr } from "./videos-no-ar";

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
 *
 * ── Dúvida de como usar o painel vira o vídeo dela ─────────────────────────
 *
 * "Como eu mexo na roteirização?" → resposta curta + o link do vídeo da
 * Roteirização (videos.ts). A lista dos vídeos vai sempre na base; a fala dos
 * vídeos do assunto da conversa vai junto, e é dela que sai o passo a passo.
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

/**
 * A oferta da montagem já saiu? O robô a repetia em toda resposta (teste de
 * 01/10: três seguidas). Reconhecida por três sinais na mesma mensagem do
 * robô: montar/lançar/deixar, cardápio ou loja, e sem custo. "Grátis" solto
 * não conta (é o "teste grátis" de toda conversa); "sem TE cobrar" conta (a
 * versão por janela de texto deixou passar esse, 02/10).
 */
const SINAIS_DA_OFERTA = [
  /(mont|lan[çc]|deix|cadastr|igualzinh|copi)/i,
  /(card[aá]pio|loja)/i,
  /(de gra[çc]a|sem (?:te |lhe )?cobrar|sem (?:nenhum |qualquer )?custo|n[ãa]o (?:te |lhe )?cobra|gratuitamente)/i,
];
const ehOfertaDaMontagem = (texto: string) => SINAIS_DA_OFERTA.every((r) => r.test(texto));

/** Os vídeos na conversa: a lista de todos (base), a fala dos do assunto e os títulos dos que já foram mandados. */
type VideosDaConversa = { lista: string; aulas: string; jaEnviados: string[] };

function instrucoes(
  config: Awaited<ReturnType<typeof configDoAtendimento>>, contato: any, vendedor: string | null, linkDeCadastroEm: Date | null, ofereceuMontagem: boolean,
  lojaInformada: string | null, videos: VideosDaConversa,
): string {
  const apresentacao = config.nomeDoAtendente
    ? `Você é ${config.nomeDoAtendente}, assistente virtual do atendimento do FireHub no WhatsApp.`
    : "Você é o assistente virtual do atendimento do FireHub no WhatsApp. Você não tem nome próprio: nunca invente um.";
  const ficha = [
    `- Nome: ${contato.nome || "não sabemos ainda"}`,
    `- Loja: ${contato.nomeDaLoja || "não sabemos ainda"}${contato.cidade ? ` (${contato.cidade})` : ""}`,
    contato.userId
      ? "- É LOJISTA: a loja dele foi reconhecida pelo número que está escrevendo. Modo SUPORTE."
      : lojaInformada
        ? `- Diz ser da loja ${lojaInformada}, mas escreve de um número que NÃO está cadastrado nela. Modo SUPORTE só com a base: nada de dados da conta (fatura, pedidos, senha, reiniciar). Não venda nem ofereça cadastro.`
        : "- O número NÃO é de nenhuma loja cadastrada. Modo VENDA — mas se a pessoa der sinal de que já usa o FireHub (\"minha loja\", \"meu painel\", \"já uso\", \"sou cliente\"), pare de vender: pergunte o nome da loja ou o e-mail da conta e use identificar_loja.",
    `- Etapa no funil: ${ROTULO_DA_ETAPA[contato.etapa as Etapa] || contato.etapa}`,
    vendedor ? `- Especialista que cuida dele: ${vendedor}` : "",
    contato.resumo ? `- O que já sabemos: ${contato.resumo}` : "",
    // Conferido no banco, não deixado à memória do modelo: ele mandava o link em toda resposta (01/10).
    linkDeCadastroEm
      ? `- O link de cadastro JÁ FOI ENVIADO nesta conversa (${linkDeCadastroEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}). NÃO mande de novo, a não ser que a pessoa peça o link ou diga que não achou.`
      : "- O link de cadastro ainda não foi enviado.",
    ofereceuMontagem
      ? "- A montagem grátis da loja JÁ FOI OFERECIDA nesta conversa. Não ofereça de novo nem peça o link/foto do cardápio outra vez: responda só o que a pessoa perguntou. Se ela mandar o link ou a foto, aí sim siga com a montagem."
      : "- A montagem grátis da loja ainda não foi oferecida.",
    videos.jaEnviados.length
      ? `- Vídeos já mandados nesta conversa: ${videos.jaEnviados.join("; ")}. Não mande de novo, a não ser que a pessoa peça ("no vídeo que te mandei").`
      : "",
  ].filter(Boolean).join("\n");

  return `${apresentacao}

# Como falar
- Escreva como uma pessoa da equipe escreve no WhatsApp: CURTO. Uma ideia por mensagem, 1 ou 2 frases, mire em até 200 caracteres. UM parágrafo só: sem linhas em branco, sem tópicos, sem lista.
- Responda primeiro, e direto, o que a pessoa perguntou ("Dá sim!" + o essencial). Detalhe só se ela pedir.
- Pergunta aberta ("como funciona?", "o que faz?") NÃO é pedido de apresentação completa: diga em uma frase o principal para o caso DELA e pergunte o que ela quer resolver. Ex.: "Ele junta WhatsApp e balcão num painel só: o robô anota o pedido no WhatsApp e tudo imprime na cozinha. Hoje o que mais te dá trabalho?"
- Siga o assunto DELA. Não termine toda mensagem com oferta, convite ou link; pergunta de volta só quando ajuda a entender o negócio dela, e uma por vez.
- Não repita o que já está na conversa (preço, teste grátis, link, o que o FireHub faz).
- Negrito do WhatsApp (*assim*) só em algo muito importante. No máximo um emoji, e não em toda mensagem.
- Se perguntarem se você é robô/humano: diga que é o assistente virtual e que uma pessoa da equipe pode assumir quando precisar.

# Regras
- Só afirme o que está na BASE abaixo (ou no que as ferramentas devolverem). Não sabe? Diga que vai confirmar com a equipe e use chamar_pessoa. Nunca invente função, preço, prazo, desconto ou integração.
- "Dá para fazer X?" / "Como faço X no painel?": só responda se a BASE descreve X. Se não descreve, você NÃO SABE, nem que sim nem que não: não diga que dá, não diga que não dá, não descreva botão, aba nem passo a passo. Diga que vai confirmar com a equipe e use chamar_pessoa. Ex.: a base diz só "Pedidos: menu Pedidos"; isso NÃO quer dizer que dá para mudar o tipo do pedido por ali.
- O que alguém da equipe respondeu antes nesta conversa vale para aquele assunto, não é manual do sistema: não tire dali como funciona outra coisa.
- Toda resposta passa por uma revisão antes de sair: o que não estiver na base é barrado e vira "vou confirmar com a equipe". Na dúvida, já diga isso você.
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
- Conta criada agora há pouco nesta conversa, ou loja que ainda não lançou o cardápio: a montagem grátis vale igual (link ou foto do cardápio → montar_loja).

# Modo VENDA (interessado)
- O melhor atendimento é tirar as dúvidas aqui mesmo. Entenda o negócio aos poucos (tipo de loja, cidade, por onde vende hoje, se usa algum sistema, o que mais incomoda) e mostre o que do FireHub resolve ESSA dor.
- Preço só quando perguntarem (1%, mínimo R$ 100, máximo R$ 400).
- O SEU OBJETIVO é levar quem ainda não tem conta ao cadastro, e o melhor argumento é a montagem da loja. VOCÊ oferece, sem esperar a pessoa perguntar, UMA VEZ SÓ na conversa: não na primeira resposta (nela, só responda e entenda o negócio), mas na 2ª ou 3ª, ou antes se ela mostrar interesse. Responda a pergunta dela em uma frase e, na mesma mensagem, faça a oferta em outra, curta, algo como: "E se você já vende em outro lugar (iFood, outro cardápio), é só me mandar o link que a gente deixa sua loja igualzinha aqui, com todo o cardápio lançado, sem cobrar nada. Não tem link? Manda uma foto do cardápio." Passe a ideia de que é fácil, simples e que A GENTE FAZ por ela. A loja fica pronta no mesmo dia.
- Recebeu o link ou as fotos do cardápio e a pessoa ainda não tem conta: peça os dados para criar a conta por aqui ("Pra eu já deixar sua loja pronta, me passa seu nome, o nome da loja, a cidade, seu e-mail e CPF? Se tiver CNPJ, manda também."), crie a conta e depois use montar_loja. Chegou a foto ou o link enquanto você espera os dados? Agradeça curto e lembre o que falta para a conta; montar_loja só depois de criar_conta. Se ela disser que não quer passar os dados agora, use montar_loja com semContaPorEscolha.
- Criar a conta por aqui é o caminho preferido; o link firehubfood.com.br/cadastro só se ela preferir fazer sozinha, e vai UMA vez na conversa (depois, "pelo link que te mandei"). Peça o que falta numa pergunta curta só, em uma linha, sem lista. O CPF é obrigatório; sem CNPJ a conta fica no CPF. Antes de criar, REPITA o e-mail ("Confirma o e-mail fulano@gmail.com?") e só use criar_conta depois do "sim". Nunca peça nem mande senha: ela cria pelo link que chega no e-mail.
- montar_loja precisa do nome da loja e do link OU das fotos do cardápio ("📷 Imagem" na conversa). Bairros com as taxas e horários ajudam, mas não trave por eles. Depois, avise que a equipe continua por aqui.
- Demonstração com um vendedor é a ÚLTIMA opção: só se a pessoa pedir para ver funcionando ou falar com alguém, ou se as dúvidas não se resolverem aqui. Aí use chamar_pessoa com o motivo "quer agendar demonstração" e diga que a equipe vai combinar o horário por aqui.

# Quando mandar vídeo
- "Como faço…?", "onde fica…?", "como configuro…?" sobre algo que um vídeo da lista mostra: responda em uma frase o essencial e mande o link do vídeo na linha de baixo. Ex.: "Na Roteirização você junta os pedidos no mapa e despacha a rota para o motoboy. Esse vídeo mostra o passo a passo:" e, na linha de baixo, o link.
- Dúvida de um ponto só do vídeo: mande o link do capítulo (o que abre direto naquele ponto), que está em "O que os vídeos ensinam" ou no que ver_tutorial devolveu.
- O passo a passo que você escreve sai da fala do vídeo ("O que os vídeos ensinam" ou ver_tutorial). Sem a fala na mão, use ver_tutorial ou não descreva passos: só diga que o vídeo mostra e mande o link.
- O link vai exatamente como está na lista, sozinho na última linha, sem negrito e sem ponto no fim. Nunca monte nem invente link de vídeo.
- Um vídeo por mensagem; dois só se a pergunta for de duas telas. Vídeo que já foi nesta conversa não vai de novo.
- Problema na conta (não imprime, robô mudo, pedido não entrou) não se resolve com vídeo: primeiro estado_da_loja e os Problemas comuns; o vídeo vem depois, se ajudar.
- A loja e os valores que aparecem nos vídeos são de demonstração: não fale deles como se fossem da pessoa.
- Interessado que quer ver como funciona: pode mandar o vídeo do assunto (ou "Um passeio pelo painel", se estiver na lista) antes de falar em demonstração.
- Nenhum vídeo da lista é do assunto? Responda pela base, como sempre.

# BASE
${CONHECIMENTO_DO_FIREHUB}${videos.lista ? `\n\n${videos.lista}` : ""}
${config.instrucoesExtras.trim() ? `\n# Recados do dono (valem mais que a base)\n${config.instrucoesExtras.trim()}\n` : ""}${videos.aulas ? `\n# O que os vídeos ensinam (os do assunto desta conversa: a fala gravada, capítulo por capítulo)\n${videos.aulas}\n` : ""}
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

/** A conversa em texto corrido para o revisor, dizendo quem falou: o que a equipe disse conta como fonte. */
function conversaParaORevisor(historico: { direcao: string; autor: string; autorNome: string | null; texto: string }[]): string {
  return historico
    .map((m) => {
      const quem = m.direcao === "ENTRADA" ? "Contato" : m.autor === "ROBO" ? "Robô" : `Equipe (${m.autorNome || "pessoa"})`;
      return `${quem}: ${m.texto}`;
    })
    .join("\n");
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
  const ofereceuMontagem = historico.some((m) => m.direcao === "SAIDA" && ehOfertaDaMontagem(m.texto));
  // A loja que a pessoa DISSE ser (identificar_loja), quando o número não é de nenhuma.
  const informada = contato.userId
    ? null
    : await prisma.crmEvento.findFirst({ where: { contatoId: contato.id, texto: { startsWith: "Diz ser da loja " } }, orderBy: { criadoEm: "desc" }, select: { texto: true } });
  const lojaInformada = informada ? informada.texto.replace(/^Diz ser da loja /, "").replace(/ \(firehubfood[\s\S]*$/, "") : null;
  // Os vídeos: só os que já estão no servidor; a fala dos que a busca acha nas
  // últimas mensagens do contato (videos.ts).
  const videos = videosNoAr();
  const idsDosVideos = new Set(videos.map((v) => v.id));
  const doContato = historico.filter((m) => m.direcao === "ENTRADA").slice(-3).map((m) => m.texto);
  const doVideo: VideosDaConversa = {
    lista: listaDosVideos(videos),
    aulas: videosParaAConversa(doContato, videos).map(aulaDoVideo).join("\n\n"),
    jaEnviados: videosJaEnviados(historico).flatMap((id) => videos.filter((v) => v.id === id).map((v) => v.titulo)),
  };
  const sistema = instrucoes(config, contato, vendedor, linkEnviado?.criadoEm || null, ofereceuMontagem, lojaInformada, doVideo);
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
  // Link de vídeo sai sempre no formato certo e só de vídeo que existe (videos.ts).
  const doModelo = consertarLinksDeVideo(paraOWhatsApp(resposta), idsDosVideos);
  resposta = doModelo || respostaDeReserva(acoes);
  if (!resposta) return;

  // ── A revisão: o que não tem fonte não sai (conferente.ts) ────────────────
  // A resposta de reserva é texto fixo nosso e não passa por ela. A fala dos
  // vídeos conta como fonte: a do assunto vai na base, a que o robô pediu pela
  // ver_tutorial vai inteira nas ferramentas (o corte de 1.500 a picotava).
  if (doModelo) {
    const paraConferir = {
      base: [
        CONHECIMENTO_DO_FIREHUB,
        doVideo.lista,
        doVideo.aulas ? `# O que os vídeos ensinam (a fala gravada de cada capítulo)\n${doVideo.aulas}` : "",
        config.instrucoesExtras.trim() ? `# Recados do dono\n${config.instrucoesExtras.trim()}` : "",
      ].filter(Boolean).join("\n\n"),
      conversa: conversaParaORevisor(historico.slice(-12)),
      ferramentas: acoes.map((a) => `${a.nome}: ${JSON.stringify(a.resultado).slice(0, a.nome === "ver_tutorial" ? 8000 : 1500)}`).join("\n"),
    };
    let veredito = await conferirResposta(ai, { ...paraConferir, resposta: doModelo });
    // ── Uma frase sem fonte não cala a conversa ──────────────────────────────
    // No teste de 02/10, "Anota sim! … tira dúvidas sobre os sabores" foi
    // barrado inteiro por um enfeite: chamou pessoa e o robô ficou mudo no meio
    // da venda (foto, dados e confirmação do lead sem resposta, de madrugada).
    // Antes de desistir, a mesma resposta é reescrita SEM o trecho e conferida
    // de novo; o trecho fica na ficha para a base ganhar o que faltava.
    if (veredito?.inventou) {
      const reescrita = await reescreverSemOTrecho(ai, sistema, conversa, doModelo, veredito.trecho);
      const corrigida = reescrita ? consertarLinksDeVideo(reescrita, idsDosVideos) : null;
      const segunda = corrigida ? await conferirResposta(ai, { ...paraConferir, resposta: corrigida }) : null;
      if (corrigida && segunda && !segunda.inventou) {
        await registrarEvento(contato.id, "ROBO", `Revisão tirou da resposta (sem fonte na base): "${veredito.trecho}"`, AUTOR_ROBO);
        resposta = corrigida;
        veredito = segunda;
      }
    }
    if (veredito?.inventou) {
      console.warn(`[Atendimento] Revisor barrou a resposta para ${contato.id}: "${veredito.trecho}"`);
      resposta = RESPOSTA_DE_QUEM_NAO_SABE;
      // Quem atende precisa ver o que o robô ia dizer, para responder certo
      // (e para a base ganhar o que estava faltando).
      if (!acoes.some((a) => a.nome === "chamar_pessoa")) {
        await chamarPessoa(contato, `Pergunta que a base não cobre: "${ultima.texto.slice(0, 200)}". O robô ia responder: "${doModelo.slice(0, 400)}" (sem fonte: "${veredito.trecho}"). Barrado pela revisão.`);
      } else {
        await registrarEvento(contato.id, "ROBO", `Revisão barrou: "${doModelo.slice(0, 400)}" (sem fonte: "${veredito.trecho}")`, AUTOR_ROBO);
      }
    }
  }

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
 * A resposta de novo, sem a frase que a revisão barrou. Sem ferramentas (a
 * ação, se houve, já foi feita) e no primeiro modelo. `null` quando não sobra
 * resposta sem o trecho — aí vale o "vou confirmar com a equipe".
 */
async function reescreverSemOTrecho(
  ai: NonNullable<Awaited<ReturnType<typeof clienteDoGemini>>>, sistema: string, conversa: Content[], resposta: string, trecho: string,
): Promise<string | null> {
  try {
    const r = await ai.models.generateContent({
      model: MODELOS[0],
      contents: [
        ...conversa,
        {
          role: "user",
          parts: [{ text: `[REVISÃO INTERNA — o contato não vê isto] Você ia responder:\n"${resposta}"\nO trecho "${trecho}" não está na BASE. Reescreva a mesma resposta SEM essa afirmação nem nada parecido, curta, no mesmo tom, só com o que a BASE diz. Se sem ela não sobrar resposta, escreva apenas: SEM_RESPOSTA` }],
        },
      ],
      config: { systemInstruction: sistema, temperature: 0.2, ...(MODELOS[0].startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}) },
    });
    const texto = paraOWhatsApp(r.text || "");
    return texto && !texto.includes("SEM_RESPOSTA") ? texto : null;
  } catch (err: any) {
    console.warn(`[Atendimento] Reescrita depois da revisão falhou: ${err?.message}`);
    return null;
  }
}

/**
 * O modelo escreve em Markdown mesmo pedido o contrário: **negrito** chega ao
 * cliente com os asteriscos (o WhatsApp só entende *um*), e a linha em branco
 * entre frases vira "textão" na tela do celular.
 */
function paraOWhatsApp(texto: string): string {
  return String(texto || "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

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
  const conta = ultima("criar_conta");
  if (conta) return `Pronto, sua conta no FireHub está criada e o teste grátis começou! Mandei no e-mail ${(conta.resultado as any).email} o link para você criar a senha. Pra gente deixar sua loja pronta, sem custo, é só mandar o link do cardápio que você usa hoje ou uma foto dele.`;
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
      if (chamada.name === "atualizar_contato" || chamada.name === "marcar_demonstracao" || chamada.name === "criar_conta") {
        Object.assign(contato, (await prisma.crmContato.findUnique({ where: { id: contato.id } })) || {});
      }
    }
    conversa.push({ role: "user", parts: respostas });
  }
  return "";
}
