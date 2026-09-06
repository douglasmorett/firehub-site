import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  diagnosticoAuth,
  diagnosticoRefresh,
  appIdVisivel,
  food99Configurado,
  ERRO_SEM_AUTORIZACAO,
  listarLojasVinculadas,
  listarLojasAutorizadas,
  sondarListaVinculadas,
} from "@/lib/food99-api";
import { ler99Food } from "@/lib/webhook-99food-log";
import { lojas99DaConta } from "@/lib/food99-lojas";

export const dynamic = "force-dynamic";

/**
 * GET /api/99food/diagnostico
 *
 * Responde a única pergunta que importa quando um pedido do 99Food não aparece
 * na cozinha: em qual das três pontas ele parou.
 *
 *   1. A loja autorizou o app?      → o 99Food responde, não o nosso banco.
 *   2. O 99Food chamou o webhook?   → os eventos recebidos dizem.
 *   3. O pedido virou pedido aqui?  → a contagem no banco diz.
 *
 * Por que isto existe: no dia 24/08 o pedido #403001 entrou no portal do 99Food
 * (aceitação automática ligada) e não chegou ao FireHub. A tela dizia
 * "🟢 Conectado & Ativo" porque alguém havia preenchido um formulário — nada
 * neste sistema tinha falado com o 99Food uma única vez. Sem este diagnóstico,
 * "conectado" e "recebendo pedido" eram indistinguíveis.
 *
 * ── O ponto cego do app_shop_id ─────────────────────────────────────────────
 * O `app_shop_id` é o identificador que NÓS escolhemos para a loja ao gerar a
 * URL de autorização, e é com ele que se pergunta pelo token depois. Se a URL
 * que o lojista autorizou foi gerada com um valor e a consulta usa outro, o
 * 99Food responde 10101 ("não autorizada") — a mesma resposta de quem nunca
 * clicou. Por isso aqui todos os candidatos são testados, e não só o atual:
 * é o que separa "o lojista não autorizou" de "autorizou sob outro id".
 */

interface Candidato {
  rotulo: string;
  appShopId: string;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      ownerId: true,
      email: true,
      storeName: true,
      food99MerchantId: true,
      // É por este campo que o webhook acha a loja na 1ª tentativa. Vazio aqui
      // com vínculo existindo em 'lojasVinculadasAoApp' é exatamente o buraco
      // que faz o pedido chegar e ser recusado.
      food99AppId: true,
      food99Connected: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const lojaId = user.ownerId || user.id;

  // Os campos de 99Food que valem são os da LOJA, não os do usuário logado: um
  // funcionário carrega os dele, sempre vazios, e o diagnóstico apontaria falta
  // de vínculo numa loja vinculada. É a mesma armadilha que /conectar comenta
  // ao gravar `food99Connected` sempre em `lojaId`.
  const loja =
    lojaId === user.id
      ? user
      : (await prisma.user.findUnique({
          where: { id: lojaId },
          select: { storeName: true, food99MerchantId: true, food99AppId: true, food99Connected: true },
        })) || user;

  if (!food99Configurado()) {
    return NextResponse.json({
      ok: false,
      parou_em: "servidor",
      diagnostico:
        "FOOD99_APP_ID / FOOD99_APP_SECRET não estão no ambiente. Sem as credenciais do app " +
        "não há como consultar nem autorizar nada no 99Food.",
    });
  }

