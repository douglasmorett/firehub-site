import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { garantirColunasBrendi } from "@/lib/garantir-colunas";
import { autenticarBrendi } from "@/lib/brendi-api";

export const dynamic = "force-dynamic";

/**
 * /api/store/integracoes/brendi — conexão da loja com a Brendi (Open Delivery).
 *
 * Clone estrutural da rota do JotaJá, com as regras aprendidas a tapa:
 *   1. O secret NUNCA volta ao navegador (GET devolve só `hasSecret`).
 *   2. Campo vazio no POST MANTÉM o valor salvo — nunca apaga credencial.
 *   3. "Conectado" é resposta do parceiro: `brendiConnected=true` só depois de
 *      o oauth/token REAL da Brendi aceitar a credencial.
 *
 * ── Por que SQL cru em vez do Prisma Client ─────────────────────────────────
 * As colunas brendi* são garantidas no boot por garantirColunasBrendi()
 * (ALTER TABLE ... IF NOT EXISTS) e ainda NÃO estão no schema.prisma — regra
 * da casa para não quebrar produção com migração. O Prisma Client não as
 * conhece, então todo acesso aqui é $queryRaw/$executeRaw parametrizado com
 * tipagem manual, igual food99-lojas.ts e brendi-api.ts fazem.
 */

/** Linha crua do User com os campos que o Prisma Client ainda não conhece. */
interface LinhaBrendi {
  brendiClientId: string | null;
  brendiClientSecret: string | null;
  brendiMerchantId: string | null;
  brendiConnected: boolean | null;
}

async function linhaBrendi(userId: string): Promise<LinhaBrendi | null> {
  try {
    const r = await prisma.$queryRaw<LinhaBrendi[]>`
      SELECT "brendiClientId", "brendiClientSecret", "brendiMerchantId", "brendiConnected"
      FROM "User"
      WHERE "id" = ${userId}
      LIMIT 1
    `;
    return Array.isArray(r) && r[0] ? r[0] : null;
  } catch {
    // Colunas ainda não criadas neste banco (boot ensure não conseguiu rodar):
    // para quem chama isso é "integração nunca configurada", não um 500.
    return null;
  }
}

/**
 * Resolve em qual User as credenciais moram: no DONO da conta (`ownerId||id`).
 * Filial de rede aponta para o dono, e é lá que a tela grava — buscar na
 * filial devolveria vazio e pareceria "não conectado" com o painel do dono
 * verde, dois diagnósticos opostos para o mesmo sintoma.
 */
async function resolverDono(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, ownerId: true },
  });
  if (!user) return null;
  return user.ownerId || user.id;
}

/**
 * O clientId volta ao navegador só por PREFIXO (8 chars): o suficiente para o
 * lojista reconhecer QUAL credencial está salva, sem entregar a credencial
 * inteira a qualquer XSS/extensão na máquina dele (mesma regra do diagnóstico
 * do 99Food). O POST abaixo sabe reconhecer esse formato de volta.
 */
function prefixoDoClientId(clientId: string | null): string {
  if (!clientId) return "";
  return clientId.length > 8 ? `${clientId.slice(0, 8)}…` : clientId;
}

/**
 * O GET devolve o clientId mascarado; se a tela reenviar esse valor no POST
 * sem o lojista redigitar, gravá-lo sobrescreveria a credencial real com o
 * prefixo — derrubando a integração sem ninguém pedir. Valor mascarado conta
 * como "campo vazio" = manter o atual.
 */
function pareceMascarado(valor: string): boolean {
  return valor.includes("…") || valor.includes("•");
}

