import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAuthorizationUrl,
  getAuthToken,
  food99Configurado,
  listarLojasVinculadas,
  detalheDaLoja,
} from "@/lib/food99-api";
import { salvarLoja99, lojas99DaConta, desativarLoja99, donosPorAppShopId } from "@/lib/food99-lojas";

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
/**
 * Qual loja está ligada, com nome.
 *
 * A tela dizia só "🟢 Loja autorizada no 99Food", sem dizer qual — e o lojista
 * não tinha como conferir se ligou a loja certa antes de os pedidos começarem a
 * cair na cozinha. Com mais de uma loja na conta, seria impossível saber qual
 * está desligando no botão de desconectar.
 *
 * Falhar aqui não derruba nada: sem o nome a tela volta ao texto genérico, mas
 * o estado "conectado" continua valendo — ele vem do token, não daqui.
 */
async function comNomeDaLoja(lojaId: string, token: string, expiraEm: number) {
  const loja = await detalheDaLoja(token).catch(() => null);

  // Mantém a tabela em dia sem depender de ninguém rodar a migração: toda vez
  // que a tela confirma uma conexão, a loja é gravada (é idempotente). É o que
  // faz a Brasa Burguer aparecer na lista sozinha, sem intervenção.
  if (loja?.appShopId) {
    await salvarLoja99({
      userId: lojaId,
      appShopId: loja.appShopId,
      shopId: loja.shopId,
      label: loja.nome,
    }).catch(() => false);
  }

  return {
    conectado: true,
    disponivel: true,
    expiraEm: new Date(expiraEm * 1000).toISOString(),
    lojaNo99: loja,
    lojas: await lojas99DaConta(lojaId).catch(() => []),
    mensagem: loja?.nome
      ? `Loja "${loja.nome}" conectada ao 99Food. Os pedidos chegam automaticamente.`
      : "Loja conectada ao 99Food. Os pedidos chegam automaticamente.",
  };
}