  // Os três valores que já serviram de app_shop_id em algum momento desta
  // integração. Testar todos é o que revela uma autorização amarrada ao id
  // errado — invisível quando se consulta só o atual.
  const candidatos: Candidato[] = [{ rotulo: "loja (usado hoje ao gerar a URL)", appShopId: lojaId }];
  if (user.id !== lojaId) {
    candidatos.push({ rotulo: "usuário logado (funcionário)", appShopId: user.id });
  }
  if (loja.food99MerchantId && loja.food99MerchantId !== lojaId) {
    candidatos.push({ rotulo: "merchantId do 99Food (formulário antigo)", appShopId: loja.food99MerchantId });
  }
  // O app_shop_id adotado na conexão é o candidato mais provável de todos — é o
  // id sob o qual o vínculo REALMENTE nasceu. Faltava na lista, então uma loja
  // conectada por adoção aparecia como "nunca autorizou".
  if (loja.food99AppId && loja.food99AppId !== lojaId && loja.food99AppId !== loja.food99MerchantId) {
    candidatos.push({ rotulo: "app_shop_id adotado na conexão", appShopId: loja.food99AppId });
  }

  // A `Food99Store` é onde mora quem conectou pelo caminho novo — e as colunas
  // do User ficam nulas nesse caso, então sem isto a loja que ESTÁ conectada
  // aparecia como "nunca autorizou". Vale também o `shopId`: quando o vínculo
  // não nasce com o nosso id, o candidato mais provável é o id da loja no lado
  // deles, que é o que aparece como `cid` na URL de autorização.
  for (const l of await lojas99DaConta(lojaId)) {
    if (!candidatos.some((c) => c.appShopId === l.appShopId)) {
      candidatos.push({ rotulo: `Food99Store: ${l.label || "loja da conta"}`, appShopId: l.appShopId });
    }
    if (l.shopId && !candidatos.some((c) => c.appShopId === l.shopId)) {
      candidatos.push({ rotulo: `shop_id no 99Food (${l.label || "loja da conta"})`, appShopId: l.shopId });
    }
  }

  // `?appShopId=…` testa um id à mão, sem deploy e sem terminal no servidor.
  // É o que responde "para ONDE foi este vínculo": o `cid` que aparece na URL
  // de autorização, ou o id de outra loja do FireHub quando a suspeita é que o
  // link foi gerado no painel errado. Não grava nada no banco; o único efeito
  // colateral é o refresh de token no 99Food, que é o conserto documentado.
  const aMao = String(req.nextUrl.searchParams.get("appShopId") || "").trim();
  if (aMao && !candidatos.some((c) => c.appShopId === aMao)) {
    candidatos.push({ rotulo: "informado na URL (?appShopId=)", appShopId: aMao });
  }

  // `?host=didi` testa o token no host antigo (openapi.didi-food.com); sem o
  // parâmetro vale o host em uso (o oficial, openapi.99food.com). É o que
  // separa "vínculo não existe" de "estamos perguntando no lugar errado".
  const host = String(req.nextUrl.searchParams.get("host") || "").trim() || null;

  const testes = [];
  for (const c of candidatos) {
    const r = await diagnosticoAuth(c.appShopId, host);

    // 10101 na leitura crua não encerra a pergunta: a doc manda criar o token
    // com refresh antes de concluir "não autorizada". Aqui o refresh é feito à
    // mão, e não via getAuthToken, para a resposta CRUA dele aparecer: em
    // 06/09 o refresh falhou para todo mundo, inclusive a Brasa Burguer, e o
    // boolean não dizia por quê. O errno diz.
    let refreshCru: { errno: number; errmsg: string } | null = null;
    let segundaLeitura: typeof r | null = null;
    if (r.errno === ERRO_SEM_AUTORIZACAO) {
      const rf = await diagnosticoRefresh(c.appShopId);
      refreshCru = { errno: rf.errno, errmsg: rf.errmsg };
      if (rf.errno === 0) segundaLeitura = await diagnosticoAuth(c.appShopId);
    }
    const aposRefresh =
      segundaLeitura && segundaLeitura.errno === 0 && segundaLeitura.data?.auth_token
        ? { autorizada: true as const, token: segundaLeitura.data }
        : refreshCru
        ? { autorizada: false as const }
        : null;
    const autorizada = (r.errno === 0 && !!r.data?.auth_token) || !!aposRefresh?.autorizada;
    const dados = aposRefresh?.autorizada ? aposRefresh.token : r.data;

    testes.push({
      ...c,
      errno: r.errno,
      errmsg: r.errmsg,
      autorizada,
      refreshTentado: aposRefresh !== null,
      refresh: refreshCru,
      autorizadaAposRefresh: aposRefresh?.autorizada ?? null,
      tokenPrefixo: dados?.auth_token ? `${dados.auth_token.slice(0, 8)}…` : null,
      expiraEm: dados?.token_expiration_time
        ? new Date(dados.token_expiration_time * 1000).toISOString()
        : null,
      leitura: autorizada
        ? aposRefresh?.autorizada
          ? "AUTORIZADA — o token não existia e foi criado agora com authtoken/refresh."
          : "AUTORIZADA sob este app_shop_id."
        : r.errno === ERRO_SEM_AUTORIZACAO
        ? "O 99Food não conhece autorização para este app_shop_id (e o refresh não criou token)."
        : `Erro ${r.errno} — não é falta de autorização, é outra coisa.`,
    });
  }

