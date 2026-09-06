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
import { salvarLoja99, lojas99DaConta, desativarLoja99, donosPorAppShopId, slotsDaConta } from "@/lib/food99-lojas";
import { vincularParaConta, autorizadasLivresPara, vinculadasSemDonoPara, adotarVinculo } from "@/lib/food99-vinculo";

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
interface LojaConectada {
  appShopId: string;
  shopId: string | null;
  label: string | null;
  nome: string | null;
  endereco: string | null;
  expiraEm: string;
}

/**
 * Pergunta ao 99Food, id por id, quais lojas desta conta têm token — e grava
 * as que têm.
 *
 * Os ids consultados são: o da conta (a primeira loja), os das lojas já
 * gravadas, o `food99AppId` antigo se existir, e o PRÓXIMO slot livre. Este
 * último é o que pega uma loja recém-autorizada pelo botão "Conectar outra
 * loja": ela não tem linha ainda, mas o link que o lojista abriu carregava
 * exatamente esse id. Sem consultá-lo, a segunda loja autorizava de verdade e
 * a tela nunca ficava sabendo.
 *
 * Gravar aqui (idempotente) é o que mantém a tabela em dia sem ninguém rodar
 * migração — e é o que faz a Brasa Burguer aparecer na lista sozinha.
 */
async function sincronizarLojasDaConta(lojaId: string): Promise<{ conectadas: LojaConectada[]; erro?: string }> {
  const gravadas = await lojas99DaConta(lojaId).catch(() => []);
  const { conhecidos, proximo } = slotsDaConta(lojaId, gravadas);

  const antigo = await prisma.user.findUnique({ where: { id: lojaId }, select: { food99AppId: true } });
  const ids = Array.from(new Set([...conhecidos, ...(antigo?.food99AppId ? [antigo.food99AppId] : []), proximo]));

  const conectadas: LojaConectada[] = [];
  let erro: string | undefined;

  for (const id of ids) {
    const r = await getAuthToken(id);
    if (!r.autorizada) {
      if (r.erro && !erro) erro = r.erro;
      continue;
    }

    const detalhe = await detalheDaLoja(r.token.auth_token).catch(() => null);
    const jaGravada = gravadas.find((g) => g.appShopId === id);
    const loja: LojaConectada = {
      appShopId: id,
      shopId: detalhe?.shopId ?? jaGravada?.shopId ?? null,
      label: detalhe?.nome ?? jaGravada?.label ?? null,
      nome: detalhe?.nome ?? jaGravada?.label ?? null,
      endereco: detalhe?.endereco ?? null,
      expiraEm: new Date(r.token.token_expiration_time * 1000).toISOString(),
    };
    conectadas.push(loja);

    await salvarLoja99({ userId: lojaId, appShopId: id, shopId: loja.shopId, label: loja.label }).catch(() => false);
  }

  return { conectadas, erro };
}

