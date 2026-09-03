import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getIfoodToken } from "@/lib/ifood-api";

// Só dígitos — para comparar CNPJ vindo do iFood com o cadastrado na loja.
const onlyDigits = (v: any): string => String(v || "").replace(/\D/g, "");

/**
 * POST /api/ifood/auth/link-merchant
 *
 * O que era explorável antes: bastava estar logado e colar QUALQUER Merchant
 * UUID. A rota só perguntava ao iFood se o merchant existia (usando o token
 * centralizado do app, que enxerga todos os merchants de todos os clientes) e
 * gravava o vínculo. Ou seja, a loja A podia sequestrar o canal iFood da loja B:
 * a partir daí os pedidos/eventos daquele merchant passavam a ser roteados para
 * a loja A (o cron casa pedido por ifoodMerchantId). Também gravava o vínculo no
 * registro do FUNCIONÁRIO logado, e não no da franquia.
 *
 * Agora: o vínculo é sempre gravado na loja da sessão (ownerId || id; ADMIN
 * respeita o cookie firehub_active_store) e recusamos o que é comprovadamente
 * indevido — merchant já vinculado a OUTRO franqueado, ou CNPJ do merchant no
 * iFood diferente do CNPJ cadastrado na loja. Quando não há como provar (loja
 * sem CNPJ cadastrado, iFood não devolve o documento), o vínculo é permitido e
 * registrado no log, para não travar a ativação de uma loja legítima.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const { merchantId, confirmarCnpjDiferente } = await req.json();
    const cleanMerchantId = merchantId?.trim();

    if (!cleanMerchantId) {
      return NextResponse.json({ error: "ID da loja (Merchant UUID) é obrigatório." }, { status: 400 });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(cleanMerchantId)) {
      return NextResponse.json({
        error: "ID da loja inválido. Certifique-se de que é um UUID válido do iFood (ex: f2170891-3073-47ea-9e32-947a2336bc8c)."
      }, { status: 400 });
    }

    // ── 1) Resolver a loja autenticada (nunca o registro do funcionário) ──
    const sessionUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, ownerId: true },
    });
    if (!sessionUser) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const activeStoreId =
      req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null;
    const storeId =
      sessionUser.role === "ADMIN" && activeStoreId && activeStoreId !== "all"
        ? activeStoreId
        : (sessionUser.ownerId || sessionUser.id);

    const store = await prisma.user.findUnique({
      where: { id: storeId },
      select: {
        id: true, name: true, cpfCnpj: true, fiscalConfig: true, ifoodMerchantId: true,
        ifoodAccessToken: true, ifoodRefreshToken: true, ifoodTokenExpiresAt: true,
      },
    });
    if (!store) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }

    // ── 2) Recusar merchant já vinculado a OUTRO franqueado ──
    // Vale tanto o vínculo principal (User.ifoodMerchantId) quanto os vínculos
    // multi-loja (IfoodIntegration). Registros da própria loja (inclusive de um
    // funcionário dela, resquício do bug antigo) não bloqueiam a revinculação.
    const linkedUsers = await prisma.user.findMany({
      where: { ifoodMerchantId: cleanMerchantId },
      select: { id: true, name: true, ownerId: true },
    });
    const foreignUser = linkedUsers.find((u) => (u.ownerId || u.id) !== storeId);

    const linkedIntegrations = await prisma.ifoodIntegration.findMany({
      where: { merchantId: cleanMerchantId },
      select: { id: true, userId: true, user: { select: { id: true, name: true, ownerId: true } } },
    });
    const foreignIntegration = linkedIntegrations.find(
      (i) => (i.user?.ownerId || i.userId) !== storeId
    );

    if (foreignUser || foreignIntegration) {
      const ownerName = foreignUser?.name || foreignIntegration?.user?.name || "outra loja";
      console.warn(
        `[iFood Link Merchant] BLOQUEADO: loja ${storeId} tentou vincular o merchant ${cleanMerchantId}, já pertencente a ${ownerName}.`
      );
      return NextResponse.json({
        error: "Este Merchant ID já está vinculado a outra loja no FireHub.",
        details:
          "Cada loja iFood pode pertencer a uma única franquia. Se este merchant é realmente seu, peça para a loja atual desvincular primeiro ou fale com o suporte.",
      }, { status: 409 });
    }

    const token = await getIfoodToken();
    const res = await fetch(`https://merchant-api.ifood.com.br/merchant/v1.0/merchants/${cleanMerchantId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[iFood Link Merchant] Validação falhou para ${cleanMerchantId}: ${res.status} — ${errText}`);
      return NextResponse.json({
        error: `Não foi possível acessar a loja no iFood (HTTP ${res.status}).`,
        details: "Verifique se você já solicitou o acesso a este CNPJ/Merchant ID na aba 'Permissões' do Portal do Desenvolvedor do iFood, e se o restaurante aprovou a solicitação no Portal do Parceiro.",
        raw: errText.slice(0, 200)
      }, { status: 400 });
    }

    const data = await res.json();
    const storeName = data.name || data.shortName || "Loja iFood";

    // ── 3) Conferir se o merchant é mesmo desta loja pelo CNPJ ──
    // O token do iFood é centralizado (enxerga todos os merchants do app), então
    // "a API respondeu 200" NÃO prova posse. O CNPJ prova, quando os dois lados
    // têm o dado. Só bloqueamos com prova: documentos presentes e diferentes.
    const merchantDoc = onlyDigits(
      data.document || data.cnpj || data.corporateDocument || data.taxPayerId || data.merchantDocument
    );
    const fiscalCnpj = onlyDigits((store.fiscalConfig as any)?.cnpj);
    const storeDoc = onlyDigits(store.cpfCnpj) || fiscalCnpj;

    // ⚠️ CNPJ diferente NÃO é mais recusa definitiva.
    //
    // A regra assumia "uma loja FireHub = um CNPJ", e isso brigava de frente
    // com a integração multi-loja que a própria tela oferece (e cobra +R$50 por
    // loja adicional): a Ragnar tem Ragnar Burguer, Ragnar Pizza e Tadala
    // Burguer no mesmo login do iFood, cada uma com seu CNPJ. Da segunda em
    // diante o vínculo voltava 403 e não havia caminho nenhum na tela.
    //
    // A proteção que importa continua inteira acima: merchant que já é de OUTRO
    // franqueado é recusado sem apelação. O que sobra aqui é o caso do lojista
    // colando o UUID errado — e para esse, avisar e pedir confirmação resolve,
    // sem trancar quem tem várias lojas de verdade. A confirmação fica no log.
    if (merchantDoc.length >= 11 && storeDoc.length >= 11 && merchantDoc !== storeDoc && !confirmarCnpjDiferente) {
      console.warn(
        `[iFood Link Merchant] CNPJ divergente (aguardando confirmação): loja ${storeId} (${storeDoc}) x merchant ${cleanMerchantId} (${merchantDoc}).`
      );
      return NextResponse.json({
        codigo: "CNPJ_DIVERGENTE",
        precisaConfirmar: true,
        cnpjDaLoja: storeDoc,
        cnpjDoMerchant: merchantDoc,
        nomeNoIfood: data.name || data.shortName || "",
        error: `A loja "${data.name || data.shortName || cleanMerchantId}" está em outro CNPJ (${merchantDoc}), diferente do cadastrado aqui (${storeDoc}).`,
        details:
          "Se for outra loja SUA no iFood, confirme para vincular — ela entra como integração adicional (+R$50,00/mês). " +
          "Se você não reconhece essa loja, cancele: provavelmente o Merchant ID colado é de outro estabelecimento.",
      }, { status: 409 });
    }
    if (merchantDoc.length >= 11 && storeDoc.length >= 11 && merchantDoc !== storeDoc) {
      console.warn(
        `[iFood Link Merchant] Loja ${storeId} (${storeDoc}) vinculou o merchant ${cleanMerchantId} de CNPJ ${merchantDoc} — confirmado pelo lojista.`
      );
    }
    if (!merchantDoc || !storeDoc) {
      console.warn(
        `[iFood Link Merchant] Vínculo sem conferência de CNPJ (loja ${storeId}, merchant ${cleanMerchantId}): documento indisponível em um dos lados.`
      );
    }

    // ── 4) Gravar o vínculo NA LOJA (e não no usuário logado) ──
    //
    // `User.ifoodMerchantId` é o vínculo PRINCIPAL — o desenho antigo, de uma
    // loja iFood só. Vincular a 2ª e a 3ª loja não pode sobrescrevê-lo: a
    // principal trocava a cada vínculo, e a tela passava a mostrar o nome de
    // uma loja com o Merchant ID de outra. Loja adicional vive na tabela de
    // integrações, que agora é varrida pelo polling.
    const ehAdicional = !!store.ifoodMerchantId && store.ifoodMerchantId !== cleanMerchantId;
    await prisma.user.update({
      where: { id: storeId },
      data: {
        ifoodConnected: true,
        ...(store.ifoodMerchantId ? {} : { ifoodMerchantId: cleanMerchantId }),
      }
    });

    // Espelha em IfoodIntegration (multi-loja) para que a tela de integrações
    // continue mostrando o merchant mesmo quem abriu foi um funcionário.
    try {
      // ── LOJA ADICIONAL GUARDA O TOKEN DELA ──────────────────────────────
      // Cada nova autorização sobrescreve `User.ifoodAccessToken`. Quem conecta
      // as lojas UMA POR UMA — que é como o lojista da Ragnar fez — deixava a
      // loja 2 apoiada num token que a loja 3 substituía minutos depois, e ela
      // parava de receber pedido sem erro nenhum em lugar nenhum. Congelar aqui
      // a credencial daquela autorização resolve.
      //
      // Só na ADICIONAL de propósito: a principal continua usando o token do
      // User. Duplicar a credencial dela poria dois lugares renovando com o
      // mesmo refresh_token, e o iFood invalida o refresh usado — o segundo a
      // tentar levaria recusa. (Se ainda assim vencer, `gruposDePollingIfood`
      // devolve a loja para o token do User em vez de deixá-la muda.)
      const credenciaisDaAdicional = ehAdicional
        ? {
            accessToken: store.ifoodAccessToken,
            refreshToken: store.ifoodRefreshToken,
            tokenExpiresAt: store.ifoodTokenExpiresAt,
          }
        : {};

      await prisma.ifoodIntegration.upsert({
        where: { userId_merchantId: { userId: storeId, merchantId: cleanMerchantId } },
        create: {
          userId: storeId,
          label: storeName,
          merchantId: cleanMerchantId,
          connected: true,
          active: true,
          ...credenciaisDaAdicional,
        },
        update: { connected: true, active: true },
      });
    } catch {}

    return NextResponse.json({
      success: true,
      merchantId: cleanMerchantId,
      storeName,
      adicional: ehAdicional,
      message: ehAdicional
        ? `${storeName} vinculada como loja adicional (+R$50,00/mês). Os pedidos dela entram no mesmo painel.`
        : "Loja vinculada com sucesso!",
    });
  } catch (err: any) {
    console.error("[iFood Link Merchant Error]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
