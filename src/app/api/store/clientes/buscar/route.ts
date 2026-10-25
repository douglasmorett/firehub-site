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
 * ele mostraria a clientela de todas as lojas a qualquer lojista. E entra só
 * com o NOME: o endereço do cadastro solto é o que o cliente deu em OUTRA loja
 * (auditoria de 23/10/2026). O endereço vem dos pedidos desta loja ou do
 * cadastro trazido por ela — para quem já pediu aqui, sugerirClientes usa o
 * endereço dos pedidos, não o do cadastro.
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
import { digitosNacionais, lerConsulta, sugerirClientes, type CadastroParaBusca, type PedidoParaBusca } from "@/lib/busca-de-clientes";
import { edicoesParaBusca } from "@/lib/cadastro-do-cliente";

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

    // O "Editar cadastro" da loja: o nome e o endereço corrigidos vencem. Na
    // busca por nome, o "Cliente" que virou "João" aparece pelo nome novo —
    // com os pedidos dele, que a busca pelo nome antigo não trouxe.
    const chaves = [...new Set([...pedidos.map((p) => p.customerPhone), ...cadastros.map((c) => c.phone)]
      .map((t) => digitosNacionais(t))
      .filter((t) => t.length >= 10)
      .map((t) => t.slice(0, 2) + t.slice(-8)))];
    const editados = await edicoesParaBusca(ids, chaves.slice(0, 200), consulta.nome || null);
    const deFora = editados.filter((e) => !chaves.includes(e.chave)).map((e) => e.chave);
    if (deFora.length) pedidos.push(...(await pedidosPorChave(lojas, deFora)));

    return NextResponse.json({ clientes: sugerirClientes(consulta, pedidos, cadastros, editados) }, { headers: semCache });
  } catch (e: any) {
    // A busca é conforto do atendente: sem ela, ele digita como sempre.
    console.warn(`[clientes/buscar] falhou: ${e?.message || e}`);
    return NextResponse.json({ clientes: [], erro: true }, { headers: semCache });
  }
}

/** Os pedidos da loja dos clientes achados pelo nome corrigido (chave = DDD + 8 últimos dígitos). */
async function pedidosPorChave(lojas: Prisma.Sql, chaves: string[]): Promise<PedidoParaBusca[]> {
  try {
    const tel = nacional(Prisma.sql`"customerPhone"`);
    return await prisma.$queryRaw<PedidoParaBusca[]>(Prisma.sql`
      SELECT "customerName", "customerPhone", "customerAddress", "customerLatLng", "deliveryType", "createdAt"
      FROM "CustomerOrder"
      WHERE "franchiseeId" IN (${lojas})
        AND "tableSessionId" IS NULL
        AND length(${tel}) BETWEEN 10 AND 11
        AND left(${tel}, 2) || right(${tel}, 8) IN (${Prisma.join(chaves)})
      ORDER BY "createdAt" DESC
      LIMIT 120`);
  } catch (e: any) {
    console.warn(`[clientes/buscar] pedidos pelo nome corrigido falharam: ${e?.message || e}`);
    return [];
  }
}

async function buscarCadastros(lojas: Prisma.Sql, filtro: Prisma.Sql, numeroInteiro: string | null): Promise<CadastroParaBusca[]> {
  try {
    return await prisma.$queryRaw<CadastroParaBusca[]>(Prisma.sql`
      SELECT "name", "phone",
        CASE WHEN "lojaDeOrigemId" IN (${lojas}) THEN "address" END AS "address"
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
