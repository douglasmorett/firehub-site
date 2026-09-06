/**
 * Manter a loja ONLINE no 99Food, sem ninguém abrir o gestor deles.
 *
 * ── O problema ──────────────────────────────────────────────────────────────
 *
 * O lojista fechava o app do 99Food no PC e a loja dele caía. Enquanto ninguém
 * abrisse o app de novo, a loja não voltava — e o sintoma era indistinguível de
 * integração quebrada: "só entra pedido se eu deixar o 99 aberto". Nunca foi o
 * app aberto que trazia pedido (isso é o webhook, servidor a servidor). Era o
 * app aberto que segurava a loja no ar.
 *
 * O swagger deles é explícito: uma vez offline, a loja "will never be online
 * until the biz_status set to online with this api or be online from didi's app
 * manually". A API existia o tempo todo; ninguém a chamava.
 *
 * ── Ler antes de escrever, e o porquê ───────────────────────────────────────
 *
 * A primeira versão disto escrevia biz_status=1 e auto_switch=3 às cegas, toda
 * rodada. Dois estragos, os dois silenciosos:
 *
 *   1. `auto_switch` é ajuste guardado da loja, que o lojista escolhe no painel
 *      do 99Food. Reescrevê-lo para 3 apagava a escolha dele.
 *   2. Pausa é decisão. Cozinha estourou e o lojista pausa a loja no app deles?
 *      Em minutos o FireHub religava, e ele voltava a receber pedido que não
 *      consegue produzir — que é exatamente o que vira cancelamento e punição.
 *
 * Então agora toda rodada LÊ o estado (`shop/detail`, sem cache) e só escreve
 * quando encontra a loja no estado que a gente veio consertar. Leitura é barata;
 * escrita cega é cara.
 *
 * ── O que este módulo NÃO faz, e é o ponto ──────────────────────────────────
 *
 * Ele NÃO usa o horário do FireHub. `storeOpen` / `storeHours` / `storePause`
 * governam o NOSSO cardápio digital e mais nada. O 99Food tem agenda própria,
 * feita no painel deles, e as duas não têm relação — amarrar uma na outra
 * fecharia a loja no horário errado.
 *
 * E, na direção contrária: pedido que tocou no 99Food TEM que entrar aqui,
 * esteja o cardápio digital aberto ou fechado. O webhook já é assim — não há
 * nenhuma checagem de abertura em /api/99food/webhook, e não deve haver.
 *
 * ── O efeito colateral que também era um bug ────────────────────────────────
 *
 * `tokensDaConta()` passa por `tokenDaLoja()`, que renova o auth_token quando
 * falta menos de 24h para vencer. Essa renovação só acontecia NO USO — só quando
 * chegava pedido ou mudança de status. Loja parada mais de um dia perto do
 * vencimento perdia o token, e daí em diante o webhook descartava todo pedido
 * novo (sem token, `continue`, e ACK mesmo assim, então o 99Food nem reenvia).
 */
import { prisma } from "@/lib/prisma";
import { setShopStatus, setConfirmMethod, estadoOperacionalDaLoja } from "@/lib/food99-api";
import { tokensDaConta } from "@/lib/food99-status";
import { lojas99DaConta } from "@/lib/food99-lojas";
import { avisarDono } from "@/lib/alertas-do-dono";
import { sendEmail } from "@/lib/mail";
import { religarVinculosDaConta } from "@/lib/food99-vinculo";

/**
 * Quando cada loja foi avisada de que caiu, para avisar UMA vez por dia.
 *
 * ── Por que este alerta existe ──────────────────────────────────────────────
 *
 * A Brasa Burguer perdeu o vínculo com o 99Food em 04/09/2026 01:08 e ficou
 * dois dias sem pedido de lá. O cron gritava no log a cada 5 minutos ("sem
 * auth_token") — e log ninguém lê. Para o lojista o sintoma era "dia fraco";
 * para a operação do FireHub, nada. O aviso vai para os dois: o dono pelo
 * WhatsApp que já recebe os outros alertas, e a operação por e-mail, porque é
 * ela que sabe religar.
 *
 * Em memória de propósito (mesmo motivo de `ultimaEscrita`): o custo de perder
 * isto num deploy é um aviso a mais, e coluna nova exige DDL no boot.
 */
