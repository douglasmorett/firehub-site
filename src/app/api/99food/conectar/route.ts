import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAuthorizationUrl,
  getAuthToken,
  food99Configurado,
  listarLojasVinculadas,
} from "@/lib/food99-api";

export const dynamic = "force-dynamic";

/**
 * Conexão do lojista com o 99Food — autoatendimento, sem ninguém do FireHub no meio.
 *
 * GET  → diz se a loja já está conectada (consulta o 99Food, não o nosso banco)
 * POST → gera a URL onde o lojista autoriza com a conta DELE
 *
 * Por que isto substitui o formulário antigo:
 *
 * A tela de Integrações pedia Merchant ID, App ID e Secret Key ao lojista e,
 * ao salvar, marcava `food99Connected = true` e escrevia "conectado com
 * sucesso" — sem falar com o 99Food uma única vez. O lojista via "conectado" e
 * nunca recebia pedido. Pior: App ID e Secret são credenciais do FIREHUB, não
 * dele; nenhum lojista teria de onde tirá-las.
 *
 * Aqui `conectado` é o que o 99Food responde, não o que alguém digitou. O
 * app_shop_id é o id da loja no nosso banco, então a amarração é automática e
 * o pedido chega sabendo de quem é.
 */

async function lojaDaSessao(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, storeName: true },
  });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };

  // Funcionário conecta a loja do dono, não uma loja própria.
  const lojaId = user.ownerId || user.id;
  return { lojaId, nome: user.storeName || "" };
}

export async function GET(req: NextRequest) {
  const r = await lojaDaSessao(req);
  if ("erro" in r) return r.erro;

  if (!food99Configurado()) {
    return NextResponse.json({
      conectado: false,
      disponivel: false,
      mensagem:
        "A integração 99Food ainda não foi habilitada no servidor " +
        "(faltam FOOD99_APP_ID e FOOD99_APP_SECRET).",
    });
  }

  // Procurar vínculos custa a única chamada de 20s do shop/list, então só
  // acontece a pedido — é o "Já autorizei". Abrir a tela de Integrações não
  // pode consumir essa janela: com duas lojas abrindo junto, ambas veriam erro.
  const procurar = req.nextUrl.searchParams.get("procurar") === "1";
  const conexao = await estadoDaConexao(r.lojaId, procurar);

  // O que o 99Food respondeu vira o estado no banco. Sem isto, `food99Connected`
  // continuaria valendo o que o formulário antigo gravou — e ele é lido em
  // lugares que não têm como perguntar ao 99Food: o fallback do webhook (que
  // decide de quem é um pedido sem merchantId conhecido) e o cálculo da
  // mensalidade em lib/billing.ts, que cobra pela integração ativa. Uma loja
  // marcada como conectada sem nunca ter autorizado entrava nos dois.
  // Grava sempre em vez de comparar antes: o valor lido na sessão é o do
  // usuário logado, e um funcionário tem o flag dele, não o da loja do dono —
  // comparar com o valor errado deixaria a loja desatualizada justamente no
  // caso em que ela está errada. A escrita é idempotente.
  await prisma.user
    .update({ where: { id: r.lojaId }, data: { food99Connected: conexao.conectado } })
    .catch(() => {});

  return NextResponse.json(conexao);
}

/**
 * Descobre, do lado do 99Food, se a loja está conectada — e conecta sozinha
 * quando dá para saber sem ambiguidade.
 *
 * São duas tentativas, nesta ordem:
 *
 * 1. Perguntar o token pelo NOSSO id. Funciona quando o vínculo foi criado com
 *    `app_shop_id` = id da loja no FireHub, que é como o vínculo da Brasa
 *    Burguer foi feito e o que a página de autorização deveria produzir.
 *
 * 2. Se não, listar os vínculos do app e procurar um que ainda não tenha dono
 *    aqui dentro. É o caminho que salva o autoatendimento: a página de
 *    autorização IGNORA o app_shop_id que mandamos, então o vínculo pode
 *    nascer com um identificador escolhido pelo 99Food, e sem esta busca a
 *    loja autorizaria de verdade e a tela seguiria dizendo "não conectado".
 *
 * Sobrando exatamente um vínculo órfão, ele é adotado na hora — é a loja que
 * acabou de autorizar. Com mais de um, a escolha volta para a tela: adivinhar
 * aqui é o mesmo erro de despejar pedido na cozinha errada.
 */
