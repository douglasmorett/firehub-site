import { prisma } from "@/lib/prisma";
import { lojas99DaConta } from "@/lib/food99-lojas";
import { chaveIfood, chave99Food, chaveLojaPropria, type LojaDeOrigem } from "@/lib/loja-de-origem";

/**
 * As lojas de origem de uma conta, com NOME — para a tela dizer de qual marca
 * é cada pedido, e para a impressora escolher de quais delas recebe.
 *
 * ── Por que saiu da tela de Impressoras ─────────────────────────────────────
 *
 * Esta montagem nasceu dentro de src/app/store/impressoras/page.tsx e servia só
 * ao seletor de impressora. Só que o quadro de pedidos precisa exatamente do
 * mesmo mapa: o selo "🏪 Frangoso" embaixo do canal saía só para o iFood, e
 * só porque o iFood grava `ifoodStoreName` na própria linha do pedido. O
 * 99Food não grava nada equivalente — o nome da loja dele vive em
 * `Food99Store.label` — e por isso o pedido do 99 chegava sem marca nenhuma no
 * painel do lojista que tem duas lojas lá (visto em 12/09/2026).
 *
 * Duplicar a montagem no quadro resolveria hoje e divergiria na primeira
 * integração nova. Aqui é um lugar só, e quem consome pergunta pela CHAVE do
 * pedido (`chavesDeLojaDoPedido`), sem saber de qual integração ele veio.
 *
 * ── Só aparece quando há o que separar ──────────────────────────────────────
 *
 * Mais de uma loja no iFood, mais de uma no 99Food, ou um grupo de lojas. Com
 * uma loja só por integração o nome seria a mesma palavra repetida em todo
 * pedido da tela — ruído puro.
 */
export async function lojasDeOrigemDaConta(ownerId: string, accountGroupId: string | null): Promise<LojaDeOrigem[]> {
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
      // O pedido do 99Food ora traz o app_shop_id, ora o shop_id, e as duas
      // apontam para a MESMA loja. Vão as duas em `chaves` — assim o nome é
      // encontrado de qualquer jeito — mas UM item só na lista: dois itens
      // fariam o seletor de impressora mostrar a loja repetida, e a conta de
      // "há o que separar" enxergaria duas lojas onde existe uma.
      const chaves = [chave99Food(id)];
      if (s.shopId && s.appShopId && s.shopId !== s.appShopId) chaves.push(chave99Food(s.shopId));
      food99.push({ chave: chave99Food(id), chaves, nome: (s.label || `Loja ${id}`) + sufixo(l), emoji: "🟡", origem: "99Food" });
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
