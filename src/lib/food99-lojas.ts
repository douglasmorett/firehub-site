import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * /src/lib/food99-lojas.ts
 *
 * As lojas do 99Food de uma conta. Um lugar só, e é de propósito.
 *
 * ── Por que SQL cru aqui dentro ─────────────────────────────────────────────
 *
 * A tabela `Food99Store` nasce por /api/admin/tabela-lojas-99food, não pelo
 * `prisma db push` (que saiu do build). Declarar o modelo no schema.prisma
 * exigiria commitar junto um trabalho em andamento de outra frente. Então o SQL
 * fica ISOLADO neste módulo: o resto do sistema chama função, não escreve
 * query. No dia em que o modelo entrar no schema, muda só este arquivo.
 *
 * ── A regra que vale para todas as buscas ───────────────────────────────────
 *
 * Toda função aqui cai de volta nas colunas antigas do `User`
 * (`food99AppId`, `food99MerchantId`, `food99Connected`) quando a tabela não
 * responde — porque ela pode não existir ainda, ou estar vazia.
 *
 * Isso não é excesso de zelo: a integração da Brasa Burguer está recebendo
 * pedido AGORA. O caminho novo tem que ser uma adição, nunca uma troca — se ele
 * falhar, o antigo continua entregando pedido na cozinha e ninguém percebe.
 */

export interface Loja99 {
  id: string;
  userId: string;
  label: string | null;
  appShopId: string;
  shopId: string | null;
  connected: boolean;
  active: boolean;
}

/** A tabela existe? Consultada uma vez por processo — ela não vai e volta. */
let tabelaOk: boolean | null = null;
async function temTabela(): Promise<boolean> {
  if (tabelaOk !== null) return tabelaOk;
  try {
    const r = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'Food99Store'
    `;
    tabelaOk = Array.isArray(r) && r.length > 0;
  } catch {
    tabelaOk = false;
  }
  return tabelaOk;
}

/** Lojas ATIVAS da conta. Vazio quando a tabela não existe — quem chama decide. */
export async function lojas99DaConta(userId: string): Promise<Loja99[]> {
  if (!(await temTabela())) return [];
  try {
    return await prisma.$queryRaw<Loja99[]>`
      SELECT "id","userId","label","appShopId","shopId","connected","active"
      FROM "Food99Store"
      WHERE "userId" = ${userId} AND "active" = true
      ORDER BY "createdAt" ASC
    `;
  } catch {
    return [];
  }
}

/**
 * De quem é este vínculo? É a pergunta que o webhook faz a cada pedido.
 *
 * Devolve o `userId` dono do `app_shop_id`. Sem acerto na tabela, cai nas
 * colunas antigas — inclusive no caso em que o app_shop_id É o id da conta,
 * que é como a Brasa Burguer está conectada hoje.
 */
export async function donoDoAppShopId(appShopId: string): Promise<string | null> {
  if (await temTabela()) {
    try {
      const r = await prisma.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "Food99Store"
        WHERE "appShopId" = ${appShopId} AND "active" = true
        LIMIT 1
      `;
      if (Array.isArray(r) && r[0]?.userId) return r[0].userId;
    } catch {
      // cai no plano B abaixo
    }
  }
  const antigo = await prisma.user.findFirst({
    where: { food99AppId: appShopId },
    select: { id: true },
  });
  return antigo?.id ?? null;
}

/** Mesma pergunta, pelo shop_id do 99Food (o id da loja no lado deles). */
export async function donoDoShopId(shopId: string): Promise<string | null> {
  if (await temTabela()) {
    try {
      const r = await prisma.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "Food99Store"
        WHERE "shopId" = ${shopId} AND "active" = true
        LIMIT 1
      `;
      if (Array.isArray(r) && r[0]?.userId) return r[0].userId;
    } catch {
      // cai no plano B abaixo
    }
  }
  const antigo = await prisma.user.findFirst({
    where: { food99MerchantId: shopId, role: "FRANCHISEE" },
    select: { id: true },
  });
  return antigo?.id ?? null;
}

/**
 * Grava (ou atualiza) uma loja da conta.
 *
 * `appShopId` é único no sistema inteiro, não por conta: duas contas
 * reivindicando o mesmo vínculo é exatamente como pedido cai na cozinha errada.
 * Por isso o conflito ATUALIZA em vez de criar linha nova.
 */
export async function salvarLoja99(dados: {
  userId: string;
  appShopId: string;
  shopId?: string | null;
  label?: string | null;
}): Promise<boolean> {
  if (!(await temTabela())) return false;
  try {
    await prisma.$executeRaw`
      INSERT INTO "Food99Store" ("id","userId","label","appShopId","shopId","connected","active","createdAt","updatedAt")
      VALUES (${randomUUID()}, ${dados.userId}, ${dados.label ?? null}, ${dados.appShopId}, ${dados.shopId ?? null}, true, true, NOW(), NOW())
      ON CONFLICT ("appShopId") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "label" = COALESCE(EXCLUDED."label", "Food99Store"."label"),
        "shopId" = COALESCE(EXCLUDED."shopId", "Food99Store"."shopId"),
        "connected" = true,
        "active" = true,
        "updatedAt" = NOW()
    `;
    return true;
  } catch (e: any) {
    console.error("[99Food lojas] Falha ao salvar loja:", e?.message);
    return false;
  }
}

/**
 * Desliga UMA loja, sem tocar nas outras da conta.
 *
 * `active = false` em vez de DELETE: o histórico de qual vínculo já existiu é o
 * que permite entender um pedido antigo depois. E religar é uma linha, não um
 * cadastro novo.
 */
export async function desativarLoja99(userId: string, appShopId: string): Promise<boolean> {
  if (!(await temTabela())) return false;
  try {
    const n = await prisma.$executeRaw`
      UPDATE "Food99Store"
      SET "active" = false, "connected" = false, "updatedAt" = NOW()
      WHERE "userId" = ${userId} AND "appShopId" = ${appShopId}
    `;
    return Number(n) > 0;
  } catch (e: any) {
    console.error("[99Food lojas] Falha ao desativar loja:", e?.message);
    return false;
  }
}

/**
 * Quantas lojas do 99Food a conta tem ativas — é o número que a fatura usa.
 *
 * `lib/billing.ts` cobra `(lojas - 1) * EXTRA_STORE_FEE`: a primeira é grátis,
 * cada adicional custa R$50/mês. Antes disto o valor vinha de um booleano e
 * nunca passava de 1, então a conta dava sempre zero — a regra existia no
 * código e nunca cobrou.
 *
 * O plano B importa aqui mais do que em qualquer outro lugar: com a tabela
 * vazia, contar 0 apagaria a cobrança de quem já é cobrado. Por isso, sem
 * linhas, vale o booleano antigo.
 */
export async function contarLojas99(userId: string, food99ConnectedAntigo: boolean): Promise<number> {
  if (await temTabela()) {
    try {
      const r = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n FROM "Food99Store"
        WHERE "userId" = ${userId} AND "active" = true AND "connected" = true
      `;
      const n = Number(r?.[0]?.n ?? 0);
      if (n > 0) return n;
    } catch {
      // cai no plano B abaixo
    }
  }
  return food99ConnectedAntigo ? 1 : 0;
}
