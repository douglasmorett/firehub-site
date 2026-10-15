/**
 * BILL, SEU ASSESSOR — o dono fala com o WhatsApp da própria loja (áudio, texto ou
 * foto) e o sistema GRAVA: "comprei 10 Coca lata, paguei 45" vira entrada no
 * estoque e saída no financeiro numa mensagem só.
 *
 * Douglas, 14/10/2026: "o dono de restaurante está muito tarefado o tempo
 * inteiro. Quando a gente traz facilidade para ele, a gente fecha uma venda."
 * O modo dono do robô (chatbot-ai.ts) já reconhecia o número e respondia
 * relatório, mas era só leitura ("por aqui eu não consigo gravar"). Este é o
 * caminho de volta: a informação entra e sai do sistema pelo comando daquele
 * número.
 *
 * Separado do robô de vendas de propósito: o prompt de lá é de vender comida
 * (cardápio, entrega, Pix) e fica em cache por loja; misturar as ferramentas
 * de gravar aqui deixaria cada cliente pagando por elas, e o risco de um
 * cliente comum chegar numa ferramenta de financeiro seria uma linha de código.
 * Aqui só entra quem `ehNumeroDoDono` (webhook) ou a sessão do painel.
 *
 * O Gemini ouve o áudio e lê a foto direto (inlineData), sem transcrever antes.
 */
import { GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { trackGeminiUsage } from "@/lib/usage-tracker";
import { montarResumoGerencial, resumoEmTexto } from "@/lib/painel-do-dono";
import { hojeNaLoja, NOMES_DOS_DIAS } from "@/lib/relatorios/base";
import { gravarFala, historicoParaOModelo } from "./conversa";
import { oQueMudouNaLoja } from "./o-que-mudou";
import { DECLARACOES_DO_ASSESSOR, FERRAMENTAS_QUE_GRAVAM, executarFerramentaDoAssessor, type ContextoDoAssessor } from "./ferramentas";

export const MODELOS_DO_ASSESSOR = ["gemini-3.6-flash", "gemini-2.5-flash"];

export type MidiaDoDono = { base64: string; mimeType: string };
export type AcaoDoAssessor = { nome: string; resultado: Record<string, unknown> };
export type RespostaDoAssessor = { resposta: string; ouvi: string | null; acoes: AcaoDoAssessor[]; gravou: boolean };

// A conversa mora no banco (conversa.ts): uma por loja, a mesma no WhatsApp
// e no painel.

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
}

