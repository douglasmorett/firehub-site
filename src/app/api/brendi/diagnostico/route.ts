import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerBrendi } from "@/lib/webhook-brendi-log";

export const dynamic = "force-dynamic";

/**
 * GET /api/brendi/diagnostico
 *
 * Responde a única pergunta que importa quando um pedido da Brendi não aparece
 * na cozinha: em qual ponta ele parou.
 *
 *   1. A credencial autentica?      → o oauth/token da Brendi responde, não o
 *                                     nosso banco.
 *   2. O merchantId está amarrado?  → sem ele, pedido baixado não acha a loja.
 *   3. Chegou evento?               → o registro em memória do webhook diz; o
 *                                     polling deixa rastro pelos pedidos.
 *   4. O evento virou pedido aqui?  → a contagem no banco diz.
 *
 * Por que isto existe: no 99Food a tela dizia "🟢 Conectado & Ativo" porque
 * alguém havia preenchido um formulário — nada tinha falado com o parceiro uma
 * única vez, e "conectado" e "recebendo pedido" eram indistinguíveis. Este
 * diagnóstico nasce JUNTO com a integração da Brendi para essa confusão nunca
 * existir aqui.
 *
 * Segurança: credenciais aparecem SÓ por prefixo (8 caracteres); o client
 * secret jamais sai do servidor — nem inteiro, nem por prefixo.
 */

// Sem sufixo /openDelivery: os endpoints da Brendi confirmados vivem na raiz.
const BRENDI_BASE = process.env.BRENDI_BASE_URL || "https://api.brendi.com.br";

/** O que a linha da loja tem de Brendi. SQL cru porque as colunas brendi* são
 *  garantidas no boot e ainda não estão no schema.prisma — o Prisma Client não
 *  as conhece, e um select tipado nelas quebraria o build. */
interface LinhaBrendi {
  brendiClientId: string | null;
  brendiClientSecret: string | null;
  brendiMerchantId: string | null;
  brendiConnected: boolean | null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, email: true, storeName: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Os campos de Brendi que valem são os da LOJA, não os do usuário logado: um
  // funcionário carrega os dele, sempre vazios, e o diagnóstico apontaria falta
  // de credencial numa loja conectada. Mesma armadilha já paga no 99Food.
  const lojaId = user.ownerId || user.id;

  let nomeLoja = user.storeName;
  if (lojaId !== user.id) {
    const dona = await prisma.user
      .findUnique({ where: { id: lojaId }, select: { storeName: true } })
      .catch(() => null);
    if (dona?.storeName) nomeLoja = dona.storeName;
  }

