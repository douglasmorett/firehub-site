/**
 * ENSAIO DO ROBÔ DO NÚMERO DO FIREHUB — as perguntas reais, com o Gemini de
 * verdade, sem WhatsApp e sem gravar nada.
 *
 *   ENV_DIR=C:\Users\Micro\Documents\firehub-site npx tsx scripts/ensaio-do-robo-do-firehub.ts
 *   … ensaio-do-robo-do-firehub.ts pix estoque     (só os casos com esse nome)
 *
 * Monta o MESMO prompt do robô (robo.ts → instrucoes, com a base e o manual
 * dos vídeos), deixa o modelo chamar ferramentas de mentira (chamar_pessoa só
 * anota; nada é enviado nem gravado), e passa a resposta pelas mesmas travas:
 * a de "mudei aqui para você" e o revisor (conferente.ts).
 *
 * Cada caso é uma conversa que deu errado de verdade (data no nome). Na
 * revisão periódica das conversas (.claude/skills/revisar-robo-do-firehub),
 * todo erro novo vira um caso aqui ANTES de mexer na base: o caso tem que
 * falhar, a base muda, o caso passa, e os antigos continuam passando.
 *
 * Lê o banco só para a chave do Gemini (se não estiver no ambiente) e os
 * "Recados do dono" da tela. Custa centavos por rodada.
 */
import path from "node:path";
import dotenv from "dotenv";

const pasta = process.env.ENV_DIR || process.cwd();
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });

type Fala = { de: "contato" | "robo" | "equipe"; texto: string };
type Caso = {
  nome: string;
  lojista: boolean;
  conversa: Fala[];
  /** Tem que aparecer na resposta (cada regex). */
  deve?: RegExp[];
  /** Não pode aparecer na resposta. */
  naoPode?: RegExp[];
  /** true: tem que chamar a equipe; false: não pode chamar. */
  chamaEquipe?: boolean;
};

const CASOS: Caso[] = [
  {
    nome: "serpa-promo-da-grande (03/10)",
    lojista: true,
    conversa: [{ de: "contato", texto: "Eu quero colocar a pizza Grande de filé mignon na promoção 65 reais. Ela é 80. Coloquei 65 no promo e ficou 95 no cardápio" }],
    // Pôs 65 e apareceu 95 → o produto é R$ 30 → o Promo +R$ certo é 35. O
    // flash com pensamento baixo erra essa conta (mandou pôr 15, 50 e 25 em
    // rodadas diferentes); então ele ensina a ler a conta que a tela mostra
    // embaixo da linha. Número dado só pode ser o 35.
    deve: [/Promo \+R\$/i, /(Na promo[çc][aã]o sai|do produto)/i],
    naoPode: [/(coloque|ponha|digite) (o )?(R\$ ?)?65 no/i, /(coloque|ponha|digite|colocar|p[oô]r)[^.\n]{0,25}\*?\b(15|25|50)\b\*?/i],
    chamaEquipe: false,
  },
  {
    nome: "serpa-print-assim (03/10)",
    lojista: true,
    conversa: [
      { de: "contato", texto: "Como coloco só a pizza grande na promoção?" },
      { de: "robo", texto: "Na linha da Grande, em Promo +R$, ponha quanto ela soma ao preço do produto na promoção e salve." },
      { de: "contato", texto: "📷 Assim?" },
    ],
    // Ele não vê a imagem: "está certo" só vale condicionado ("se aparecer X, está certo").
    naoPode: [/(^|[.!]\s+)(sim|isso( mesmo)?|exatamente|perfeito|est[aá] cert[oa])\b/i, /d[aá] para ajustar por a[ií] sim/i],
    deve: [/Na promo[çc][aã]o sai/i],
  },
  {
    nome: "luxuria-marmita-sumiu (03/10)",
    lojista: true,
    conversa: [{ de: "contato", texto: "Bom dia, meu amigo. Eu não consegui ver as marmitas naquele cardápio, só aparece os lanches" }],
    deve: [/hor[aá]rio/i],
    chamaEquipe: false,
  },
  {
    nome: "luxuria-marmita-em-primeiro (03/10)",
    lojista: true,
    conversa: [
      { de: "contato", texto: "A marmita, você tem como colocar ela na primeira fileira? Pra pessoa ver de cara que tem a marmita" },
      { de: "equipe", texto: "Tem sim" },
      { de: "contato", texto: "Então tá bom, aí se você conseguir mudar pra mim, eu agradeço, tá?" },
    ],
    naoPode: [/\b(mudei|coloquei|alterei|j[aá] est[aá] (aparecendo|em primeiro))\b/i],
  },
  {
    nome: "lead-repasse-do-pix-online (03/10)",
    lojista: false,
    conversa: [
      { de: "contato", texto: "Como funciona as formas de pagamento para o cliente fazer o pedido" },
      { de: "robo", texto: "O cliente escolhe na tela do cardápio como quer pagar: na entrega ou online (Pix e cartão pelo Asaas)." },
      { de: "contato", texto: "Correto, e como funciona o repasse desses pagamentos do cliente direto on-line para mim" },
    ],
    deve: [/Asaas/i, /(na hora|2 dias)/i],
    chamaEquipe: false,
  },
  {
    nome: "lead-taxas-do-asaas (03/10)",
    lojista: false,
    conversa: [
      { de: "contato", texto: "como funciona o repasse dos pagamentos online para mim?" },
      { de: "robo", texto: "O pagamento online cai direto na sua conta Asaas: Pix na hora e cartão em até 2 dias úteis." },
      { de: "contato", texto: "E quais são as taxas para essas transações ?" },
    ],
    deve: [/1,99/, /3,99/],
    naoPode: [/0,99%/],
    chamaEquipe: false,
  },
  {
    nome: "lead-pix-antes-do-pedido (03/10)",
    lojista: false,
    conversa: [{ de: "contato", texto: "vamos supor que o cliente quer pagar no pix diretamente online, o sistema acusa automaticamente o pagamento antes da confirmação do pedido?" }],
    deve: [/(depois de pag|s[oó] (a[ií]|depois)|s[oó] (vai|entra|chega).*(pag|cozinha)|enquanto n[aã]o pag)/i],
    chamaEquipe: false,
  },
  {
    nome: "lead-estoque (03/10)",
    lojista: false,
    conversa: [{ de: "contato", texto: "E o sistema de estoque do sistema como funciona pode me informar por favor ?" }],
    deve: [/(insumo|nota|Entrada com IA|ficha)/i],
    chamaEquipe: false,
  },
  {
    nome: "chave-pix-no-robo (03/10)",
    lojista: true,
    conversa: [{ de: "contato", texto: "Como é que eu faço pra colocar a chave do Pix para quando o cliente pedir o robô mandar automaticamente?" }],
    deve: [/Chatbot/i, /Chave Pix/i],
    chamaEquipe: false,
  },
  {
    nome: "pizza-meio-a-meio (03/10)",
    lojista: true,
    conversa: [{ de: "contato", texto: "como que eu lanço uma pizza meio a meio?" }],
    deve: [/Novo Item/i, /Pizza/i, /tutoriais\/cardapio-pizza/],
    chamaEquipe: false,
  },
  {
    nome: "na-goma-taxa-por-bairro (03/10)",
    lojista: true,
    conversa: [{ de: "contato", texto: "aqui existem bairros que são mais afastados e assim o valor da entrega é maior. Eu tenho algum menu pra poder configurar isso?" }],
    deve: [/bairro/i, /Entrega/i],
    chamaEquipe: false,
  },
  {
    nome: "nik-aba-todos-do-balcao (03/10)",
    lojista: true,
    conversa: [{ de: "contato", texto: "No balcão, consigo tirar aquela aba Todos da tela de pedido? As meninas só fazem pelo nome da categoria" }],
    naoPode: [/(clique|v[aá] em|abra).*(esconder|ocultar|tirar).*Todos/i],
  },
];