async function montarSistema(ctx: ContextoDoAssessor): Promise<string> {
  const loja = await prisma.user.findUnique({
    where: { id: ctx.franchiseeId },
    select: { name: true, storeName: true, deliveryZones: true, cashOpen: true, storeTimezone: true, storeOpen: true } as any,
  }) as any;
  const tz = ctx.timezone || loja?.storeTimezone || "America/Sao_Paulo";
  const hoje = hojeNaLoja(tz);
  const diaDaSemana = NOMES_DOS_DIAS[new Date(`${hoje}T12:00:00Z`).getUTCDay()];

  const [insumos, categorias, resumo, mudou] = await Promise.all([
    prisma.stockItem.findMany({
      where: { franchiseeId: ctx.franchiseeId, active: true },
      orderBy: { name: "asc" },
      take: 400,
      select: { id: true, name: true, unit: true, quantity: true },
    }),
    prisma.despesaLancada
      .findMany({ where: { franchiseeId: ctx.franchiseeId }, distinct: ["categoria"], select: { categoria: true }, take: 30, orderBy: { createdAt: "desc" } })
      .catch(() => [] as { categoria: string }[]),
    montarResumoGerencial(ctx.franchiseeId, { deliveryZones: loja?.deliveryZones, caixaAberto: Boolean(loja?.cashOpen), timezone: tz })
      .then((r) => resumoEmTexto(r, tz))
      .catch(() => "(resumo da loja indisponível agora)"),
    oQueMudouNaLoja(ctx.franchiseeId, tz),
  ]);

  const listaDeInsumos = insumos.length
    ? insumos.map((i) => `${i.id} | ${i.name} | ${i.unit} | tem ${Number(i.quantity.toFixed(3))}`).join("\n")
    : "(nenhum item cadastrado ainda — todo item comprado será criado)";

  return `Você é o BILL, o assessor do FireHub: o assistente do DONO da loja "${loja?.storeName || loja?.name || "loja"}", pelo WhatsApp e pelo balão do painel (a MESMA conversa: cada fala dele diz por onde veio). Ele está ocupado, manda áudio, texto curto ou foto. Seu trabalho é LANÇAR no sistema o que ele disser (estoque e financeiro), CONTROLAR a loja (pausar/reativar itens do cardápio, abrir/fechar o site) e responder o que ele perguntar.

HOJE: ${diaDaSemana}, ${hoje.split("-").reverse().join("/")} (dia de operação da loja; vira às 5h).
SITE DA LOJA AGORA: ${loja?.storeOpen ? "ABERTO (recebendo pedidos)" : "FECHADO"}.

COMO TRABALHAR:
1. Informação completa → CHAME A FERRAMENTA na hora, sem pedir confirmação. Ele confirma lendo a sua resposta e, se errou, manda "desfaz".
2. Faltou o essencial → UMA pergunta curta e objetiva. Essencial: na compra, item + quantidade + valor; na despesa, valor; na conta a pagar, valor + vencimento.
   - Compra sem valor: pergunte "Quanto pagou no total?". Se ele disser que não sabe ou "só estoque", use pagamento SEM_VALOR.
   - Compra sem dizer como pagou: considere PAGO hoje. "Fiado", "boleto", "pra dia 20", "a prazo" = A_PRAZO com vencimento.
3. Classifique certo:
   - Mercadoria que vai para a prateleira/geladeira (insumo, bebida, embalagem, descartável) = registrar_compra (vai para estoque E financeiro).
   - Gasto pago que não é mercadoria (gás, conserto, diária, motoboy extra, anúncio, limpeza) = registrar_despesa.
   - Boleto/conta que ainda vai vencer = registrar_conta_a_pagar. "Paguei a conta X" = consultar_contas_a_pagar e depois marcar_conta_paga (se houver mais de uma parecida, pergunte qual).
   - Perda, vencido, quebrou, jogou fora, consumo da equipe = registrar_saida.
4. Itens do estoque: case pelo nome com a lista ESTOQUE DA LOJA (ex.: "coca lata" = "Coca-Cola Lata 350ml") e mande o insumoId. Só omita o insumoId se o item realmente não existir — ele será criado.
   - Unidade: mande na unidade do insumo cadastrado quando der. Fardo/caixa/pacote: converta para unidades se ele disser quantas vêm (fardo de 12 latas = 12 un); se não disser e o insumo for em "un", pergunte quantas vêm.
   - Valor: valorTotal é o TOTAL da linha ("10 coca a 4,50 cada" = 45). Vários itens com UM total só ("deu 230 tudo"): NÃO pergunte item por item — mande valorTotalDaCompra e deixe valorTotal das linhas vazio; o sistema reparte pelo último custo de cada item. Só pergunte se a ferramenta pedir.
5. FOTO: nota/cupom de compra → registrar_compra com TODOS os itens, valorTotal de cada linha, fornecedor e número da nota. Boleto/fatura → registrar_conta_a_pagar (com o código de barras). Comprovante de um gasto → registrar_despesa. Foto ilegível → peça outra.
6. ÁUDIO: entenda o áudio direto. Comece a resposta final com [[OUVI: o que ele disse, em uma linha]].
7. Perguntas sobre vendas, caixa, pedidos atrasados, contas e estoque baixo: responda com os DADOS AO VIVO abaixo, copiando os números exatos. Quantidade de um item: consultar_estoque. Nunca invente número.
8. NUNCA diga "lancei", "registrei", "anotei" ou "dei entrada" sem a ferramenta ter respondido ok:true. Se a ferramenta deu erro, explique o erro em uma frase.
9. CARDÁPIO: "acabou X", "pausa X", "tira X" = buscar_no_cardapio e depois pausar_ou_reativar_itens (ativo=false). "Voltou X", "abre X", "reativa X" = ativo=true. "O que está pausado?" = listar_itens_pausados.
   - Pause o item que ele nomeou. Se a busca trouxer sabores DIFERENTES parecidos (ex.: "Esfirra de Frango" e "Esfirra de Frango c/ Catupiry"), pause o que bate com o que ele disse e pergunte dos outros numa frase. "Tudo de frango" = pause todos os que têm frango.
   - Na resposta, diga os itens exatos e lembre que o iFood se pausa pelo app do iFood.
10. "Fecha a loja/site" ou "pode abrir" = abrir_ou_fechar_site (avise que iFood/99 seguem abertos).
11. Mudar preço, foto, descrição, pedido ou o jeito do robô atender: ainda não dá por aqui — indique o painel.

13. O que a ferramenta acabou de devolver (e os DADOS AO VIVO abaixo) vale mais do que qualquer número ou lista que você disse antes nesta conversa: a resposta antiga pode estar errada ou velha. Pergunta de estoque, pausados, contas ou vendas = consulte de novo e responda SÓ com o resultado novo, nunca copiando a resposta anterior.
12. As marcas entre colchetes no histórico ("[WhatsApp]", "[painel, Nome]", "[ferramentas desta resposta: …]") são do sistema, para você saber por onde ele falou e o que você já executou. NUNCA escreva essas marcas na resposta.

RESPOSTA (WhatsApp ou painel): curta, direta, sem enrolação. Depois de lançar, diga O QUE foi para ONDE, assim:
"✅ *Lançado*
📦 Estoque: Coca-Cola Lata +10 un (agora 34 un)
💰 Financeiro: R$ 45,00 pago hoje
Errou? Manda *desfaz*."
Use *negrito* do WhatsApp, nunca markdown com ** ou #.

CATEGORIAS DE DESPESA JÁ USADAS: ${categorias.map((c) => c.categoria).join(", ") || "(nenhuma ainda)"}

ESTOQUE DA LOJA (id | nome | unidade | quantidade atual):
${listaDeInsumos}

${resumo}

${mudou}`;
}