async function estadoDaConexao(lojaId: string, procurarVinculos: boolean) {
  const { conectadas, erro } = await sincronizarLojasDaConta(lojaId);

  if (conectadas.length > 0) {
    const primeira = conectadas[0];
    // A lista da tela vem do banco quando ele responde — é a mesma que o
    // webhook e a cobrança leem. Sem tabela, vale o que acabou de ser
    // confirmado com o 99Food, para a tela não dizer "nenhuma".
    const doBanco = await lojas99DaConta(lojaId).catch(() => []);
    const lojas = doBanco.length
      ? doBanco
      : conectadas.map((c) => ({ appShopId: c.appShopId, shopId: c.shopId, label: c.label }));

    return {
      conectado: true,
      disponivel: true,
      expiraEm: primeira.expiraEm,
      lojaNo99: { nome: primeira.nome, shopId: primeira.shopId, endereco: primeira.endereco },
      lojas,
      mensagem:
        conectadas.length > 1
          ? `${conectadas.length} lojas conectadas ao 99Food. Os pedidos chegam automaticamente.`
          : primeira.nome
          ? `Loja "${primeira.nome}" conectada ao 99Food. Os pedidos chegam automaticamente.`
          : "Loja conectada ao 99Food. Os pedidos chegam automaticamente.",
    };
  }

  const direto = { erro };

  const semVinculo = {
    conectado: false,
    disponivel: true,
    erro: direto.erro,
    mensagem: "Loja ainda não autorizada. Clique em conectar para autorizar no 99Food.",
    candidatos: [] as { appShopId: string; nome: string; shopId: string | null }[],
  };

  if (!procurarVinculos) return semVinculo;

  // ── Etapa 2 por API: quem autorizou e ainda não está vinculado ────────────
  //
  // Autorizar (o lojista, na página do getUrl) e vincular (nós, no shopBind)
  // são coisas diferentes — ver food99-vinculo.ts. Antes deste bloco a tela
  // olhava só o shop/list, que lista quem JÁ está vinculado: a loja recém-
  // autorizada nunca aparecia ali, e o lojista ficava clicando em autorizar.
  //
  // Uma só autorizada e livre → é a dele, vincula na hora e a tela fica verde.
  // Mais de uma → ele escolhe (POST { shopId }). Nada → segue para o caminho
  // antigo, que ainda cobre vínculo já feito sem dono aqui dentro.
  const autorizadas = await autorizadasLivresPara(lojaId);
  if (autorizadas.ok) {
    if (autorizadas.livres.length === 1) {
      const v = await vincularParaConta(lojaId, autorizadas.livres[0]);
      if (v.ok) {
        return {
          conectado: true,
          disponivel: true,
          expiraEm: v.expiraEm,
          lojaNo99: { nome: v.nome, shopId: v.shopId, endereco: null },
          lojas: await lojas99DaConta(lojaId).catch(() => []),
          vinculouAgora: v,
          mensagem: v.nome
            ? `Loja "${v.nome}" conectada ao 99Food. Os pedidos chegam automaticamente.`
            : "Loja conectada ao 99Food. Os pedidos chegam automaticamente.",
        };
      }
      return { ...semVinculo, erro: v.erro, mensagem: `A loja autorizou, mas o vínculo não fechou: ${v.erro}` };
    }
    if (autorizadas.livres.length > 1) {
      return {
        conectado: false,
        disponivel: true,
        candidatos: autorizadas.livres.map((l) => ({
          // Prefixo para a tela distinguir "vincular pelo shop_id" (etapa 2) de
          // "adotar um app_shop_id já vinculado" (caminho antigo, abaixo).
          appShopId: `shop:${l.shopId}`,
          shopId: l.shopId,
          nome: l.nome || `Loja 99Food ${l.shopId}`,
        })),
        vinculosNo99: autorizadas.total,
        mensagem: "Encontrei mais de uma loja autorizada no 99Food. Escolha qual é a sua.",
      };
    }
  } else {
    // Sem permissão (10006) ou fora do ar: fica no log e segue para o caminho
    // antigo — um endpoint a mais não pode virar tela vermelha.
    console.warn(`[99Food] getAuthorizedShops indisponível: ${autorizadas.erro}`);
  }

  // ── Vínculo que o 99Food já fez, com o id DELES ───────────────────────────
  //
  // A página de autorização vincula sozinha e escolhe o app_shop_id (o
  // próprio shop_id, ou um código como `BCkpxsW2KAHowtV574U2-4253`). É o caso
  // das três lojas do Lucas em 06/09: vinculadas o dia inteiro enquanto a
  // tela perguntava pelo id do FireHub. Uma só sem dono → é a dele, adota e
  // fica verde. Várias → ele escolhe (POST { appShopId }).
  const vinculadas = await vinculadasSemDonoPara(lojaId);
  if (vinculadas.ok) {
    if (vinculadas.lojas.length === 1) {
      const a = await adotarVinculo(lojaId, vinculadas.lojas[0]);
      if (a.ok) {
        return {
          conectado: true,
          disponivel: true,
          expiraEm: a.expiraEm,
          lojaNo99: { nome: a.nome, shopId: a.shopId, endereco: null },
          lojas: await lojas99DaConta(lojaId).catch(() => []),
          adotouVinculo: a,
          mensagem: a.nome
            ? `Loja "${a.nome}" conectada ao 99Food. Os pedidos chegam automaticamente.`
            : "Loja conectada ao 99Food. Os pedidos chegam automaticamente.",
        };
      }
      return { ...semVinculo, erro: a.erro, mensagem: `A loja está vinculada no 99Food, mas não consegui usá-la: ${a.erro}` };
    }
    if (vinculadas.lojas.length > 1) {
      return {
        conectado: false,
        disponivel: true,
        candidatos: vinculadas.lojas.map((l) => ({
          appShopId: String(l.appShopId),
          shopId: l.shopId,
          nome: l.nome || `Loja 99Food ${l.shopId}`,
        })),
        vinculosNo99: vinculadas.lojas.length,
        mensagem: "Encontrei mais de uma loja autorizada no 99Food. Escolha qual é a sua.",
      };
    }

    // Autorizou o FireHub, mas o 99Food só admite UM integrador por loja e
    // ela ainda está com outro (Saipos, Brendi…). Nenhum clique aqui resolve:
    // é no painel do 99Food que o lojista solta a loja do sistema antigo. A
    // tela diz exatamente isso, com o nome das lojas — senão ele fica
    // clicando em autorizar, como o Frangoso ficou o dia inteiro.
    if (vinculadas.deOutroIntegrador.length > 0) {
      const nomes = vinculadas.deOutroIntegrador.map((l) => l.nome || l.shopId).join(", ");
      return {
        conectado: false,
        disponivel: true,
        candidatos: [],
        presaEmOutroIntegrador: vinculadas.deOutroIntegrador.map((l) => ({ shopId: l.shopId, nome: l.nome })),
        vinculosNo99: vinculadas.deOutroIntegrador.length,
        mensagem:
          `${nomes}: autorizou o FireHub, mas o 99Food só permite um sistema integrado por loja e ` +
          "ela ainda está ligada a outro. No painel do 99Food, em Aplicativos autorizados, desautorize o " +
          "sistema antigo dessa loja e clique em Verificar agora — o FireHub assume o vínculo sozinho.",
      };
    }
  }

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

  // Escolha entre lojas AUTORIZADAS e ainda sem vínculo (etapa 2): a tela manda
  // o shop_id que o lojista apontou, e o vínculo é feito aqui, com o id desta
  // conta. `autorizadasLivresPara` já exclui o que pertence a outra conta.
  if (corpo?.shopId) {
    const shopId = String(corpo.shopId);
    const autorizadas = await autorizadasLivresPara(r.lojaId);
    if (!autorizadas.ok) {
      return NextResponse.json(
        { error: `Não consegui listar as lojas autorizadas no 99Food: ${autorizadas.erro}` },
        { status: 502 }
      );
    }
    const alvo = autorizadas.livres.find((l) => l.shopId === shopId);
    if (!alvo) {
      return NextResponse.json(
        { error: "Essa loja não está autorizada no 99Food, ou já pertence a outra loja do FireHub." },
        { status: 404 }
      );
    }
    const v = await vincularParaConta(r.lojaId, alvo);
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 502 });
    return NextResponse.json({
      conectado: true,
      mensagem: `Loja "${v.nome || "99Food"}" conectada. Os pedidos chegam automaticamente.`,
    });
  }

  if (corpo?.appShopId) {
    const escolhido = String(corpo.appShopId);

    // Primeiro a v3: vínculo feito pelo 99Food com o id deles, sem dono aqui.
    // `vinculadasSemDonoPara` já exclui o que pertence a outra conta.
    const vinculadas = await vinculadasSemDonoPara(r.lojaId);
    if (vinculadas.ok) {
      const alvo = vinculadas.lojas.find((l) => l.appShopId === escolhido);
      if (alvo) {
        const a = await adotarVinculo(r.lojaId, alvo);
        if (!a.ok) return NextResponse.json({ error: a.erro }, { status: 502 });
        return NextResponse.json({
          conectado: true,
          mensagem: `Loja "${a.nome || "99Food"}" conectada. Os pedidos chegam automaticamente.`,
        });
      }
    }

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

  // Qual id vai dentro do link. A primeira loja usa o id da conta; "Conectar
  // outra loja" usa o próximo slot livre — porque só existe um vínculo por id,
  // e autorizar dois estabelecimentos com o mesmo link foi exatamente o que
  // deixou o segundo do Lucas no limbo em 06/09. Sincroniza antes de escolher:
  // um slot autorizado há um minuto e ainda sem linha seria reemitido, e o
  // estabelecimento seguinte colidiria com ele.
  let appShopId = r.lojaId;
  if (corpo?.outraLoja === true) {
    await sincronizarLojasDaConta(r.lojaId);
    const gravadas = await lojas99DaConta(r.lojaId).catch(() => []);
    appShopId = slotsDaConta(r.lojaId, gravadas).proximo;
  }

  // Gerada na hora do clique de propósito: a URL carrega timestamp e
  // assinatura, e perde a validade. Guardar uma URL dessas em banco daria um
  // botão que funciona hoje e falha calado na semana que vem.
  const resultado = await getAuthorizationUrl(appShopId);
  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 502 });
  }

  console.log(`[99Food] URL de autorização gerada para a loja ${r.lojaId} (${r.nome}) com app_shop_id ${appShopId}`);
  return NextResponse.json({
    url: resultado.url,
    appShopId,
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
