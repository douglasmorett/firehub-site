/**
 * GET /api/store/clientes/buscar?q=2299  → { clientes: [...] }
 *
 * A lista suspensa do balcão: o atendente começa a digitar o telefone (ou o
 * nome) e recebe os clientes DESTA loja com número parecido, para clicar e
 * copiar nome, telefone e o último endereço (lib/busca-de-clientes.ts).
 *
 * De onde vem: pedidos da loja (qualquer canal) e cadastros ligados a ela
 * (StoreCustomer.lojaDeOrigemId — a base importada). O cadastro solto só
 * entra quando o número veio INTEIRO: StoreCustomer é global, e por prefixo
 * ele mostraria a clientela de todas as lojas a qualquer lojista.
 *
 * O telefone está gravado de qualquer jeito ("(22) 99276-1161",
 * "5522992761161", "22992761161"): o SQL normaliza para só dígitos sem o 55 e
 * casa o prefixo desde o DDD ou desde o número; a junção e a ordem são da lib.
 * A classe é '[^0-9]' e não '\D': conferido num Postgres local que '\D' não
 * limpava a máscara (lib/cashback-no-banco.ts usa a mesma classe).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { lerConsulta, sugerirClientes, type CadastroParaBusca, type PedidoParaBusca } from "@/lib/busca-de-clientes";

export const dynamic = "force-dynamic";

const semCache = { "Cache-Control": "no-store" };

/** As lojas desta conta — o mesmo recorte das outras rotas da loja (api/store/avisos). */
async function lojasDaSessao() {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email || "";
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
  if (!user) return null;
  const lojaId = user.ownerId || user.id;
  return [...new Set([lojaId, user.id, user.ownerId].filter(Boolean))] as string[];
}

/** O telefone da coluna como DDD+número: só dígitos, sem o 55 da frente. */
const nacional = (coluna: Prisma.Sql) => Prisma.sql`
  (CASE WHEN length(regexp_replace(${coluna}, '[^0-9]', '', 'g')) IN (12, 13)
          AND left(regexp_replace(${coluna}, '[^0-9]', '', 'g'), 2) = '55'
        THEN substr(regexp_replace(${coluna}, '[^0-9]', '', 'g'), 3)
        ELSE regexp_replace(${coluna}, '[^0-9]', '', 'g') END)`;

export async function GET(req: Request) {
  const ids = await lojasDaSessao();
  if (!ids) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const consulta = lerConsulta(new URL(req.url).searchParams.get("q"));
  if (!consulta) return NextResponse.json({ clientes: [] }, { headers: semCache });

  try {
    const lojas = Prisma.join(ids);
    // Prefixo desde o DDD, ou desde o número (com ou sem o 9); por nome, ILIKE.
    const casaTelefone = (coluna: Prisma.Sql) => Prisma.sql`(
      ${nacional(coluna)} LIKE ${consulta.digitos + "%"}
      OR substr(${nacional(coluna)}, 3) LIKE ${consulta.digitos + "%"}
      OR substr(${nacional(coluna)}, 4) LIKE ${consulta.digitos + "%"}
    )`;
    const filtroPedido = consulta.digitos
      ? casaTelefone(Prisma.sql`"customerPhone"`)
      : Prisma.sql`"customerName" ILIKE ${"%" + consulta.nome + "%"}`;
    const filtroCadastro = consulta.digitos
      ? casaTelefone(Prisma.sql`"phone"`)
      : Prisma.sql`"name" ILIKE ${"%" + consulta.nome + "%"}`;
    const numeroInteiro = consulta.digitos.length >= 10;

    const [pedidos, cadastros] = await Promise.all([
      prisma.$queryRaw<PedidoParaBusca[]>(Prisma.sql`
        SELECT "customerName", "customerPhone", "customerAddress", "customerLatLng", "deliveryType", "createdAt"
        FROM "CustomerOrder"
        WHERE "franchiseeId" IN (${lojas})
          AND "tableSessionId" IS NULL
          AND ${filtroPedido}
        ORDER BY "createdAt" DESC
        LIMIT 120`),
      buscarCadastros(lojas, filtroCadastro, numeroInteiro ? consulta.digitos : null),
    ]);

    return NextResponse.json({ clientes: sugerirClientes(consulta, pedidos, cadastros) }, { headers: semCache });
  } catch (e: any) {
    // A busca é conforto do atendente: sem ela, ele digita como sempre.
    console.warn(`[clientes/buscar] falhou: ${e?.message || e}`);
    return NextResponse.json({ clientes: [], erro: true }, { headers: semCache });
  }
}

async function buscarCadastros(lojas: Prisma.Sql, filtro: Prisma.Sql, numeroInteiro: string | null): Promise<CadastroParaBusca[]> {
  try {
    return await prisma.$queryRaw<CadastroParaBusca[]>(Prisma.sql`
      SELECT "name", "phone", "address"
      FROM "StoreCustomer"
      WHERE ("lojaDeOrigemId" IN (${lojas}) AND ${filtro})
         ${numeroInteiro ? Prisma.sql`OR ${nacional(Prisma.sql`"phone"`)} = ${numeroInteiro}` : Prisma.empty}
      LIMIT 40`);
  } catch (e: any) {
    // Coluna ainda não criada (boot que falhou): os pedidos da loja bastam.
    console.warn(`[clientes/buscar] cadastros indisponíveis: ${e?.message || e}`);
    return [];
  }
}