  const autorizada = testes.find((t) => t.autorizada) || null;

  // A lista de vínculos do app é a fonte da verdade sobre quem está conectado:
  // vazia significa que NENHUMA loja autorizou o FireHub, e aí não adianta
  // procurar defeito em webhook nem em parser. É também de onde sai o
  // app_shop_id real de cada loja, que é o que a página de autorização não
  // devolve.
  const vinculos = await listarLojasVinculadas();

  // A etapa 2 por API (doc oficial): quem AUTORIZOU o app, vinculado ou não.
  // É esta lista que separa "o lojista não autorizou" de "autorizou e ninguém
  // vinculou" — e 10006 aqui significa que o 99Food ainda não liberou o
  // endpoint para o app, o que é conversa com o suporte deles, não código.
  const autorizadasV3 = await listarLojasAutorizadas();

  // O mesmo shop/list nos dois hosts (o do swagger antigo e o da doc oficial),
  // só quando pedido (`?hosts=1`): cada chamada gasta a única permitida a cada
  // 20s, e três seguidas viram 10005 em todas — inclusive na lista de cima.
  const shopListPorHost =
    req.nextUrl.searchParams.get("hosts") === "1"
      ? {
          didiFood: await sondarListaVinculadas("didi-food"),
          food99: await sondarListaVinculadas("99food"),
        }
      : null;

  const eventos = ler99Food();
  const pedidos99 = await prisma.customerOrder.count({
    where: { franchiseeId: lojaId, source: "99FOOD" },
  });

  // A ordem importa: sem autorização o 99Food não tem por que mandar evento
  // nenhum, então "webhook mudo" só vira suspeita do portal depois que a
  // autorização estiver de pé.
  let parou_em: string;
  let diagnostico: string;