/** A IA disse que gravou sem ter gravado? */
// Primeira pessoa e o ✅: "não há nada registrado hoje" é resposta honesta.
const DIZ_QUE_GRAVOU = /\b(lancei|registrei|anotei|gravei|dei entrada|dei baixa|marquei como pag[oa]|desfiz|pausei|reativei|fechei|reabri)\b|✅/i;
/**
 * Cara de ação feita ("foram fechados", "⏸️ Pausado"). Só vale quando NENHUMA
 * ferramenta rodou: aí o modelo ganha outra chance. Não apaga resposta — a
 * lista de pausados usa ⏸ com toda a razão.
 */
const AFIRMA_ACAO = /\b(lançad|registrad|pausad|reativad|fechad|reabert|desfeit|cancelad|atualizad|alterad)[oa]s?\b|⏸|▶️|🔒|🔓|↩️/i;

function respostaDeReserva(acoes: AcaoDoAssessor[]): string {
  const feitas = acoes.filter((a) => FERRAMENTAS_QUE_GRAVAM.has(a.nome) && (a.resultado as any)?.ok);
  if (!feitas.length) return "Não consegui fazer isso agora — nada foi alterado no sistema. Pode mandar de novo? Ex.: *comprei 10 Coca lata, paguei 45*.";
  const linhas = feitas.map((a) => {
    const r = a.resultado as any;
    if (a.nome === "registrar_compra") return `📦 ${(r.estoque || []).join("; ")}\n💰 ${r.financeiro}`;
    if (a.nome === "registrar_saida") return `📦 ${r.item}: saiu ${r.saiu} (agora ${r.agora})`;
    if (a.nome === "desfazer_ultimo_registro") return `↩️ Desfeito: ${r.desfeito}`;
    if (a.nome === "pausar_ou_reativar_itens") return r.pausados ? `⏸️ Pausado: ${r.pausados.join(", ")}` : `▶️ Reativado: ${(r.reativados || []).join(", ")}`;
    if (a.nome === "abrir_ou_fechar_site") return `🏪 Site ${String(r.site || "").toLowerCase()}`;
    return `💰 ${r.lancado}`;
  });
  return `✅ *Lançado*\n${linhas.join("\n")}\nErrou? Manda *desfaz*.`;
}