async function estadoDaConexao(lojaId: string, procurarVinculos: boolean) {
  const direto = await getAuthToken(lojaId);
  if (direto.autorizada) {
    return comNomeDaLoja(lojaId, direto.token.auth_token, direto.token.token_expiration_time);
  }

  // Já adotamos um app_shop_id diferente do nosso id numa conexão anterior?
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { food99AppId: true },
  });
  if (loja?.food99AppId) {
    const porVinculo = await getAuthToken(loja.food99AppId);
    if (porVinculo.autorizada) {
      return comNomeDaLoja(lojaId, porVinculo.token.auth_token, porVinculo.token.token_expiration_time);
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
  //
  // A pergunta é "de quem é este app_shop_id?", e ela tem DUAS fontes: a
  // tabela `Food99Store` (onde mora quem conectou pelo caminho novo, a Brasa
  // Burguer inclusive) e as colunas antigas do User. Ler só as colunas fazia a
  // loja de quem já está conectado voltar a contar como órfã — ver
  // donosPorAppShopId(), que existe por causa disso.
  //
  // O que é da PRÓPRIA loja não bloqueia: reconhecer o vínculo dela de novo é
  // idempotente, e é o que conserta uma conta que perdeu a linha na tabela.
  const donos = await donosPorAppShopId();

  // O shop/list devolve só ids (app_id, shop_id, app_shop_id, city_id) — não
  // manda shop_name. Então o rótulo cai no id da loja no 99Food, que é o que
  // o lojista consegue conferir no painel dele.
  const orfaos = vinculos.lojas
    .filter((l) => {
      if (!l.app_shop_id) return false;
      const dono = donos.get(String(l.app_shop_id));
      return !dono || dono === lojaId;
    })
    .map((l) => ({
      appShopId: String(l.app_shop_id),
      nome: String(l.shop_name || l.name || `Loja 99Food ${l.shop_id ?? ""}`).trim(),
      shopId: l.shop_id != null ? String(l.shop_id) : null,
    }));

  if (orfaos.length === 1) {
    const escolhido = orfaos[0];
    // Grava nos DOIS lugares de propósito. A tabela é o que permite mais de uma
    // loja por conta; as colunas do User continuam sendo o plano B de tudo que
    // ainda as lê, e é o que garante que nada pare se a tabela não existir.
    await salvarLoja99({
      userId: lojaId,
      appShopId: escolhido.appShopId,
      shopId: escolhido.shopId,
      label: escolhido.nome,
    });
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

  // Zero órfãos tem TRÊS causas diferentes, e a tela dizia a mesma frase nas
  // três — "Loja ainda não autorizada", que é a resposta certa só na primeira.
  // Foi isso que segurou o caso do Frangoso em 06/09: ele tinha autorizado, a
  // consulta voltou `ok` com lista vazia, e a tela repetiu que ele não tinha
  // autorizado. O lojista clica em autorizar de novo e nada muda, para sempre.
  const semOrfaos =
    vinculos.lojas.length === 0
      ? "Você autorizou no 99Food? Ainda não vejo nenhuma loja vinculada ao FireHub lá. " +
        "Se você acabou de autorizar, espere alguns segundos e clique em Verificar agora."
      : `O 99Food tem ${vinculos.lojas.length} loja(s) vinculada(s) ao FireHub, mas todas já ` +
        "pertencem a outra loja aqui dentro. Fale com o suporte do FireHub — não clique em autorizar de novo.";

  return {
    conectado: false,
    disponivel: true,
    erro: direto.erro,
    // Mais de um vínculo sem dono: a tela mostra os nomes e o lojista aponta o
    // dele. Continua sendo um clique, e sem chance de pegar a loja do vizinho.
    candidatos: orfaos,
    // Quantas o 99Food devolveu, independente de dono. É o número que separa
    // "não autorizou" de "autorizou e nós não estamos enxergando".
    vinculosNo99: vinculos.lojas.length,
    mensagem: orfaos.length
      ? "Encontrei mais de uma loja autorizada no 99Food. Escolha qual é a sua."
      : semOrfaos,
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

    // A trava lia só `User.food99AppId` — nulo em toda a base — então NUNCA
    // disparava: dava para digitar o app_shop_id do vizinho e levar os pedidos
    // dele junto, porque o `ON CONFLICT` do salvarLoja99 troca o dono.
    const donos = await donosPorAppShopId();
    const dono = donos.get(escolhido);
    if (dono && dono !== r.lojaId) {
      return NextResponse.json({ error: "Essa loja do 99Food já está ligada a outra loja no FireHub." }, { status: 409 });
    }

    // Tabela primeiro (é ela que aceita a segunda loja), colunas do User depois
    // (plano B de tudo que ainda as lê). As colunas guardam a ÚLTIMA conectada
    // — com uma loja é a dela, com várias é só reserva; quem manda é a tabela.
    await salvarLoja99({
      userId: r.lojaId,
      appShopId: escolhido,
      shopId: existe.shop_id != null ? String(existe.shop_id) : null,
      label: existe.shop_name ? String(existe.shop_name) : null,
    });
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

/**
 * DELETE /api/99food/conectar?appShopId=…
 *
 * Desliga UMA loja do 99Food da conta, sem tocar nas outras.
 *
 * É diferente de /api/99food/auth?step=disconnect, que desfaz o vínculo do lado
 * do 99Food e limpa as colunas do User — ou seja, derruba a conta inteira. Com
 * várias lojas, isso deixaria de ser o que o lojista quer na maioria das vezes:
 * ele quer tirar a filial que fechou, não sair do 99Food.
 *
 * Aqui a linha só é marcada como inativa. O vínculo continua de pé no 99Food, e
 * é por isso que a resposta diz isso com todas as letras: se ele quer parar de
 * receber de verdade, precisa desfazer lá também.
 */
export async function DELETE(req: NextRequest) {
  const r = await lojaDaSessao(req);
  if ("erro" in r) return r.erro;

  const appShopId = String(req.nextUrl.searchParams.get("appShopId") ?? "").trim();
  if (!appShopId) {
    return NextResponse.json({ error: "Informe qual loja (appShopId)." }, { status: 400 });
  }

  // Só desliga o que é da própria conta: sem esta conferência, um appShopId
  // digitado na URL desligaria a loja do vizinho.
  const minhas = await lojas99DaConta(r.lojaId);
  const alvo = minhas.find((l) => l.appShopId === appShopId);
  if (!alvo) {
    return NextResponse.json({ error: "Essa loja não pertence a esta conta." }, { status: 404 });
  }

  const ok = await desativarLoja99(r.lojaId, appShopId);
  if (!ok) {
    return NextResponse.json({ error: "Não consegui desligar a loja agora." }, { status: 500 });
  }

  const restantes = await lojas99DaConta(r.lojaId);

  // Sobrando zero, a conta deixa de ter 99Food ativo — e o booleano antigo
  // precisa acompanhar, porque é ele que a cobrança e o fallback do webhook
  // leem quando a tabela não responde.
  if (restantes.length === 0) {
    await prisma.user
      .update({ where: { id: r.lojaId }, data: { food99Connected: false } })
      .catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    desligada: alvo.label || appShopId,
    lojasRestantes: restantes.length,
    aviso:
      "A loja saiu do FireHub. O vínculo com o app continua de pé no 99Food — " +
      "se quiser parar de receber pedido dela de vez, desfaça também no painel deles.",
  });
}
