/**
 * POST /api/geocodificar
 *
 * O mapa da roteirização (e o mapa de calor dos relatórios) manda os
 * endereços dos pedidos e recebe as coordenadas. Quem fala com o
 * geocodificador é o SERVIDOR — ver lib/geocodificacao-servidor.ts para o
 * motivo (o limite do Nominatim é por IP, e o IP da loja é o do Wi-Fi,
 * compartilhado com a rua inteira).
 *
 *   corpo:    { enderecos: [{ id, endereco }] }   (até 15 por chamada)
 *   resposta: { resultados: [{ id, lat, lng, origem, fonte, aproximado, doCache }],
 *               incertos:   [{ id, motivo }] }
 *
 * `incertos` (16/10/2026, NIK): nenhum ponto plausível para o endereço — nem a
 * posição que a loja ensinou, nem o CEP, nem o texto, nem o centro do bairro
 * dentro da área da loja (lib/ponto-do-pedido.ts). O pedido não vai para o
 * mapa no lugar errado: a tela lista e o operador posiciona. A aba velha (que
 * não conhece `incertos`) só não recebe ponto para ele, como antes.
 *
 * O `id` pode ser o do pedido (roteirização) ou outra coisa (o mapa de calor
 * manda a chave do endereço). Com o id de um pedido, vale a loja DELE — em
 * "Todas as lojas" a filial tem a área dela — e o canal (marketplace tem raio
 * maior). Sem pedido, a loja da sessão.
 *
 * Exige sessão de lojista: geocodificação é serviço de terceiro com limite, não
 * pode virar endpoint aberto.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolverPontosNoServidor, type PedidoDeGeocodificacao, type PontoIncerto, type ResultadoGeocodificacao } from "@/lib/geocodificacao-servidor";
import { resolverLojaNoMapa } from "@/lib/ponto-da-loja-servidor";
import { lojasDaVisao, COOKIE_DA_LOJA_ATIVA } from "@/lib/loja-ativa";
import { areaDaLoja } from "@/lib/ponto-do-pedido";
import { canalDoPedido } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAMPOS_DA_LOJA = {
  id: true, city: true, storeAddress: true, storeLatLng: true,
  deliveryZoneType: true, deliveryZones: true, deliveryConfig: true,
} as const;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const corpo = await req.json().catch(() => ({} as any));
  const enderecos = Array.isArray(corpo?.enderecos) ? corpo.enderecos : [];
  if (enderecos.length === 0) return NextResponse.json({ resultados: [], incertos: [] });

  // Teto por chamada. Cada endereço NOVO custa pelo menos 1,1 s (o limite do
  // geocodificador) e pode custar cinco vezes isso; 40 não cabiam nos 60 s da
  // rota. Com 15, o pior caso ainda termina e devolve resultado — e o que
  // sobrar a tela pede de novo.
  const lote: { id: string; endereco: string }[] = enderecos
    .filter((e: any) => e && typeof e.id === "string" && typeof e.endereco === "string" && e.endereco.trim())
    .slice(0, 15);

  const usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!usuario) return NextResponse.json({ error: "usuário não encontrado" }, { status: 401 });

  const lojaDaSessao = usuario.ownerId || usuario.id;
  const cookieStore = await cookies();
  const { lojaIds } = await lojasDaVisao(usuario, cookieStore.get(COOKIE_DA_LOJA_ATIVA)?.value).catch(() => ({ lojaIds: [lojaDaSessao] }));

  // De que loja e de que canal é cada pedido (só os das lojas que a sessão vê).
  const pedidos = await prisma.customerOrder
    .findMany({
      where: { id: { in: lote.map((e) => e.id) }, franchiseeId: { in: lojaIds } },
      select: { id: true, franchiseeId: true, source: true, openDeliveryChannel: true, openDeliveryOrderId: true, ifoodOrderId: true },
    })
    .catch(() => []);
  const doPedido = new Map(pedidos.map((p) => [p.id, p]));

  const porLoja = new Map<string, PedidoDeGeocodificacao[]>();
  for (const e of lote) {
    const p = doPedido.get(e.id);
    const loja = p?.franchiseeId || lojaDaSessao;
    const lista = porLoja.get(loja) || [];
    lista.push({ id: e.id, endereco: e.endereco, ehMarketplace: p ? canalDoPedido(p).ehMarketplace : true });
    porLoja.set(loja, lista);
  }

  const resultados: ResultadoGeocodificacao[] = [];
  const incertos: PontoIncerto[] = [];
  try {
    for (const [lojaId, daLoja] of porLoja) {
      const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: CAMPOS_DA_LOJA });
      if (!loja) continue;
      // Sem a coordenada da loja não há âncora: o raio e o viés da busca
      // dependem dela. O endereço do cadastro resolve a âncora sozinho (ver
      // lib/ponto-da-loja-servidor) — 32 das 41 lojas nunca salvaram o pino.
      const noMapa = await resolverLojaNoMapa({ id: loja.id, storeLatLng: loja.storeLatLng, storeAddress: loja.storeAddress, city: loja.city });
      if (!noMapa.ponto) {
        if (lojaId === lojaDaSessao) {
          return NextResponse.json(
            { error: "A loja está sem endereço no cadastro. Preencha o endereço em Minha Loja para o mapa funcionar." },
            { status: 409 },
          );
        }
        continue;
      }
      // A área só é régua quando o ponto da loja é o PINO dela: o ponto achado
      // pelo endereço do cadastro pode ser o centro da cidade (a Pizzaria 17
      // ficou a 26 km da porta), e medir a área dali recusaria o cliente certo.
      const area = noMapa.origem === "cadastro" ? areaDaLoja(loja, noMapa.ponto) : null;
      const r = await resolverPontosNoServidor(daLoja, {
        cidade: noMapa.cidade || loja.city || "",
        endereco: noMapa.endereco || loja.storeAddress,
        centro: noMapa.ponto,
        area,
        franchiseeId: loja.id,
      });
      resultados.push(...r.achados);
      incertos.push(...r.incertos);
    }
    const doCache = resultados.filter((r) => r.doCache).length;
    console.log(
      `[Geocodificação] ${lote.length} endereço(s): ${doCache} do cache, ${resultados.length - doCache} novos, ${incertos.length} incerto(s)`,
    );
    return NextResponse.json({ resultados, incertos });
  } catch (e: any) {
    console.error("[Geocodificação] falhou:", e?.message);
    return NextResponse.json({ error: e?.message || "erro" }, { status: 500 });
  }
}
