import { prisma } from "@/lib/prisma";
import { bairrosAtendidos, modoDaArea } from "@/lib/area-de-entrega";
import { estadoDaLoja } from "@/lib/loja-aberta";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { bairrosDoGrupo, type BairroDaLista } from "@/lib/escolha-de-loja-do-grupo";

/**
 * O que a página de entrada do grupo (/lojas/[slug]) carrega: as lojas do
 * grupo com o que o CLIENTE pode ver. Vai inteiro para o HTML — nada de área
 * de entrega crua, taxa do entregador ou configuração aqui (a escolha roda no
 * servidor, em /api/lojas/[slug]/qual-loja).
 */

export const SELECT_DA_LOJA_NA_VITRINE = {
  id: true,
  slug: true,
  name: true,
  storeName: true,
  storeLogo: true,
  storeBanner: true,
  storePhone: true,
  storeAddress: true,
  showAddressOnMenu: true,
  city: true,
  storeHours: true,
  storeTimezone: true,
  storeOpen: true,
  storePause: true,
  storeDeliveryOnly: true,
  storeLatLng: true,
  deliveryZones: true,
  deliveryZoneType: true,
  deliveryConfig: true,
  accountGroupId: true,
  isPrimaryStore: true,
  role: true,
} as const;

export type LojaNaVitrine = {
  id: string;
  slug: string;
  nome: string;
  cidade: string | null;
  endereco: string | null;
  telefone: string | null;
  logo: string | null;
  capa: string | null;
  aberta: boolean;
  estado: string;
  soDelivery: boolean;
  principal: boolean;
  /** Para o "fica a X km de você" quando o cliente usa o GPS (o ponto é o mesmo do mapa público). */
  ponto: { lat: number; lng: number } | null;
};

export type VitrineDoGrupo = {
  nomeDoGrupo: string;
  logo: string | null;
  capa: string | null;
  lojas: LojaNaVitrine[];
  bairros: BairroDaLista[];
};

/** As lojas do grupo de quem tem este slug — principal primeiro. Nulo se a loja não existe. */
export async function lojasDoGrupoPeloSlug(slug: string) {
  const loja = await prisma.user.findUnique({ where: { slug }, select: { id: true, accountGroupId: true, role: true } });
  if (!loja || (loja.role && loja.role !== "FRANCHISEE")) return null;
  const principal = loja.accountGroupId || loja.id;
  const lojas = await prisma.user.findMany({
    where: { OR: [{ id: principal }, { accountGroupId: principal }], slug: { not: null } },
    select: SELECT_DA_LOJA_NA_VITRINE,
    orderBy: [{ isPrimaryStore: "desc" }, { createdAt: "asc" }],
  });
  return lojas.filter((l) => !l.role || l.role === "FRANCHISEE");
}

/** Nome comum do grupo: o da principal sem o sufixo da unidade ("PIZZARIA 17 AEROPORTO" → irmã de "PIZZARIA 17"). */
function nomeDaLoja(l: { storeName: string | null; name: string | null }): string {
  return (l.storeName || l.name || "Loja").trim();
}

export async function carregarVitrineDoGrupo(slug: string): Promise<VitrineDoGrupo | null> {
  const lojas = await lojasDoGrupoPeloSlug(slug);
  if (!lojas || lojas.length === 0) return null;
  const principal = lojas.find((l) => !l.accountGroupId) || lojas[0];

  const naVitrine: LojaNaVitrine[] = lojas.map((l) => {
    const estado = estadoDaLoja({ storeHours: l.storeHours, storePause: l.storePause, storeOpen: l.storeOpen, timezone: l.storeTimezone });
    return {
      id: l.id,
      slug: l.slug as string,
      nome: nomeDaLoja(l),
      cidade: l.city,
      endereco: l.showAddressOnMenu === false ? null : l.storeAddress,
      telefone: l.storePhone,
      logo: l.storeLogo,
      capa: l.storeBanner,
      aberta: estado.aberta,
      estado: estado.texto.replace(/^A loja está /, "").replace(/^./, (c) => c.toUpperCase()),
      soDelivery: !!l.storeDeliveryOnly,
      principal: l.id === principal.id,
      ponto: lerPontoDaLoja(l.storeLatLng),
    };
  });

  const bairros = bairrosDoGrupo(
    lojas
      .filter((l) => modoDaArea(l) === "BAIRRO")
      .map((l) => ({ cidade: l.city, bairros: bairrosAtendidos(l).map((b) => b.name) })),
  );

  return {
    nomeDoGrupo: nomeDaLoja(principal),
    logo: principal.storeLogo || naVitrine.find((l) => l.logo)?.logo || null,
    capa: principal.storeBanner || naVitrine.find((l) => l.capa)?.capa || null,
    lojas: naVitrine,
    bairros,
  };
}