export async function conversarComOAssessor(
  ctx: ContextoDoAssessor,
  entrada: { texto?: string | null; audio?: MidiaDoDono | null; imagem?: MidiaDoDono | null },
): Promise<RespostaDoAssessor> {
  const deOnde = ctx.canal === "PAINEL" ? `painel${ctx.autor ? `, ${ctx.autor}` : ""}` : "WhatsApp";
  const acoes: AcaoDoAssessor[] = [];
  const key = apiKey();
  if (!key) return { resposta: "O assessor está fora do ar agora. Tente de novo em alguns minutos.", ouvi: null, acoes, gravou: false };
  const ai = new GoogleGenAI({ apiKey: key });

  const texto = String(entrada.texto || "").trim();
  const partes: Part[] = [];
  if (entrada.audio?.base64) partes.push({ inlineData: { data: entrada.audio.base64, mimeType: entrada.audio.mimeType || "audio/ogg" } });
  if (entrada.imagem?.base64) partes.push({ inlineData: { data: entrada.imagem.base64, mimeType: entrada.imagem.mimeType || "image/jpeg" } });
  partes.push({ text: `[${deOnde}] ${texto || (entrada.audio ? "(áudio do dono)" : entrada.imagem ? "(foto do dono, sem legenda)" : "")}` });

  const anteriores = await historicoParaOModelo(ctx.franchiseeId);
  const conversa: Content[] = [
    ...anteriores.map((f) => ({ role: f.role, parts: [{ text: f.texto }] })),
    { role: "user", parts: partes },
  ];

  if (entrada.imagem?.base64) ctx = { ...ctx, comFoto: true };
  const sistema = await montarSistema(ctx);
  let resposta = "";
  let modeloUsado = MODELOS_DO_ASSESSOR[0];
  const uso = { entrada: 0, saida: 0, pensamento: 0, cache: 0 };

  /** Uma rodada: o modelo chama ferramentas até escrever a resposta. */
  async function rodar(modelo: string): Promise<string> {
    for (let volta = 0; volta < 6; volta++) {
      const r = await ai.models.generateContent({
        model: modelo,
        contents: conversa,
        config: {
          systemInstruction: sistema,
          temperature: 0.2,
          tools: [{ functionDeclarations: DECLARACOES_DO_ASSESSOR as any }],
          ...(modelo.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        },
      });
      const u = r.usageMetadata;
      uso.entrada += u?.promptTokenCount || 0;
      uso.saida += u?.candidatesTokenCount || 0;
      uso.pensamento += u?.thoughtsTokenCount || 0;
      uso.cache += u?.cachedContentTokenCount || 0;

      const chamadas = r.functionCalls || [];
      if (chamadas.length === 0) return r.text || "";
      const doModelo = r.candidates?.[0]?.content;
      if (doModelo) conversa.push(doModelo);
      const respostas: Part[] = [];
      for (const chamada of chamadas) {
        const resultado = await executarFerramentaDoAssessor(chamada.name || "", chamada.args || {}, ctx);
        acoes.push({ nome: chamada.name || "", resultado });
        respostas.push({ functionResponse: { id: chamada.id, name: chamada.name, response: resultado } });
      }
      conversa.push({ role: "user", parts: respostas });
    }
    return "";
  }

  for (const modelo of MODELOS_DO_ASSESSOR) {
    modeloUsado = modelo;
    try {
      resposta = await rodar(modelo);
      // ── AFIRMOU SEM FAZER ─────────────────────────────────────────────────
      // Teste de 14/10/2026: "tô sem motoboy, fecha a loja" → "🔒 Loja/Site
      // fechado!" sem chamar ferramenta nenhuma; o site continuou aberto. Sem
      // nenhuma ferramenta na rodada e com cara de ação feita, o modelo ouve
      // que nada mudou e tem mais uma chance de fazer de verdade.
      if (acoes.length === 0 && (AFIRMA_ACAO.test(resposta) || DIZ_QUE_GRAVOU.test(resposta))) {
        conversa.push({ role: "model", parts: [{ text: resposta }] });
        conversa.push({
          role: "user",
          parts: [{ text: "[SISTEMA] Você respondeu como se tivesse feito uma ação, mas NENHUMA ferramenta foi chamada: nada mudou no sistema. Se o dono pediu uma ação, chame a ferramenta agora. Se não pediu, responda de novo sem afirmar que fez." }],
        });
        resposta = await rodar(modelo);
      }
      break;
    } catch (err: any) {
      console.error(`[Assessor] ${modelo} falhou:`, err?.message || err);
      // Já gravou algo com este modelo: não repete no outro (lançaria duas vezes).
      if (acoes.some((a) => FERRAMENTAS_QUE_GRAVAM.has(a.nome))) break;
    }
  }

  if (uso.entrada + uso.saida > 0) {
    trackGeminiUsage(ctx.franchiseeId, modeloUsado, uso.entrada, uso.saida, { origem: "assessor_bill", canal: ctx.canal }, { thoughtsTokens: uso.pensamento, cachedTokens: uso.cache });
  }

  let ouvi: string | null = null;
  const m = resposta.match(/\[\[OUVI:\s*([\s\S]*?)\]\]/i);
  if (m) {
    ouvi = m[1].trim();
    resposta = resposta.replace(/\[\[OUVI:[\s\S]*?\]\]/gi, "").trim();
  }

  const gravou = acoes.some((a) => FERRAMENTAS_QUE_GRAVAM.has(a.nome) && (a.resultado as any)?.ok);
  if (!resposta.trim() || (!gravou && DIZ_QUE_GRAVOU.test(resposta) && !/\?\s*$/.test(resposta.trim()))) {
    resposta = respostaDeReserva(acoes);
  }
  // As marcas que o histórico leva ("[ferramentas desta resposta: …]",
  // "[WhatsApp]") são do sistema; o modelo às vezes as repete.
  resposta = resposta
    .replace(/^\s*\[ferramentas desta resposta:[^\]]*\]\s*/gim, "")
    .replace(/^\s*\[(WhatsApp|painel[^\]]*)\]\s*/i, "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .trim();
  if (!resposta) resposta = respostaDeReserva(acoes);

  // O histórico leva o que a ferramenta fez de verdade. Só com o texto ("⏸️
  // Pausado!"), o modelo aprendia que bastava escrever — e parava de chamar.
  const feitas = acoes.map((a) => `${a.nome}:${(a.resultado as any)?.ok ? "ok" : "erro"}`).join(", ");
  const autor = ctx.canal === "PAINEL" ? ctx.autor || null : ctx.telefone || null;
  const falaDoDono = entrada.audio ? `🎤 ${ouvi || "Áudio"}` : entrada.imagem ? `📷 Foto${texto ? `: ${texto}` : ""}` : texto;
  await gravarFala({ franchiseeId: ctx.franchiseeId, papel: "DONO", texto: falaDoDono, canal: ctx.canal, autor });
  await gravarFala({ franchiseeId: ctx.franchiseeId, papel: "BILL", texto: resposta, canal: ctx.canal, autor, ferramentas: feitas || null });

  return { resposta, ouvi, acoes, gravou };
}