  if (!autorizada) {
    parou_em = "autorizacao";
    // Não autorizada com o app TENDO vínculos é um problema diferente de não
    // autorizada com o app vazio, e mandar "autorize de novo" no primeiro caso
    // é o conselho errado: o lojista já autorizou, o vínculo é que nasceu com
    // outro app_shop_id (link gerado no painel de outra loja, por exemplo).
    const temVinculos = vinculos.ok && vinculos.lojas.length > 0;
    diagnostico = temVinculos
      ? `Nenhum app_shop_id testado tem autorização, MAS o app tem ${vinculos.ok ? vinculos.lojas.length : 0} ` +
        "vínculo(s) no 99Food. Ou seja: alguém autorizou, e o vínculo não ficou com o id desta loja. " +
        "Veja 'lojasVinculadasAoApp' e teste o app_shop_id de lá com ?appShopId=… nesta mesma URL."
      : "Nenhum app_shop_id testado tem autorização no 99Food. Enquanto isso não mudar, " +
        "nenhum pedido será entregue aqui — o lojista precisa abrir a URL de autorização " +
        "e concluir com a conta 99Food da loja.";
  } else if (eventos.length === 0) {
    parou_em = "webhook";
    diagnostico =
      `A loja ESTÁ autorizada (app_shop_id "${autorizada.appShopId}"), mas o 99Food nunca chamou ` +
      "o nosso webhook. Isso é configuração no portal de desenvolvedor deles: o Callback " +
      "address do app precisa apontar para a URL abaixo. Nada no nosso código conserta isso.";
  } else if (pedidos99 === 0 && eventos.some((e) => e.motivo?.startsWith("RECUSADO"))) {
    // Recusa por amarração e parser que não entendeu chegam aqui do mesmo
    // jeito — nenhum pedido no banco — mas o conserto é em lugares opostos:
    // um é um campo no banco, o outro é código. Separar os dois é o que evita
    // mexer no parser quando o parser está certo.
    parou_em = "amarracao";
    diagnostico =
      "O 99Food ENTREGOU o pedido e o nosso webhook o RECUSOU: não deu para dizer de qual loja ele é. " +
      "Veja o 'motivo' em 'ultimosEventos' — ele traz o shop_id e o app_shop_id que vieram no pedido. " +
      "O conserto é ligar esse app_shop_id à loja em Integrações → 99Food → 'Já autorizei', não mexer no parser.";
  } else if (pedidos99 === 0) {
    parou_em = "parser";
    diagnostico =
      "O 99Food chamou o webhook, mas nenhum pedido foi criado. O payload cru está em " +
      "'ultimosEventos' — é com ele que o parser se ajusta ao formato real deles.";
  } else {
    parou_em = "nada";
    diagnostico = `Integração de ponta a ponta: ${pedidos99} pedido(s) do 99Food no banco.`;
  }

  return NextResponse.json({
    ok: true,
    parou_em,
    diagnostico,
    loja: {
      nome: loja.storeName,
      email: user.email,
      lojaId,
      merchantIdSalvo: loja.food99MerchantId,
      appShopIdSalvo: loja.food99AppId,
      // Vale contrastar com a autorização real: este booleano é só o formulário
      // antigo tendo sido salvo, e foi ele que exibiu "conectado" o tempo todo.
      food99ConnectedNoBanco: loja.food99Connected,
    },
    appId: appIdVisivel(),
    autorizacao: { autorizada: !!autorizada, appShopIdValido: autorizada?.appShopId ?? null, testes },
    lojasAutorizadasV3: autorizadasV3.ok
      ? {
          ok: true,
          quantidade: autorizadasV3.lojas.length,
          semVinculo: autorizadasV3.lojas.filter((l) => !l.vinculada).length,
          lojas: autorizadasV3.lojas,
          cru: autorizadasV3.cru,
        }
      : { ok: false, errno: autorizadasV3.errno, erro: autorizadasV3.erro, cru: autorizadasV3.cru ?? null },
    shopListPorHost,
    lojasVinculadasAoApp: vinculos.ok
      ? {
          ok: true,
          quantidade: vinculos.lojas.length,
          variante: vinculos.variante,
          lojas: vinculos.lojas,
          // O payload CRU, sempre. Em 06/09/2026 esta consulta voltou
          // `ok: true` com zero lojas tendo duas vinculadas de verdade, e não
          // havia como saber se o formato mudou ou se a lista estava vazia
          // mesmo — as duas coisas viravam "0". Sem isto, descobrir exige
          // terminal no servidor de produção.
          cru: vinculos.cru ?? null,
        }
      : { ok: false, erro: vinculos.erro, tentativas: vinculos.tentativas },
    webhook: {
      urlQueDeveEstarNoPortal: "https://firehubfood.com.br/api/99food/webhook",
      eventosRecebidos: eventos.length,
      // Some no restart do container — um deploy recente zera esta lista, e
      // lista vazia logo após deploy não prova que o 99Food não chamou.
      observacao: "Registro em memória: reinicia junto com o container.",
      ultimosEventos: eventos,
    },
    pedidos99NoBanco: pedidos99,
  });
}
