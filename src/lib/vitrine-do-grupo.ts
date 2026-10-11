import { prisma } from "@/lib/prisma";
import { slugAtualDeUmAntigo } from "@/lib/slug-da-loja";
import { bairrosAtendidos, modoDaArea } from "@/lib/area-de-entrega";
import { estadoDaLoja } from "@/lib/loja-aberta";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { bairroDoEndereco, bairrosDoGrupo, type BairroDaLista } from "@/lib/escolha-de-loja-do-grupo";
import { aplicarConfigNasLojas, lerConfigDaPaginaDoGrupo, type ConfigDaPaginaDoGrupo } from "@/lib/pagina-do-grupo-config";

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
  storeBannerVideo: true,
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
  /** O bairro onde a loja fica (do endereço), para o cliente saber qual é a mais perto. */
  bairro: string | null;
  telefone: string | null;
  logo: string | null;
  capa: string | null;
  /** Vídeo da capa (a loja pode ter só o vídeo, sem foto: Pizzaria 17). */
  capaVideo: string | null;
  aberta: boolean;
  estado: string;
  soDelivery: boolean;
  principal: boolean;
  /** Para o "Como chegar". Nulo quando a loja esconde o endereço no cardápio. */
  ponto: { lat: number; lng: number } | null;
  /**
   * O que o navegador precisa para recalcular "Aberta/Fechada" na hora: a
   * página fica 60 s em cache e a primeira visita depois do prazo recebe a
   * versão velha (o texto das 2h da manhã às 19h). Horário já é público no
   * cardápio.
   */
  horario: { storeHours: unknown; storePause: unknown; storeOpen: boolean | null; timezone: string | null };
};

export type VitrineDoGrupo = {
  nomeDoGrupo: string;
  /** A frase do topo; vazia = a frase padrão da tela. */
  frase: string;
  /** Cor dos botões; vazia = a padrão. */
  cor: string;
  logo: string | null;
  capa: string | null;
  capaVideo: string | null;
  lojas: LojaNaVitrine[];
  bairros: BairroDaLista[];
};

/**
 * A configuração da página, gravada na principal. Lida por SQL e não pelo
 * cliente Prisma: a coluna nasce pelo garantir-colunas e quem roda com um
 * cliente gerado antes dela (ou com a coluna ainda não criada) recebe a
 * página padrão em vez de um erro 500 no link divulgado.
 */
export async function lerConfigDoGrupo(principalId: string): Promise<ConfigDaPaginaDoGrupo> {
  try {
    const linhas = await prisma.$queryRaw<{ paginaDoGrupo: unknown }[]>`SELECT "paginaDoGrupo" FROM "User" WHERE id = ${principalId}`;
    return lerConfigDaPaginaDoGrupo(linhas[0]?.paginaDoGrupo);
  } catch {
    return lerConfigDaPaginaDoGrupo(null);
  }
}

export async function gravarConfigDoGrupo(principalId: string, config: ConfigDaPaginaDoGrupo): Promise<void> {
  await prisma.$executeRaw`UPDATE "User" SET "paginaDoGrupo" = ${JSON.stringify(config)}::jsonb WHERE id = ${principalId}`;
}

/** O id da principal do grupo de uma loja. */
export function principalDoGrupo(loja: { id: string; accountGroupId?: string | null }): string {
  return loja.accountGroupId || loja.id;
}

/**
 * As lojas do grupo de quem tem este slug — principal primeiro — já na ordem
 * e sem as que o dono escondeu da página. Nulo se a loja não existe.
 */
export async function lojasVisiveisDoGrupo(slug: string) {
  const lojas = await lojasDoGrupoPeloSlug(slug);
  if (!lojas || lojas.length === 0) return null;
  const principal = lojas.find((l) => !l.accountGroupId) || lojas[0];
  const config = await lerConfigDoGrupo(principal.id);
  const visiveis = aplicarConfigNasLojas(lojas.map((l) => ({ ...l, nome: nomeDaLoja(l) })), config);
  return { principal, config, lojas: visiveis };
}

/**
 * O slug que vale hoje para um slug pedido: ele mesmo, ou o atual de uma loja
 * que trocou de nome (o link do grupo impresso no QR não pode morrer quando o
 * dono corrige o nome — mesma regra do /loja/[slug]). Nulo se não existe.
 */
export async function slugValido(slug: string): Promise<string | null> {
  const existe = await prisma.user.findUnique({ where: { slug }, select: { id: true } });
  if (existe) return slug;
  return slugAtualDeUmAntigo(prisma as any, slug);
}

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

/** O nome da loja como o cliente vê no cardápio. */
function nomeDaLoja(l: { storeName: string | null; name: string | null }): string {
  return (l.storeName || l.name || "Loja").trim();
}

export async function carregarVitrineDoGrupo(slug: string): Promise<VitrineDoGrupo | null> {
  const grupo = await lojasVisiveisDoGrupo(slug);
  if (!grupo) return null;
  const { principal, config, lojas } = grupo;

  const naVitrine: LojaNaVitrine[] = lojas.map((l) => {
    const estado = estadoDaLoja({ storeHours: l.storeHours, storePause: l.storePause, storeOpen: l.storeOpen, timezone: l.storeTimezone });
    return {
      id: l.id,
      slug: l.slug as string,
      nome: l.nome,
      cidade: l.city,
      endereco: l.showAddressOnMenu === false ? null : l.storeAddress,
      bairro: l.showAddressOnMenu === false ? null : bairroDoEndereco(l.storeAddress),
      telefone: l.storePhone,
      logo: l.storeLogo,
      capa: l.storeBanner || null,
      capaVideo: l.storeBannerVideo || null,
      aberta: estado.aberta,
      estado: estado.texto.replace(/^A loja está /, "").replace(/^./, (c) => c.toUpperCase()),
      soDelivery: !!l.storeDeliveryOnly,
      principal: l.id === principal.id,
      ponto: l.showAddressOnMenu === false ? null : lerPontoDaLoja(l.storeLatLng),
      horario: { storeHours: l.storeHours ?? null, storePause: l.storePause ?? null, storeOpen: l.storeOpen, timezone: l.storeTimezone },
    };
  });

  const bairros = bairrosDoGrupo(
    lojas
      .filter((l) => modoDaArea(l) === "BAIRRO")
      .map((l) => ({ cidade: l.city, bairros: bairrosAtendidos(l).map((b) => b.name) })),
  );

  // A capa do topo é a de UMA loja inteira (foto e vídeo juntos): a escolhida
  // pelo dono, senão a principal, senão a primeira que tiver alguma capa.
  const temCapa = (l: { storeBanner: string | null; storeBannerVideo: string | null }) => !!(l.storeBanner || l.storeBannerVideo);
  const daCapa =
    (config.capaDaLoja ? lojas.find((l) => l.id === config.capaDaLoja && temCapa(l)) : null) ||
    (temCapa(principal) ? principal : null) ||
    lojas.find(temCapa) ||
    null;
  return {
    nomeDoGrupo: config.titulo || nomeDaLoja(principal),
    frase: config.frase,
    cor: config.cor,
    logo: principal.storeLogo || naVitrine.find((l) => l.logo)?.logo || null,
    capa: daCapa?.storeBanner || null,
    capaVideo: daCapa?.storeBannerVideo || null,
    lojas: naVitrine,
    bairros,
  };
}