// GET: estado da conexão Brendi da conta logada (nunca devolve o secret)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    // Defensivo e de custo zero após o primeiro sucesso: se o boot pegou o
    // banco num soluço, é esta chamada que conserta.
    await garantirColunasBrendi();

    const donoId = await resolverDono(session.user.email);
    if (!donoId) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const linha = await linhaBrendi(donoId);

    return NextResponse.json({
      ok: true,
      clientId: prefixoDoClientId(linha?.brendiClientId ?? null),
      hasSecret: !!linha?.brendiClientSecret,
      merchantId: linha?.brendiMerchantId || "",
      connected: !!linha?.brendiConnected,
      configurada: !!(linha?.brendiClientId && linha?.brendiClientSecret),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: salva credenciais e SÓ marca conectado se a Brendi autenticar de verdade
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    await garantirColunasBrendi();

    const body = await req.json();
    const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
    const clientSecret = typeof body?.clientSecret === "string" ? body.clientSecret.trim() : "";
    const merchantId = typeof body?.merchantId === "string" ? body.merchantId.trim() : "";

    const donoId = await resolverDono(session.user.email);
    if (!donoId) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // Campo vazio NUNCA apaga credencial (lição JotaJá: o GET não devolve o
    // secret, então um "salvar" sem redigitar mandaria vazio e tiraria a loja
    // do polling para sempre — com o painel continuando verde).
    const atual = await linhaBrendi(donoId);
    const novoClientId =
      (clientId && !pareceMascarado(clientId) ? clientId : atual?.brendiClientId) || null;
    const novoSecret = clientSecret || atual?.brendiClientSecret || null;

    // ── O MERCHANT ID É O PRÓPRIO CLIENT ID ─────────────────────────────────
    //
    // Medido na sandbox em 05/09/2026, não suposto: no `GET /v1/orders/{id}` o
    // campo `merchant.id` veio EXATAMENTE igual ao Client ID da integração
    // (`5480e656-…`). E não existe endpoint de merchant na API deles — as cinco
    // variantes (`/v1/merchants`, `/v1/merchant`, `/v1/merchants/me`,
    // `/merchants`, `/v1/me`) respondem 404 —, nem o painel exibe esse id em
    // lugar nenhum. Ou seja: pedir ao lojista que "copie o Merchant ID" era
    // pedir um dado que ele não tem onde achar, e sem ele a amarração
    // pedido→loja caía no fallback de "a única loja conectada" — que recusa
    // assim que a segunda loja conectar.
    //
    // Então o padrão passa a ser o Client ID, e o campo continua editável para
    // o dia em que a Brendi separar os dois.
    const novoMerchant = merchantId || atual?.brendiMerchantId || novoClientId || null;

    if (!novoClientId || !novoSecret) {
      return NextResponse.json(
        {
          error:
            "Informe o Client ID e o Client Secret da Brendi (app.brendi.com.br → Integrações → API Pública) — sem os dois a loja não entra no polling de pedidos.",
        },
        { status: 400 }
      );
    }

    // Anti-sequestro: o merchantId é a chave de amarração pedido→loja. Se duas
    // contas reivindicarem o mesmo, pedido cai na cozinha errada — pior que
    // pedido recusado com log. Qualquer id vindo do cliente é validado contra
    // dono existente antes de gravar.
    if (novoMerchant) {
      const conflito = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User"
        WHERE "brendiMerchantId" = ${novoMerchant} AND "id" <> ${donoId}
        LIMIT 1
      `;
      if (Array.isArray(conflito) && conflito.length > 0) {
        return NextResponse.json(
          {
            error:
              "Este Merchant ID da Brendi já está vinculado a OUTRA conta do FireHub. Confira o id no painel da Brendi — se a loja trocou de conta, fale com o suporte.",
          },
          { status: 409 }
        );
      }
    }

    // Grava PRIMEIRO com connected=false: autenticarBrendi lê a credencial do
    // banco, então ela precisa estar lá antes do teste. Se a Brendi recusar, o
    // estado final já é o correto (credencial salva, integração desligada).
    await prisma.$executeRaw`
      UPDATE "User"
      SET "brendiClientId" = ${novoClientId},
          "brendiClientSecret" = ${novoSecret},
          "brendiMerchantId" = ${novoMerchant},
          "brendiConnected" = false
      WHERE "id" = ${donoId}
    `;

    // Teste REAL no oauth/token da Brendi — "conectado" no painel significa
    // "a Brendi aceitou esta credencial agora", nunca formulário salvo (a rota
    // do 99Food que marcava conectado sem falar com o parceiro virou 410).
    const auth = await autenticarBrendi(donoId);

    if (auth.ok) {
      await prisma.$executeRaw`
        UPDATE "User" SET "brendiConnected" = true WHERE "id" = ${donoId}
      `;
    }

    return NextResponse.json({
      ok: true,
      autenticou: auth.ok,
      connected: auth.ok,
      merchantId: novoMerchant || "",
      message: auth.ok
        ? "Integração Brendi salva e ativada — credencial testada e aceita pela Brendi."
        : `Credenciais salvas, mas a integração ficou DESLIGADA: ${auth.erro}. Confira Client ID e Secret em app.brendi.com.br → Integrações → API Pública.`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: desconecta a integração — SÓ da própria conta, sem apagar credencial
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    await garantirColunasBrendi();

    const donoId = await resolverDono(session.user.email);
    if (!donoId) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // Desligar ≠ apagar: manter a credencial faz "religar" ser um clique em
    // vez de um cadastro novo (e o secret a Brendi só exibe UMA vez). O cron e
    // o poll filtram por brendiConnected=true, então false já tira a loja de
    // todo o ciclo. O WHERE pelo próprio donoId garante que ninguém desliga
    // loja alheia por aqui.
    await prisma.$executeRaw`
      UPDATE "User" SET "brendiConnected" = false WHERE "id" = ${donoId}
    `;

    return NextResponse.json({
      ok: true,
      connected: false,
      message: "Integração Brendi desconectada. As credenciais continuam salvas para religar quando quiser.",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