const filtro = process.argv.slice(2).map((s) => s.toLowerCase());

(async () => {
  const { DECLARACOES } = await import("../src/lib/atendimento/ferramentas");
  const { instrucoes, conversaParaOModelo, conversaParaORevisor, paraOWhatsApp, reescreverSemOTrecho, MODELOS } = await import("../src/lib/atendimento/robo");
  const { acaoDitaSemFerramenta, conferirResposta } = await import("../src/lib/atendimento/conferente");
  const { consertarLinksDeVideo, manualDosVideos } = await import("../src/lib/atendimento/videos");
  const { CONHECIMENTO_DO_FIREHUB } = await import("../src/lib/atendimento/conhecimento");
  const { todosOsTutoriais } = await import("../src/lib/tutoriais");
  const { clienteDoGemini } = await import("../src/lib/atendimento/gemini");
  const { configDoAtendimento } = await import("../src/lib/atendimento/config");
  const { ThinkingLevel } = await import("@google/genai");

  const ai = await clienteDoGemini();
  if (!ai) throw new Error("Sem chave do Gemini (GEMINI_API_KEY ou a da conta matriz no banco).");
  let config: any;
  try {
    config = await configDoAtendimento();
  } catch {
    config = { nomeDoAtendente: "", instrucoesExtras: "" };
  }
  // Todos os vídeos contam como no ar (as fichas publicadas), como no teste dos vídeos.
  const videos = todosOsTutoriais(null).flatMap((g) => g.tutoriais);
  const ids = new Set(videos.map((v) => v.id));
  const manual = manualDosVideos(videos);
  const baseDoRevisor = [CONHECIMENTO_DO_FIREHUB, manual, config.instrucoesExtras?.trim() ? `# Recados do dono\n${config.instrucoesExtras.trim()}` : ""].filter(Boolean).join("\n\n");

  let falhas = 0;
  for (const caso of CASOS.filter((c) => !filtro.length || filtro.some((f) => c.nome.toLowerCase().includes(f)))) {
    const contato = {
      id: "ensaio", nome: caso.lojista ? "Lojista" : "Interessado", nomeDaLoja: caso.lojista ? "Loja do Ensaio" : null, cidade: null,
      etapa: caso.lojista ? "EM_TESTE" : "CONVERSANDO", userId: caso.lojista ? "loja-do-ensaio" : null, resumo: null,
    };
    const historico = caso.conversa.map((f) => ({
      direcao: f.de === "contato" ? "ENTRADA" : "SAIDA", autor: f.de === "robo" ? "ROBO" : f.de === "equipe" ? "HUMANO" : "CONTATO",
      autorNome: f.de === "equipe" ? "Equipe" : null, texto: f.texto,
    }));
    const sistema = instrucoes(config, contato, null, null, caso.lojista, null, { manual, jaEnviados: [] });
    const conversa = conversaParaOModelo(historico);

    // O modelo com ferramentas de mentira: nada sai daqui.
    const chamadas: string[] = [];
    let resposta = "";
    const t0 = Date.now();
    let uso: any = null;
    for (let volta = 0; volta < 5 && !resposta; volta++) {
      const r = await ai.models.generateContent({
        model: MODELOS[0],
        contents: conversa,
        config: { systemInstruction: sistema, temperature: 0.4, tools: [{ functionDeclarations: DECLARACOES as any }], thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      uso = r.usageMetadata;
      const fc = r.functionCalls || [];
      if (!fc.length) {
        resposta = r.text || "";
        break;
      }
      if (r.candidates?.[0]?.content) conversa.push(r.candidates[0].content);
      conversa.push({
        role: "user",
        parts: fc.map((c) => {
          chamadas.push(`${c.name}(${JSON.stringify(c.args || {}).slice(0, 120)})`);
          const resultado = c.name === "chamar_pessoa" || c.name === "atualizar_contato" ? { ok: true } : c.name === "estado_da_loja" ? { ok: true, observacao: "Tudo conectado (ensaio)." } : { ok: false, erro: "Indisponível no ensaio." };
          return { functionResponse: { id: c.id, name: c.name, response: resultado } };
        }),
      });
    }
    resposta = consertarLinksDeVideo(paraOWhatsApp(resposta), ids);
    const feito = acaoDitaSemFerramenta(resposta, chamadas.map((c) => ({ nome: c.split("(")[0] })));
    const veredito = feito
      ? null
      : await conferirResposta(ai, {
          base: baseDoRevisor,
          conversa: conversaParaORevisor(historico),
          ferramentas: chamadas.join("\n"),
          resposta,
        });

    // O caminho de produção (robo.ts): frase sem fonte → a resposta é reescrita
    // sem ela e conferida de novo; não passou → "vou confirmar com a equipe".
    // O que se avalia é o texto que SAIRIA. Corte na revisão é aviso: mostra o
    // que falta na base, mas a conversa segue.
    const avisos: string[] = [];
    let sairia = resposta;
    let barrada = false;
    if (veredito?.inventou) {
      avisos.push(`revisão cortou: "${veredito.trecho}"`);
      const reescrita = await reescreverSemOTrecho(ai, sistema, conversaParaOModelo(historico), resposta, veredito.trecho);
      const corrigida = reescrita ? consertarLinksDeVideo(reescrita, ids) : "";
      const segunda = corrigida
        ? await conferirResposta(ai, {
            base: baseDoRevisor, conversa: conversaParaORevisor(historico), ferramentas: chamadas.join("\n"), resposta: corrigida,
          })
        : null;
      if (corrigida && segunda && !segunda.inventou) sairia = corrigida;
      else {
        sairia = "(barrada: sairia o \"vou confirmar com a equipe\")";
        barrada = true;
      }
    }

    const chamou = chamadas.some((c) => c.startsWith("chamar_pessoa"));
    const problemas: string[] = [];
    for (const r of caso.deve || []) if (!r.test(sairia)) problemas.push(`faltou ${r}`);
    for (const r of caso.naoPode || []) if (r.test(sairia)) problemas.push(`não podia ${r}`);
    if (caso.chamaEquipe === true && !chamou) problemas.push("devia chamar a equipe");
    if (caso.chamaEquipe === false && (chamou || barrada)) problemas.push("chamou a equipe sem precisar");
    if (feito) problemas.push(`trava "disse que fez": ${feito}`);
    if (problemas.length) falhas++;

    console.log(`\n${problemas.length ? "❌" : "✅"} ${caso.nome}  (${((Date.now() - t0) / 1000).toFixed(1)} s, entrada ${uso?.promptTokenCount ?? "?"} tokens, ${uso?.cachedContentTokenCount ?? 0} em cache)`);
    console.log(`   💬 ${caso.conversa[caso.conversa.length - 1].texto}`);
    console.log(`   🤖 ${resposta.replace(/\n/g, "\n      ")}`);
    if (chamadas.length) console.log(`   🔧 ${chamadas.join(" · ")}`);
    for (const p of problemas) console.log(`   ❗ ${p}`);
    for (const a of avisos) console.log(`   ✂️  ${a}`);
    if (sairia !== resposta) console.log(`   📤 sairia: ${sairia.replace(/\n/g, "\n      ")}`);
  }
  console.log(falhas ? `\n${falhas} caso(s) com problema.` : "\nTodos os casos passaram.");
  process.exit(falhas ? 1 : 0);
})();
