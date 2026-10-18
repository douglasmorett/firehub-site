/**
 * QUEM É QUEM NO APP — junta aparelhos, pedidos e clientes para a
 * notificação direcionada (segmentos.ts) e para a atribuição de pedidos aos
 * envios (resultado-dos-envios.ts). Só servidor.
 *
 * O aparelho conhece o cliente pelos PEDIDOS feitos nele (o telefone digitado
 * no pedido): PedidoAparelho liga token → pedido, AppDaLojaPedido liga
 * instalação → pedido. Nunca pelo telefone sozinho.
 */
import { prisma } from "@/lib/prisma";
import { telefoneCanonico } from "@/lib/telefone";
import { STATUS_FORA_DA_VENDA } from "@/lib/relatorios/base";
import { SEM_REPOSICAO } from "@/lib/relatorios/sem-reposicao";
import { entraNaVenda } from "@/lib/relatorios/regua-da-venda";
import { garantirTabelaDoAppDaLoja } from "@/lib/app-da-loja/aparelhos";
import { garantirEstruturaDasInstalacoes, lerBase, type AppDaConta } from "@/lib/app-da-loja/instalacoes";
import { juntarBase, type AparelhoDaBase } from "@/lib/app-da-loja/regras-do-push";
import { mesDiaDoAniversario, type AparelhoDoSegmento, type ClienteDoSegmento } from "@/lib/app-da-loja/segmentos";

const DIA_MS = 24 * 60 * 60 * 1000;

/** Um pedido feito pelo app e as chaves do aparelho que o fez ("token" e "i:<instalação>"). */
export type PedidoDoAppComChaves = { id: string; em: Date; telefone: string; chaves: string[] };

export type Perfis = {
  base: AparelhoDaBase[];
  /** Quem pode receber promoção, já com telefones e pedidos no app. */
  aparelhos: (AparelhoDoSegmento & { instalacaoId: string | null })[];
  clientes: Map<string, ClienteDoSegmento>;
  pedidosDoApp: PedidoDoAppComChaves[];
  /** token → instalação (para gravar os dois como destino do envio). */
  instalacaoDoToken: Map<string, string>;
};

/** Os pedidos feitos pelo app desde `desde`, com as chaves do aparelho. */
export async function pedidosDoAppComChaves(app: Pick<AppDaConta, "chave" | "lojaIds">, desde: Date): Promise<PedidoDoAppComChaves[]> {
  const [okP, okA] = await Promise.all([garantirTabelaDoAppDaLoja(), garantirEstruturaDasInstalacoes()]);
  const iso = desde.toISOString();
  const linhas: { pedidoId: string; chave: string; customerPhone: string | null; createdAt: Date }[] = [];
  if (okP) {
    linhas.push(...(await prisma.$queryRaw<typeof linhas>`
      SELECT pa."pedidoId", pa."pushToken" AS chave, o."customerPhone", o."createdAt"
      FROM "PedidoAparelho" pa JOIN "CustomerOrder" o ON o."id" = pa."pedidoId"
      WHERE pa."lojaId" = ANY(${app.lojaIds}::text[]) AND o."createdAt" >= (${iso}::timestamptz AT TIME ZONE 'UTC')`));
  }
  if (okA) {
    linhas.push(...(await prisma.$queryRaw<typeof linhas>`
      SELECT ap."pedidoId", ('i:' || ap."instalacaoId") AS chave, o."customerPhone", o."createdAt"
      FROM "AppDaLojaPedido" ap JOIN "CustomerOrder" o ON o."id" = ap."pedidoId"
      WHERE ap."lojaId" = ANY(${app.lojaIds}::text[]) AND ap."instalacaoId" IS NOT NULL
        AND o."createdAt" >= (${iso}::timestamptz AT TIME ZONE 'UTC')`));
  }
  const porPedido = new Map<string, PedidoDoAppComChaves>();
  for (const l of linhas) {
    const p = porPedido.get(l.pedidoId) || { id: l.pedidoId, em: new Date(l.createdAt), telefone: telefoneCanonico(l.customerPhone), chaves: [] };
    if (l.chave && !p.chaves.includes(l.chave)) p.chaves.push(l.chave);
    porPedido.set(l.pedidoId, p);
  }
  return [...porPedido.values()];
}

