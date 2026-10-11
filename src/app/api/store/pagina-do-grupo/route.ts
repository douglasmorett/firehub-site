import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bairrosAtendidos, modoDaArea } from "@/lib/area-de-entrega";
import { lerConfigDaPaginaDoGrupo } from "@/lib/pagina-do-grupo-config";
import { gravarConfigDoGrupo, lerConfigDoGrupo, principalDoGrupo } from "@/lib/vitrine-do-grupo";

/**
 * A página das suas lojas (/lojas/[slug]) vista do painel.
 *
 * GET: o link, a configuração e as lojas do grupo (com o que cada uma usa
 * para dizer onde entrega). PUT: grava a configuração na PRINCIPAL — de
 * qualquer loja do grupo em que o dono esteja (trocar de loja troca a conta
 * da sessão, lib/loja-ativa.ts), a página é uma só.
 *
 * Só o dono: funcionário (ownerId) não mexe na vitrine do grupo inteiro.
 */

async function dono() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, accountGroupId: true, role: true } });
  if (!user) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  if (user.ownerId) return { erro: NextResponse.json({ error: "Só o dono da loja mexe na página das lojas." }, { status: 403 }) };
  return { principalId: principalDoGrupo(user) };
}

/** As mesmas lojas da página pública (vitrine-do-grupo.ts): com slug e só conta de loja. */
async function lojasDoGrupo(principalId: string) {
  const lojas = await prisma.user.findMany({
    where: { OR: [{ id: principalId }, { accountGroupId: principalId }], slug: { not: null } },
    orderBy: [{ isPrimaryStore: "desc" }, { createdAt: "asc" }],
    select: {
      id: true, slug: true, storeName: true, name: true, storeLogo: true, storeBanner: true, storeBannerVideo: true, accountGroupId: true,
      deliveryZones: true, deliveryZoneType: true, deliveryConfig: true, storeLatLng: true, city: true, role: true,
    },
  });
  return lojas.filter((l) => !l.role || l.role === "FRANCHISEE");
}

export async function GET() {
  const d = await dono();
  if (d.erro) return d.erro;
  const lojas = await lojasDoGrupo(d.principalId);
  const principal = lojas.find((l) => l.id === d.principalId) || lojas[0];
  if (!principal) return NextResponse.json({ multiloja: false, lojas: [] });

  // Bairro cadastrado em mais de uma loja: ali a página mostra as duas e o
  // cliente escolhe. O dono precisa ver isso para decidir se divide.
  const semAcento = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const contagem = new Map<string, { nome: string; lojas: number }>();
  for (const l of lojas) {
    if (modoDaArea(l) !== "BAIRRO") continue;
    const vistos = new Set<string>();
    for (const b of bairrosAtendidos(l)) {
      const k = `${semAcento(l.city || "")}|${semAcento(b.name)}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      contagem.set(k, { nome: b.name, lojas: (contagem.get(k)?.lojas || 0) + 1 });
    }
  }
  const bairrosEmComum = [...contagem.values()].filter((b) => b.lojas > 1).map((b) => b.nome).sort((a, b) => a.localeCompare(b, "pt-BR"));

  return NextResponse.json({
    multiloja: lojas.length > 1,
    bairrosEmComum,
    caminho: `/lojas/${principal.slug}`,
    config: await lerConfigDoGrupo(principal.id),
    lojas: lojas.map((l) => {
      const modo = modoDaArea(l);
      return {
        id: l.id,
        slug: l.slug,
        nome: (l.storeName || l.name || "Loja").trim(),
        logo: l.storeLogo,
        capa: l.storeBanner || null,
        capaVideo: l.storeBannerVideo || null,
        principal: l.id === principal.id,
        // O que a loja usa para dizer onde entrega — a página não tem cadastro próprio de bairro.
        area: modo === "BAIRRO" ? `${bairrosAtendidos(l).length} bairros` : modo === "KM" ? "por distância (km)" : modo === "POLIGONO" ? "área desenhada no mapa" : "sem área de entrega",
        semArea: modo === "SEM_AREA",
      };
    }),
  });
}

export async function PUT(req: NextRequest) {
  const d = await dono();
  if (d.erro) return d.erro;
  const corpo = await req.json().catch(() => null);
  const config = lerConfigDaPaginaDoGrupo(corpo?.config);

  // Só ids do próprio grupo entram na ordem, na capa e nos nomes.
  const lojas = await lojasDoGrupo(d.principalId);
  const ids = new Set(lojas.map((l) => l.id));
  config.ordem = config.ordem.filter((id) => ids.has(id));
  if (config.capaDaLoja && !ids.has(config.capaDaLoja)) config.capaDaLoja = "";
  for (const id of Object.keys(config.lojas)) if (!ids.has(id)) delete config.lojas[id];

  await gravarConfigDoGrupo(d.principalId, config);
  // A página guarda 60 s em cache (revalidate). Qualquer slug do grupo abre
  // a mesma página: renova todos, senão o "Salvo" mentiria por um minuto.
  for (const l of lojas) {
    try { revalidatePath(`/lojas/${l.slug}`); } catch { /* fora do Next (teste): segue */ }
  }
  return NextResponse.json({ ok: true, config });
}