const ultimoAvisoDeQueda = new Map<string, number>();
const REAVISAR_APOS_MS = 24 * 60 * 60_000;

async function avisarQueCaiu99(lojaId: string, nome: string, emailDaLoja: string | null) {
  const ultimo = ultimoAvisoDeQueda.get(lojaId) ?? 0;
  if (Date.now() - ultimo < REAVISAR_APOS_MS) return;
  ultimoAvisoDeQueda.set(lojaId, Date.now());

  const texto =
    `⚠️ *Sua loja perdeu a conexão com o 99Food*\n\n` +
    `Os pedidos do 99Food *pararam de entrar* no FireHub para *${nome}*.\n\n` +
    `Para voltar: painel → Integrações → 99Food → *Conectar com o 99Food* e autorize de novo. ` +
    `Se já autorizou e continua assim, fale com o suporte do FireHub.`;

  await avisarDono(lojaId, "99food_desconectado", texto).catch(() => false);

  const operacao = (process.env.ALERTA_EMAIL_OPERACAO || "contatohakim@gmail.com").trim();
  const html =
    `<p><strong>${nome}</strong> perdeu a conexão com o 99Food — o app não devolve token para nenhum ` +
    `app_shop_id da conta, e todo pedido novo de lá está sendo descartado.</p>` +
    `<p>Conta: ${emailDaLoja || lojaId}<br/>Loja (id): ${lojaId}</p>` +
    `<p>Diagnóstico: <a href="https://firehubfood.com.br/api/99food/diagnostico">/api/99food/diagnostico</a> ` +
    `(logado como a loja).</p>` +
    `<p>Este aviso repete no máximo uma vez por dia enquanto a loja seguir sem token.</p>`;
  await sendEmail({ to: operacao, subject: `[FireHub] ${nome} caiu do 99Food`, html }).catch(() => null);

  console.error(`[99Food online] ${nome}: dono e operação avisados da queda`);
}

/**
 * Última vez que cada token RECEBEU uma escrita, para não repetir à toa.
 *
 * Vive em memória de propósito: o custo de perdê-lo num deploy é uma escrita a
 * mais por loja caída, e o ganho é não precisar de coluna nova (este repositório
 * não roda migration — coluna nova exige DDL no boot).
 *
 * Chaveado por token, e o token muda quando renova. A chave órfã que sobra é uma
 * string por loja a cada semanas, e é varrida na própria rodada.
 */
const ultimaEscrita = new Map<string, number>();
const VALIDADE_CHAVE_MS = 12 * 60 * 60_000;

/** Piso entre duas ESCRITAS no mesmo token. A leitura acontece toda rodada. */
const REESCREVER_APOS_MS = 10 * 60_000;

/**
 * Último `order_confirm_method` mandado para cada token, e quando.
 *
 * Reafirmar é necessário, e não zelo: o swagger deles diz que "if the store is
 * unbound, we will change the ordering method to BAPP by default" — o valor
 * volta sozinho ao padrão quando o vínculo cai e é refeito.
 *
 * Guardar QUAL valor foi mandado (e não só quando) é o que faz a volta para
 * BAPP ser imediata quando o lojista desliga o aceite automático: a mudança de
 * valor ignora o intervalo.
 */
const ultimaConfirmacao = new Map<string, { metodo: "BAPP" | "OPENAPI"; em: number }>();
const REAFIRMAR_CONFIRMACAO_MS = 6 * 60 * 60_000;

/**
 * Estados em que o FireHub NÃO mexe, porque são decisão de alguém.
 *
 *   2 pausada pelo lojista · 3 fechada · 5 fechada no dia ·
 *   6 bloqueada · 7 fechada pelo sistema (sem entregador)
 *
 * O estado que a gente conserta é o 4 (desconectada) — e o biz_status=2, do qual
 * a loja não sai sozinha. O resto se respeita.
 */
const NAO_MEXER = new Set([2, 3, 5, 6, 7]);

export type AcaoAbertura99 = "ja-online" | "religada" | "respeitado" | "sem-escrita" | "erro";

/**
 * Em que modo de confirmação esta loja ficou.
 *
 * `openapi` = o app do 99Food não precisa ficar online.
 * `bapp`    = precisa, e é o certo enquanto o aceite automático estiver desligado.
 */
export type ModoConfirmacao99 = "openapi" | "bapp" | "nao-avaliado" | "falhou";