/** Monta tudo de uma vez. `agora` só para o recorte de 120 dias. */
export async function carregarPerfis(app: Pick<AppDaConta, "chave" | "lojaIds">, agora: Date = new Date()): Promise<Perfis> {
  const { aberturas, pedidos } = await lerBase(app);
  const base = juntarBase(aberturas, pedidos);
  const instalacaoDoToken = new Map<string, string>();
  for (const a of aberturas) if (a.pushToken && !a.removidoEm) instalacaoDoToken.set(a.pushToken, a.instalacaoId);

  const desde = new Date(agora.getTime() - 120 * DIA_MS);
  const pedidosDoApp = await pedidosDoAppComChaves(app, new Date(agora.getTime() - 365 * DIA_MS));

  // Telefones de cada chave de aparelho (token e "i:instalação").
  const telefonesDaChave = new Map<string, Set<string>>();
  const pedidosNoAppDaChave = new Map<string, number>();
  for (const p of pedidosDoApp) {
    for (const c of p.chaves) {
      pedidosNoAppDaChave.set(c, (pedidosNoAppDaChave.get(c) || 0) + 1);
      if (p.telefone) (telefonesDaChave.get(c) || telefonesDaChave.set(c, new Set()).get(c)!).add(p.telefone);
    }
  }

  const aparelhos: Perfis["aparelhos"] = [];
  for (const a of base) {
    if (!a.promocoes || !a.pushToken) continue;
    const inst = a.chave.startsWith("i:") ? a.chave.slice(2) : null;
    const chaves = [a.pushToken, ...(inst ? [`i:${inst}`] : [])];
    const telefones = new Set<string>();
    let noApp = 0;
    for (const c of chaves) {
      telefonesDaChave.get(c)?.forEach((t) => telefones.add(t));
      noApp += pedidosNoAppDaChave.get(c) || 0;
    }
    aparelhos.push({ pushToken: a.pushToken, instalacaoId: inst, ultimaAbertura: a.ultimaAbertura, telefones: [...telefones], pedidosNoApp: noApp });
  }

  // Os clientes desses telefones: pedidos de TODOS os canais nos últimos 120 dias.
  const telefones = new Set(aparelhos.flatMap((a) => a.telefones));
  const clientes = new Map<string, ClienteDoSegmento>();
  if (telefones.size) {
    const pedidosDaLoja = await prisma.customerOrder.findMany({
      where: { franchiseeId: { in: app.lojaIds }, createdAt: { gte: desde }, status: { notIn: [...STATUS_FORA_DA_VENDA] }, ...SEM_REPOSICAO },
      select: { id: true, status: true, totalAmount: true, createdAt: true, customerPhone: true, customerId: true, items: { select: { menuProductId: true } } },
    });
    const ids = new Set<string>();
    const clienteDoTelefone = new Map<string, string>();
    const meus = pedidosDaLoja.filter((p) => {
      const t = telefoneCanonico(p.customerPhone);
      if (!t || !telefones.has(t) || !entraNaVenda(p as any)) return false;
      p.items.forEach((i) => i.menuProductId && ids.add(i.menuProductId));
      if (p.customerId) clienteDoTelefone.set(t, p.customerId);
      return true;
    });
    const categorias = new Map(
      (ids.size ? await prisma.menuProduct.findMany({ where: { id: { in: [...ids] } }, select: { id: true, category: true } }) : [])
        .map((m) => [m.id, String(m.category || "")]),
    );
    const aniversarios = new Map(
      (clienteDoTelefone.size
        ? await prisma.storeCustomer.findMany({ where: { id: { in: [...new Set(clienteDoTelefone.values())] } }, select: { id: true, birthDate: true } })
        : []
      ).map((c) => [c.id, mesDiaDoAniversario(c.birthDate)]),
    );
    for (const p of meus) {
      const t = telefoneCanonico(p.customerPhone);
      const c = clientes.get(t) || { pedidos: [], ultimoPedidoEm: null, aniversario: null };
      const produtos = p.items.map((i) => i.menuProductId).filter((x): x is string => !!x);
      c.pedidos.push({ em: p.createdAt, valor: Number(p.totalAmount) || 0, produtos, categorias: [...new Set(produtos.map((id) => categorias.get(id) || "").filter(Boolean))] });
      if (!c.ultimoPedidoEm || p.createdAt > c.ultimoPedidoEm) c.ultimoPedidoEm = p.createdAt;
      clientes.set(t, c);
    }
    // "Sumido" olha o último pedido de SEMPRE (não só dos 120 dias): quem
    // pediu há 5 meses é sumido, não desconhecido.
    const ultimos = await prisma.$queryRaw<{ customerPhone: string | null; ultimo: Date }[]>`
      SELECT "customerPhone", MAX("createdAt") AS ultimo FROM "CustomerOrder"
      WHERE "franchiseeId" = ANY(${app.lojaIds}::text[]) AND NOT ("status" = ANY(${[...STATUS_FORA_DA_VENDA]}::text[]))
      GROUP BY "customerPhone"`;
    for (const u of ultimos) {
      const t = telefoneCanonico(u.customerPhone);
      if (!t || !telefones.has(t)) continue;
      const c = clientes.get(t) || { pedidos: [], ultimoPedidoEm: null, aniversario: null };
      const em = new Date(u.ultimo);
      if (!c.ultimoPedidoEm || em > c.ultimoPedidoEm) c.ultimoPedidoEm = em;
      clientes.set(t, c);
    }
    for (const [t, id] of clienteDoTelefone) {
      const c = clientes.get(t);
      if (c) c.aniversario = aniversarios.get(id) ?? null;
    }
  }
  return { base, aparelhos, clientes, pedidosDoApp, instalacaoDoToken };
}