async function estadoDaConexao(lojaId: string, procurarVinculos: boolean) {
  const direto = await getAuthToken(lojaId);
  if (direto.autorizada) {
    return {
      conectado: true,
      disponivel: true,
      expiraEm: new Date(direto.token.token_expiration_time * 1000).toISOString(),
      mensagem: "Loja conectada ao 99Food. Os pedidos chegam automaticamente.",
    };
  }

  // Já adotamos um app_shop_id diferente do nosso id numa conexão anterior?
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { food99AppId: true },
  });
  if (loja?.food99AppId) {
    const porVinculo = await getAuthToken(loja.food99AppId);
    if (porVinculo.autorizada) {
      return {
        conectado: true,
        disponivel: true,
        expiraEm: new Date(porVinculo.token.token_expiration_time * 1000).toISOString(),
        mensagem: "Loja conectada ao 99Food. Os pedidos chegam automaticamente.",
      };
    }
  }

  const semVinculo = {
    conectado: false,
    disponivel: true,
    erro: direto.erro,
    mensagem: "Loja ainda não autorizada. Clique em conectar para autorizar no 99Food.",
    candidatos: [] as { appShopId: string; nome: string; shopId: string | null }[],
  };

  if (!procurarVinculos) return semVinculo;

  const vinculos = await listarLojasVinculadas();
  if (!vinculos.ok) {
    return { ...semVinculo, erro: direto.erro || vinculos.erro, mensagem: vinculos.erro };
  }

  // Vínculos que ainda não pertencem a nenhuma loja do FireHub.
  const jaAdotados = await prisma.user.findMany({
    where: { food99AppId: { not: null } },
    select: { food99AppId: true },
  });
  const tomados = new Set(jaAdotados.map((u) => u.food99AppId));

  // O shop/list devolve só ids (app_id, shop_id, app_shop_id, city_id) — não
  // manda shop_name. Então o rótulo cai no id da loja no 99Food, que é o que
  // o lojista consegue conferir no painel dele.
  const orfaos = vinculos.lojas
    .filter((l) => l.app_shop_id && !tomados.has(String(l.app_shop_id)))
    .map((l) => ({
      appShopId: String(l.app_shop_id),
      nome: String(l.shop_name || l.name || `Loja 99Food ${l.shop_id ?? ""}`).trim(),
      shopId: l.shop_id != null ? String(l.shop_id) : null,
    }));

  if (orfaos.length === 1) {
    const escolhido = orfaos[0];
    await prisma.user.update({
      where: { id: lojaId },
      data: {
        food99AppId: escolhido.appShopId,
        ...(escolhido.shopId ? { food99MerchantId: escolhido.shopId } : {}),
      },
    });
    return {
      conectado: true,
      disponivel: true,
      adotouVinculo: escolhido,
      mensagem: `Loja "${escolhido.nome}" conectada ao 99Food. Os pedidos chegam automaticamente.`,
    };
  }

  return {
    conectado: false,
    disponivel: true,
    erro: direto.erro,
    // Mais de um vínculo sem dono: a tela mostra os nomes e o lojista aponta o
    // dele. Continua sendo um clique, e sem chance de pegar a loja do vizinho.
    candidatos: orfaos,
    mensagem: orfaos.length
      ? "Encontrei mais de uma loja autorizada no 99Food. Escolha qual é a sua."
      : "Loja ainda não autorizada. Clique em conectar para autorizar no 99Food.",
  };
}

export async function POST(req: NextRequest) {
  const r = await lojaDaSessao(req);
  if ("erro" in r) return r.erro;

  if (!food99Configurado()) {
    return NextResponse.json(
      { error: "Integração 99Food não habilitada no servidor (FOOD99_APP_ID / FOOD99_APP_SECRET)." },
      { status: 503 }
    );
  }

  // Escolha manual entre vínculos órfãos, quando havia mais de um e a adoção
  // automática não pôde decidir. O app_shop_id é conferido contra a lista real
  // do 99Food e contra o que já pertence a outra loja: sem isso, um id
  // digitado na requisição sequestraria a integração do vizinho.
  const corpo = await req.json().catch(() => ({} as any));
  if (corpo?.appShopId) {
    const escolhido = String(corpo.appShopId);

    const vinculos = await listarLojasVinculadas();
    if (!vinculos.ok) {
      return NextResponse.json({ error: `Não consegui listar as lojas no 99Food: ${vinculos.erro}` }, { status: 502 });
    }
    const existe = vinculos.lojas.find((l) => String(l.app_shop_id) === escolhido);
    if (!existe) {
      return NextResponse.json({ error: "Essa loja não está autorizada no 99Food." }, { status: 404 });
    }

    const dono = await prisma.user.findFirst({
      where: { food99AppId: escolhido, NOT: { id: r.lojaId } },
      select: { id: true },
    });
    if (dono) {
      return NextResponse.json({ error: "Essa loja do 99Food já está ligada a outra loja no FireHub." }, { status: 409 });
    }

    await prisma.user.update({
      where: { id: r.lojaId },
      data: {
        food99AppId: escolhido,
        food99Connected: true,
        ...(existe.shop_id != null ? { food99MerchantId: String(existe.shop_id) } : {}),
      },
    });

    return NextResponse.json({
      conectado: true,
      mensagem: `Loja "${existe.shop_name || "99Food"}" conectada. Os pedidos chegam automaticamente.`,
    });
  }

  // Gerada na hora do clique de propósito: a URL carrega timestamp e
  // assinatura, e perde a validade. Guardar uma URL dessas em banco daria um
  // botão que funciona hoje e falha calado na semana que vem.
  const resultado = await getAuthorizationUrl(r.lojaId);
  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 502 });
  }

  console.log(`[99Food] URL de autorização gerada para a loja ${r.lojaId} (${r.nome})`);
  return NextResponse.json({
    url: resultado.url,
    instrucao:
      "Abra este link e entre com a conta que a sua loja usa no 99Food " +
      "(a mesma onde você vê os pedidos). Depois de autorizar, volte e atualize esta tela.",
  });
}
