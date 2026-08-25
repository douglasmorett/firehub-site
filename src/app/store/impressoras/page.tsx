import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PrinterSetupClient from "./PrinterSetupClient";

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
    select: { id: true, storeName: true, printerConfig: true },
  });
  if (!user) redirect("/");

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
      franchiseeId={ownerId}
      initialConfig={user.printerConfig as any}
      categories={categories}
    />
  );
}
