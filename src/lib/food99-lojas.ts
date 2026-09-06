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

/**
 * Os identificadores que uma conta usa no 99Food, e o próximo livre.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O `app_shop_id` que mandamos no `getUrl` viaja dentro do link e vira o id do
 * vínculo. Até aqui ele era sempre o id da conta — então a conta inteira tinha
 * UM identificador, e uma conta com três estabelecimentos no 99Food tentava
 * vincular os três sob o mesmo id. Só pode existir um vínculo por id: foi
 * exatamente o que aconteceu com o Lucas em 06/09/2026, dois estabelecimentos
 * autorizados com o mesmo link.
 *
 * A regra: a primeira loja fica com o id da conta (compatível com tudo que já
 * está conectado); as seguintes ganham `<id>-2`, `<id>-3`, … O número é
 * derivado das lojas já gravadas, então gerar o link duas vezes sem autorizar
 * dá o mesmo slot — e não deixa buraco.
 *
 * `conhecidos` é o que se consulta para saber quem está conectado;
 * `proximo` é o que se consulta para PEGAR uma loja recém-autorizada que ainda
 * não tem linha — e o que o botão "Conectar outra loja" usa no link.
 */
export function slotsDaConta(lojaId: string, lojas: Loja99[]): { conhecidos: string[]; proximo: string } {
  const conhecidos = Array.from(new Set([lojaId, ...lojas.map((l) => l.appShopId)]));

  const padrao = new RegExp(`^${lojaId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-(\\d+))?$`);
  let maior = 1;
  for (const id of conhecidos) {
    const m = padrao.exec(id);
    if (!m) continue;
    const n = m[1] ? Number(m[1]) : 1;
    if (n > maior) maior = n;
  }

  return { conhecidos, proximo: `${lojaId}-${maior + 1}` };
}

/**
 * Todo app_shop_id que JÁ tem dono, e de quem é. Chave = app_shop_id.
 *
 * ── O buraco que isto fecha ─────────────────────────────────────────────────
 *
 * /api/99food/conectar procura "vínculos órfãos" no 99Food para adotar o da
 * loja que acabou de autorizar, e montava a lista de tomados lendo SÓ
 * `User.food99AppId`. Em produção, em 06/09/2026, esse campo estava nulo em
 * TODAS as contas — inclusive na Brasa Burguer, que recebe pedido do 99Food
 * todo dia e mora na `Food99Store`. O caminho de sucesso (`comNomeDaLoja`)
 * grava na tabela e não mexe na coluna, então quem conecta direito some da
 * lista de tomados.
 *
 * Resultado: a loja da Brasa Burguer contava como órfã para qualquer outro
 * lojista. Com um órfão só ela era adotada sozinha; com mais de um ela
 * aparecia na pergunta "qual destas é a sua?". E o `ON CONFLICT` do
 * `salvarLoja99` troca o `userId` — ou seja, os pedidos dela passariam a cair
 * na cozinha de outra loja, e ninguém saberia por quê.
 *
 * Inclui linha inativa de propósito: `active = false` é uma loja que saiu do
 * FireHub, mas o vínculo continua de pé no 99Food e o dono continua sendo
 * quem era. Deixar essa reaparecer como órfã para o vizinho é o mesmo estrago.
 */
export async function donosPorAppShopId(): Promise<Map<string, string>> {
  const donos = new Map<string, string>();

  if (await temTabela()) {
    try {
      const linhas = await prisma.$queryRaw<{ appShopId: string; userId: string }[]>`
        SELECT "appShopId", "userId" FROM "Food99Store"
      `;
      for (const l of linhas) if (l.appShopId) donos.set(l.appShopId, l.userId);
    } catch {
      // segue com o que der — as colunas antigas abaixo ainda entram
    }
  }

  // As colunas antigas continuam valendo: elas são o vínculo de quem conectou
  // antes da tabela existir, e some delas nada é migrado automaticamente.
  const antigos = await prisma.user.findMany({
    where: { food99AppId: { not: null } },
    select: { id: true, food99AppId: true },
  });
  for (const u of antigos) if (u.food99AppId) donos.set(u.food99AppId, u.id);

  return donos;
}

/**
 * Mesma pergunta de donosPorAppShopId, pelo `shop_id` do 99Food. Chave =
 * shop_id. É o que impede a etapa 2 (shopBind) de vincular a loja do vizinho:
 * o `getAuthorizedShops` lista TODAS as lojas autorizadas ao app, de todas as
 * contas, e uma que já tem dono aqui dentro não é candidata para mais ninguém.
 */
export async function donosPorShopId(): Promise<Map<string, string>> {
  const donos = new Map<string, string>();

  if (await temTabela()) {
    try {
      const linhas = await prisma.$queryRaw<{ shopId: string | null; userId: string }[]>`
        SELECT "shopId", "userId" FROM "Food99Store"
      `;
      for (const l of linhas) if (l.shopId) donos.set(l.shopId, l.userId);
    } catch {
      // segue com as colunas antigas
    }
  }

  const antigos = await prisma.user.findMany({
    where: { food99MerchantId: { not: null } },
    select: { id: true, food99MerchantId: true },
  });
  for (const u of antigos) if (u.food99MerchantId) donos.set(u.food99MerchantId, u.id);

  return donos;
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