export type ResultadoAbertura99 = {
  lojaId: string;
  loja: string;
  acao: AcaoAbertura99;
  bizStatus: number | null;
  subBizStatus: number | null;
  confirmacao: ModoConfirmacao99;
  detalhe?: string;
  erros: string[];
};

/**
 * Garante UMA loja online no 99Food, sem atropelar decisão de ninguém.
 *
 * `forcar` ignora o piso entre escritas. Hoje nenhum chamador passa isso — o
 * cron é o único uso. Fica para um botão de "reativar agora" na tela de
 * Integrações, que ainda não existe.
 */
export async function manterLojaOnline99(
  lojaId: string,
  opts: { forcar?: boolean } = {}
): Promise<ResultadoAbertura99 | null> {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: {
      id: true,
      storeName: true,
      email: true,
      food99Connected: true,
      autoAcceptOrders: true,
    },
  });
  if (!loja) return null;

  const nome = loja.storeName || loja.email || loja.id;

  // Uma conta pode ter loja ligada SÓ na tabela Food99Store, com a coluna antiga
  // do User em false — e o webhook aceita pedido dela. Sair aqui por
  // `food99Connected` deixaria justamente essa loja caindo sem ninguém
  // reafirmar. Só sai quem não tem nenhum dos dois.
  if (!loja.food99Connected) {
    const daTabela = await lojas99DaConta(loja.id).catch(() => []);
    if (daTabela.length === 0) return null;
  }

  const resultado: ResultadoAbertura99 = {
    lojaId: loja.id,
    loja: nome,
    acao: "erro",
    bizStatus: null,
    subBizStatus: null,
    confirmacao: "nao-avaliado",
    erros: [],
  };

  // ── Quem pode confirmar o pedido, e por que isso segue o aceite automático ─
  //
  // Em BAPP (o padrão do 99Food) o app deles PRECISA ficar online para confirmar
  // pedido — é a causa raiz de "só entra pedido se eu deixar o 99 aberto". Em
  // OPENAPI o app não precisa, mas **só o FireHub confirma**.
  //
  // Então OPENAPI só é seguro onde o FireHub confirma sozinho, e é exatamente
  // isso que o aceite automático da loja decide:
  //
  //   ligado   → o webhook grava o pedido como ACEITO e chama o `confirm` do
  //              99Food na hora (99food/webhook/route.ts). Ninguém precisa
  //              clicar em nada → OPENAPI.
  //   desligado→ o pedido nasce NOVO e fica tocando no painel esperando o
  //              lojista. Se estivesse em OPENAPI e ele demorasse, o 99Food
  //              cancelaria por falta de confirmação → BAPP, que deixa o app
  //              deles confirmar como sempre fez.
  //
  // A volta para BAPP importa tanto quanto a ida: se o lojista desliga o aceite
  // automático, deixar a loja em OPENAPI transformaria cada pedido demorado em
  // cancelamento. Por isso o modo é reafirmado, e a mudança de valor não espera
  // o intervalo.
  //
  // ── E por que não basta o aceite automático ───────────────────────────────
  //
  // Duas condições a mais, e nenhuma é excesso de zelo:
  //
  //  1. A CONTA precisa já ter recebido pedido do 99Food. Aceite automático
  //     ligado prova que o FireHub confirma o que CHEGA; não prova que chega. Se
  //     o Callback address não estiver configurado no portal deles, em OPENAPI
  //     ninguém confirma e o 99Food cancela — enquanto em BAPP o lojista ainda
  //     salva o pedido pelo app. É a regra "só depois de pedido entrar sozinho".
  //
  //  2. A conta precisa ter UMA loja no 99Food. A prova acima é por conta
  //     (`CustomerOrder.franchiseeId`), mas a escrita é por TOKEN — e
  //     `tokensDaConta` devolve um token por loja (food99-status.ts). Numa conta
  //     com duas lojas, o pedido da loja A liberaria OPENAPI também para a loja
  //     B, que talvez nunca tenha recebido nada. Prova por loja é hoje
  //     impossível a partir do pedido: o próprio código registra que
  //     `CustomerOrder` não guarda de qual loja do 99Food o pedido veio
  //     (food99-status.ts, comentário de `tokensDaConta`). Então conta
  //     multi-loja fica em BAPP até existir esse vínculo.
  let tokens: string[] = [];
  try {
    tokens = await tokensDaConta(loja.id);
  } catch (e: any) {
    resultado.erros.push(`falha ao obter token: ${e?.message}`);
    return resultado;
  }

  if (tokens.length === 0) {
    // Antes de gritar, tenta religar: a loja pode seguir AUTORIZADA no 99Food
    // com o vínculo caído (bound_flag 0) — foi a Brasa Burguer em 04/09. O
    // religamento usa o shopId gravado e o MESMO app_shop_id de antes; dando
    // certo, os tokens voltam nesta mesma rodada e ninguém precisa clicar.
    const religado = await religarVinculosDaConta(loja.id).catch(() => ({ religadas: [] as string[] }));
    if (religado.religadas.length > 0) {
      console.log(`[99Food online] ${nome}: vínculo religado sozinho (${religado.religadas.join(", ")})`);
      tokens = await tokensDaConta(loja.id).catch(() => []);
    }
  }

  if (tokens.length === 0) {
    // Sem token não dá para falar com o 99Food — e é exatamente o estado que faz
    // o webhook descartar pedido novo em silêncio. Vale gritar: é acionável.
    resultado.erros.push("sem auth_token utilizável — a loja precisa reconectar em Integrações → 99Food");
    console.error(`[99Food online] ${nome}: sem auth_token — pedido novo será descartado até reconectar`);
    await avisarQueCaiu99(loja.id, nome, loja.email);
    return resultado;
  }

  // Agora que os tokens existem, dá para decidir o modo (ver o bloco acima):
  // `tokens.length` é o número de lojas do 99Food desta conta.
  const recebeuPedido99 = await prisma.customerOrder
    .findFirst({ where: { franchiseeId: loja.id, source: "99FOOD" }, select: { id: true } })
    .catch(() => null);

  const umaLojaSo = tokens.length === 1;
  const podeOpenapi = loja.autoAcceptOrders && recebeuPedido99 !== null && umaLojaSo;
  const modoDesejado: "BAPP" | "OPENAPI" = podeOpenapi ? "OPENAPI" : "BAPP";

  const agora = Date.now();
  for (const [k, v] of ultimaEscrita) {
    if (agora - v > VALIDADE_CHAVE_MS) ultimaEscrita.delete(k);
  }

  for (const token of tokens) {
    // Cada token falha sozinho: um timeout de rede não pode deixar a segunda
    // loja da mesma conta sem ser reafirmada.
    try {
      // Modo de confirmação: independe de a loja estar online ou não, então vem
      // antes e não é pulado por nenhum `continue` mais abaixo.
      const conf = ultimaConfirmacao.get(token);
      const mudouModo = conf === undefined || conf.metodo !== modoDesejado;
      const venceu = conf === undefined || agora - conf.em > REAFIRMAR_CONFIRMACAO_MS;

      if (opts.forcar || mudouModo || venceu) {
        const c = await setConfirmMethod(token, modoDesejado);
        if (c.ok) {
          ultimaConfirmacao.set(token, { metodo: modoDesejado, em: agora });
          resultado.confirmacao = modoDesejado === "OPENAPI" ? "openapi" : "bapp";
          if (mudouModo) {
            console.log(
              `[99Food online] ${nome}: order_confirm_method = ${modoDesejado}` +
                (modoDesejado === "OPENAPI"
                  ? " (aceite automático ligado — o app do 99Food não precisa mais ficar online)"
                  : " (aceite automático desligado — o app do 99Food volta a confirmar)")
            );
          }
        } else {
          resultado.confirmacao = "falhou";
          resultado.erros.push(`setconfirmmethod ${modoDesejado}: ${c.erro}`);
          console.error(`[99Food online] ${nome}: setconfirmmethod recusado — ${c.erro}`);
        }
      } else {
        resultado.confirmacao = modoDesejado === "OPENAPI" ? "openapi" : "bapp";
      }

      const estado = await estadoOperacionalDaLoja(token);
      if (!estado) {
        resultado.erros.push("shop/detail não respondeu — estado desconhecido, nada foi escrito");
        continue;
      }

      resultado.bizStatus = estado.bizStatus;
      resultado.subBizStatus = estado.subBizStatus;

      if (estado.subBizStatus !== null && NAO_MEXER.has(estado.subBizStatus)) {
        resultado.acao = "respeitado";
        resultado.detalhe = `sub_biz_status=${estado.subBizStatus} é decisão do lojista ou do 99Food — não mexemos`;
        continue;
      }

      // Já no ar. Este é o caminho normal, e custa uma leitura — nenhuma escrita.
      const precisaReligar = estado.bizStatus === 2 || estado.subBizStatus === 4;
      if (!precisaReligar) {
        resultado.acao = "ja-online";
        continue;
      }

      const ultima = ultimaEscrita.get(token);
      if (!opts.forcar && ultima !== undefined && agora - ultima < REESCREVER_APOS_MS) {
        resultado.acao = "sem-escrita";
        resultado.detalhe = "precisava religar, mas houve escrita há pouco — aguardando a próxima rodada";
        continue;
      }

      // Preserva o auto_switch que o lojista escolheu no painel do 99Food. Só usa
      // 3 ("abre e fecha sozinha") quando não há valor válido para manter:
      // sobrescrever a escolha dele às cegas seria mudar o funcionamento da loja
      // sem ninguém pedir.
      const autoValido = estado.autoSwitch === 1 || estado.autoSwitch === 2 || estado.autoSwitch === 3;
      const autoSwitch = (autoValido ? estado.autoSwitch : 3) as 1 | 2 | 3;

      const r = await setShopStatus(token, autoSwitch);
      if (r.ok) {
        ultimaEscrita.set(token, agora);
        resultado.acao = "religada";
        resultado.detalhe = `estava biz_status=${estado.bizStatus} sub=${estado.subBizStatus}; religada com auto_switch=${autoSwitch}`;
        console.log(`[99Food online] ${nome}: RELIGADA (estava sub_biz_status=${estado.subBizStatus})`);
      } else {
        resultado.erros.push(r.erro);
        console.error(`[99Food online] ${nome}: setStatus recusado — ${r.erro}`);
      }
    } catch (e: any) {
      resultado.erros.push(`rede: ${e?.message}`);
      console.error(`[99Food online] ${nome}: falha de rede — ${e?.message}`);
    }
  }

  return resultado;
}