  // ── 0. As colunas existem? ────────────────────────────────────────────────
  // Elas nascem por ensureBrendiColumns() no boot, não por migração do Prisma.
  // Se a consulta falhar, o problema é anterior a qualquer credencial — e
  // dizer isso poupa horas caçando defeito em oauth que nunca rodou.
  let linha: LinhaBrendi | null = null;
  try {
    const r = await prisma.$queryRaw<LinhaBrendi[]>`
      SELECT "brendiClientId", "brendiClientSecret", "brendiMerchantId", "brendiConnected"
      FROM "User" WHERE "id" = ${lojaId} LIMIT 1
    `;
    linha = Array.isArray(r) && r.length > 0 ? r[0] : null;
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      parou_em: "servidor",
      diagnostico:
        "As colunas brendi* não existem no banco (ensureBrendiColumns não rodou no boot). " +
        "Sem elas não há credencial, não há loja conectada e nada da Brendi funciona. " +
        `Erro cru: ${e?.message?.slice(0, 200)}`,
    });
  }

  const temClientId = !!linha?.brendiClientId;
  const temSecret = !!linha?.brendiClientSecret;
  const merchantIdSalvo = linha?.brendiMerchantId || null;

  // Prefixo só: confirma que TEM credencial sem imprimir a credencial. O
  // secret nem por prefixo — ele é exibido uma única vez pela Brendi e vazar
  // qualquer pedaço aqui viraria o único registro dele fora do banco.
  const clientIdPrefixo = linha?.brendiClientId ? `${linha.brendiClientId.slice(0, 8)}…` : null;

  const eventos = lerBrendi();
  const pedidosBrendi = await prisma.customerOrder.count({
    where: { franchiseeId: lojaId, source: "BRENDI" },
  });

  // ── 1. A credencial autentica? Teste REAL, nunca booleano de formulário ───
  // `brendiConnected` no banco é o que a tela mostra; o oauth/token abaixo é a
  // verdade. Divergência entre os dois é, por si só, um diagnóstico.
  let oauth: {
    testado: boolean;
    status: number | null;
    autenticou: boolean;
    tokenPrefixo: string | null;
    expiresIn: number | null;
    respostaCrua: string | null;
  } = { testado: false, status: null, autenticou: false, tokenPrefixo: null, expiresIn: null, respostaCrua: null };

  if (temClientId && temSecret) {
    // Chamada direta, fora do cache do brendi-api de propósito: diagnóstico
    // quer a resposta CRUA de agora, não um token guardado de dez minutos
    // atrás que esconderia uma credencial já revogada.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${BRENDI_BASE}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: linha!.brendiClientId!,
          client_secret: linha!.brendiClientSecret!,
        }),
        signal: controller.signal,
      });
      const texto = await res.text();
      let token: string | null = null;
      let expiresIn: number | null = null;
      try {
        const j = JSON.parse(texto);
        token = j.access_token ?? j.accessToken ?? null;
        expiresIn = j.expires_in ?? j.expiresIn ?? null;
      } catch { /* resposta não-JSON: fica no cru */ }
      oauth = {
        testado: true,
        status: res.status,
        autenticou: res.ok && !!token,
        tokenPrefixo: token ? `${token.slice(0, 8)}…` : null,
        expiresIn,
        // O corpo cru (recortado) é o que diz SE é credencial errada, loja
        // suspensa ou API fora — três consertos diferentes. Token, se veio,
        // já foi reduzido a prefixo; o cru só sai quando NÃO autenticou.
        respostaCrua: res.ok && token ? null : texto.slice(0, 400),
      };
    } catch (e: any) {
      oauth = {
        testado: true,
        status: null,
        autenticou: false,
        tokenPrefixo: null,
        expiresIn: null,
        respostaCrua: `sem resposta: ${e?.name === "AbortError" ? "timeout de 15s" : e?.message?.slice(0, 200)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Em qual ponta parou ───────────────────────────────────────────────────
  // A ordem importa: sem credencial não adianta olhar webhook, e sem
  // merchantId não adianta olhar parser — cada degrau só faz sentido com o
  // anterior de pé.
  let parou_em: string;
  let diagnostico: string;

  if (!temClientId || !temSecret) {
    parou_em = "credencial";
    diagnostico =
      "A loja não tem Client ID e/ou Client Secret da Brendi salvos. O lojista gera os dois em " +
      "app.brendi.com.br → Integrações → API Pública e cola no card Brendi em /store/integracoes. " +
      "Atenção: o secret é exibido UMA vez pela Brendi — colar na hora.";
  } else if (!oauth.autenticou) {
    parou_em = "token";
    diagnostico =
      "Há credencial salva, mas o oauth/token REAL da Brendi recusou agora. Enquanto isso não " +
      "autenticar, nenhum polling nem chamada de status funciona. Veja 'oauth.respostaCrua' — é a " +
      "resposta deles, não a nossa. Credencial revogada ou recolada errada é o caso mais comum.";
  } else if (!merchantIdSalvo) {
    parou_em = "amarracao";
    diagnostico =
      "A credencial autentica, mas não há brendiMerchantId salvo. É por ele (orderData.merchant.id) " +
      "que um pedido baixado encontra a loja — sem ele TODO evento é recusado de propósito, para o " +
      "pedido nunca cair na cozinha errada. Salvar o Merchant ID no card Brendi resolve.";
  } else if (pedidosBrendi === 0 && eventos.some((e) => e.motivo?.startsWith("RECUSADO") || e.motivo?.startsWith("ERRO"))) {
    // Recusa por amarração e parser que não entendeu chegam aqui do mesmo
    // jeito — nenhum pedido no banco — mas o conserto é em lugares opostos:
    // um é um campo no banco, o outro é código.
    parou_em = "amarracao";
    diagnostico =
      "Evento CHEGOU e foi recusado ou falhou ao processar: não deu para amarrar o pedido a esta loja. " +
      "Veja o 'motivo' em 'ultimosEventos' — ele traz o merchant.id que veio no pedido. O conserto " +
      "costuma ser conferir o Merchant ID salvo, não mexer no parser.";
  } else if (pedidosBrendi === 0 && eventos.length > 0) {
    parou_em = "parser";
    diagnostico =
      "A Brendi chamou o webhook, mas nenhum pedido foi criado. O payload cru está em " +
      "'ultimosEventos' — é com ele que o parser se ajusta ao formato real deles.";
  } else if (pedidosBrendi === 0) {
    parou_em = "eventos";
    diagnostico =
      "Credencial autentica e merchantId está amarrado, mas nenhum evento registrado e nenhum pedido " +
      "no banco. Ou nenhum pedido de teste foi feito ainda, ou as duas vias estão mudas: o webhook " +
      "(conferir o webhookUrl no painel da Brendi — URL abaixo) e o polling (conferir o job " +
      "brendi-poll no cron-runner). Faça um pedido de teste e recarregue este diagnóstico.";
  } else {
    parou_em = "nada";
    diagnostico = `Integração de ponta a ponta: ${pedidosBrendi} pedido(s) da Brendi no banco.`;
  }

  return NextResponse.json({
    ok: true,
    parou_em,
    diagnostico,
    loja: {
      nome: nomeLoja,
      email: user.email,
      lojaId,
      clientIdPrefixo,
      temSecret,
      merchantIdSalvo,
      // Vale contrastar com o teste real acima: este booleano é o que a TELA
      // mostra, e no 99Food foi ele que exibiu "conectado" sem nunca ter
      // falado com o parceiro.
      brendiConnectedNoBanco: !!linha?.brendiConnected,
    },
    oauth: {
      url: `${BRENDI_BASE}/oauth/token`,
      ...oauth,
    },
    webhook: {
      urlQueDeveEstarNoPortal: "https://firehubfood.com.br/api/brendi/webhook",
      eventosRecebidos: eventos.length,
      // Some no restart do container — um deploy recente zera esta lista, e
      // lista vazia logo após deploy não prova que a Brendi não chamou.
      observacao:
        "Registro em memória: reinicia junto com o container. O polling não passa por aqui — " +
        "pedido no banco sem evento nesta lista é o polling funcionando, não um defeito.",
      ultimosEventos: eventos,
    },
    pedidosBrendiNoBanco: pedidosBrendi,
  });
}
