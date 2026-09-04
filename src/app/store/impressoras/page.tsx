import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { lojas99DaConta } from "@/lib/food99-lojas";
import { chaveIfood, chave99Food, chaveLojaPropria } from "@/lib/loja-de-origem";
import PrinterSetupClient, { type LojaDeOrigem } from "./PrinterSetupClient";

/**
 * As lojas de origem que uma impressora pode escolher receber.
 *
 * Só vale a pena mostrar quando há o que separar: mais de uma loja no iFood,
 * mais de uma no 99Food, ou um grupo de lojas (o painel com "Todas as Lojas"
 * imprime pedido de cada uma pela configuração de quem está logado). Com uma
 * loja só por integração, o chip de canal ("iFood") das categorias já resolve
 * e esta lista não aparece.
 */
async function lojasDeOrigemDaConta(ownerId: string, accountGroupId: string | null): Promise<LojaDeOrigem[]> {
  const masterId = accountGroupId || ownerId;
  const lojasDoGrupo = await prisma.user.findMany({
    where: { OR: [{ id: masterId }, { accountGroupId: masterId }] },
    select: { id: true, storeName: true, name: true, ifoodMerchantId: true },
    orderBy: { createdAt: "asc" },
  });
  const grupo = lojasDoGrupo.length > 0 ? lojasDoGrupo : [{ id: ownerId, storeName: null, name: null, ifoodMerchantId: null }];
  const nomeDaLoja = (l: { storeName: string | null; name: string | null }) => l.storeName || l.name || "Minha loja";
  const sufixo = (l: { id: string; storeName: string | null; name: string | null }) =>
    grupo.length > 1 && l.id !== ownerId ? ` (${nomeDaLoja(l)})` : "";

  // iFood: a tabela multi-loja + o merchant principal do User, que pode não
  // ter linha na tabela. O nome do principal vem do último pedido dele — o
  // User guarda só o UUID.
  const integracoes = await prisma.ifoodIntegration.findMany({
    where: { userId: { in: grupo.map((l) => l.id) }, active: true },
    select: { userId: true, label: true, merchantId: true },
    orderBy: { createdAt: "asc" },
  });
  const ifood: LojaDeOrigem[] = [];
  const vistos = new Set<string>();
  for (const l of grupo) {
    for (const i of integracoes.filter((x) => x.userId === l.id)) {
      if (!i.merchantId || vistos.has(i.merchantId)) continue;
      vistos.add(i.merchantId);
      ifood.push({ chave: chaveIfood(i.merchantId), nome: (i.label || "Loja iFood") + sufixo(l), emoji: "🍔", origem: "iFood" });
    }
    if (l.ifoodMerchantId && !vistos.has(l.ifoodMerchantId)) {
      vistos.add(l.ifoodMerchantId);
      const ultimo = await (prisma.customerOrder as any).findFirst({
        where: { franchiseeId: l.id, ifoodStoreMerchant: l.ifoodMerchantId, ifoodStoreName: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { ifoodStoreName: true },
      }).catch(() => null);
      ifood.push({ chave: chaveIfood(l.ifoodMerchantId), nome: (ultimo?.ifoodStoreName || "Loja principal") + sufixo(l), emoji: "🍔", origem: "iFood" });
    }
  }

  const food99: LojaDeOrigem[] = [];
  for (const l of grupo) {
    for (const s of await lojas99DaConta(l.id)) {
      const id = s.appShopId || s.shopId;
      if (!id) continue;
      food99.push({ chave: chave99Food(id), nome: (s.label || `Loja ${id}`) + sufixo(l), emoji: "🟡", origem: "99Food" });
    }
  }

  const haOQueSeparar = ifood.length > 1 || food99.length > 1 || grupo.length > 1;
  if (!haOQueSeparar) return [];

  // A própria loja: o que entra pelos canais dela (site, WhatsApp, mesa,
  // balcão, totem). É um chip por loja do grupo, para a impressora da cozinha
  // da pizza receber "iFood · Ragnar Pizza" E os pedidos do site, se quiser.
  const proprias: LojaDeOrigem[] = grupo.map((l) => ({
    chave: chaveLojaPropria(l.id),
    nome: `${nomeDaLoja(l)} · site, WhatsApp, mesa e balcão`,
    emoji: "🏪",
    origem: "Loja",
  }));

  return [...ifood, ...food99, ...proprias];
}

export default async function ImpressorasPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");

  const me = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true },
  });
  if (!me) redirect("/");

  // Mesma resolucao de dono usada pelo PUT/GET de /api/store/printer-config
  const ownerId = me.ownerId || me.id;
  const user = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, storeName: true, printerConfig: true, slug: true, accountGroupId: true },
  });
  if (!user) redirect("/");

  const lojasDeOrigem = await lojasDeOrigemDaConta(ownerId, (user as any).accountGroupId || null).catch(() => [] as LojaDeOrigem[]);

  // `franchiseeId` NAO estava aqui: a consulta varria o banco inteiro e a tela
  // oferecia as categorias de TODAS as franquias. O lojista via dezenas de
  // chips que nao existem no cardapio dele, e marcar um deles configurava a
  // impressora para uma categoria que nenhum produto seu tem — a impressora
  // ficava muda e ninguem entendia por que.
  const products = await prisma.menuProduct.findMany({
    where: { franchiseeId: ownerId, active: true },
    select: {
      id: true,
      name: true,
      category: true,
      price: true,
      comboGroups: { select: { id: true } },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  // Produtos que existem so para preencher a pergunta de um combo — os
  // "Adicionais". Eles nunca viajam sozinhos num pedido: saem impressos DENTRO
  // do combo que os contem. Oferecer "Adicionais" como categoria de impressora
  // e uma armadilha: o lojista marca, e nada nunca sai por ali.
  const usadosComoOpcao = new Set(
    (
      await prisma.comboGroupItem.findMany({
        where: { comboGroup: { menuProduct: { franchiseeId: ownerId } } },
        select: { menuProductId: true },
      })
    ).map((i) => i.menuProductId)
  );

  const ehSoOpcaoDeCombo = (p: (typeof products)[number]) =>
    usadosComoOpcao.has(p.id) && p.comboGroups.length === 0 && (Number(p.price) || 0) <= 0;

  // A categoria so desaparece quando TODOS os produtos dela sao opcao de combo.
  // Uma categoria de verdade que por acaso tenha um item gratis continua na
  // lista — quem some e a que existe so para guardar adicional.
  const porCategoria = new Map<string, { total: number; opcoes: number }>();
  for (const p of products) {
    const nome = (p.category || "").trim();
    if (!nome) continue;
    const reg = porCategoria.get(nome) || { total: 0, opcoes: 0 };
    reg.total++;
    if (ehSoOpcaoDeCombo(p)) reg.opcoes++;
    porCategoria.set(nome, reg);
  }

  const categories = [...porCategoria.entries()]
    .filter(([, reg]) => reg.opcoes < reg.total)
    .map(([nome]) => nome);

  return (
    <PrinterSetupClient
      storeName={user.storeName || ""}
      // O QR da comanda de teste aponta para o app do motoboy DESTA loja,
      // e a URL é montada pelo slug — o printerConfig do banco não o tem.
      storeSlug={user.slug || ""}
      franchiseeId={ownerId}
      initialConfig={user.printerConfig as any}
      categories={categories}
      lojasDeOrigem={lojasDeOrigem}
    />
  );
}