/**
 * Todas as lojas ligadas ao 99Food, uma por uma.
 *
 * Sequencial de propósito: a API deles tem limite por app, e disparar tudo de
 * uma vez é o jeito mais rápido de tomar 429 e não reafirmar nenhuma.
 *
 * O prazo existe porque a rota tem maxDuration de 60s e o cron-runner corta em
 * 55s: sem ele, numa rodada lenta as últimas lojas da lista nunca seriam
 * alcançadas — e seriam sempre as mesmas.
 */
export async function manterTodasOnline99(
  opts: { prazoMs?: number } = {}
): Promise<{ lojas: ResultadoAbertura99[]; naoAlcancadas: number }> {
  const limite = Date.now() + (opts.prazoMs ?? 45_000);

  const doUser = await prisma.user.findMany({
    where: { food99Connected: true, role: "FRANCHISEE" },
    select: { id: true },
  });
  const ids = new Set(doUser.map((u) => u.id));

  // Lojas que existem só na tabela nova entram também: o webhook aceita pedido
  // delas, então elas precisam ser mantidas no ar como qualquer outra.
  try {
    const extras = await prisma.$queryRaw<{ userId: string }[]>`
      SELECT DISTINCT "userId" FROM "Food99Store" WHERE "active" = true
    `;
    for (const e of extras) ids.add(e.userId);
  } catch {
    // A tabela pode não existir ainda — o caminho antigo já cobre o que importa.
  }

  const lista = [...ids];
  const saida: ResultadoAbertura99[] = [];
  let naoAlcancadas = 0;

  for (let i = 0; i < lista.length; i++) {
    if (Date.now() > limite) {
      naoAlcancadas = lista.length - i;
      console.warn(`[99Food online] prazo da rodada estourou — ${naoAlcancadas} loja(s) ficam para a próxima`);
      break;
    }
    try {
      const r = await manterLojaOnline99(lista[i]);
      if (r) saida.push(r);
    } catch (e: any) {
      saida.push({
        lojaId: lista[i],
        loja: lista[i],
        acao: "erro",
        bizStatus: null,
        subBizStatus: null,
        confirmacao: "nao-avaliado",
        erros: [`erro inesperado: ${e?.message}`],
      });
    }
  }

  return { lojas: saida, naoAlcancadas };
}
