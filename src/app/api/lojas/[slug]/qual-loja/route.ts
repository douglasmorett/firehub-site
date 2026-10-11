import { NextRequest, NextResponse } from "next/server";
import { avaliarEntrega, modoDaArea } from "@/lib/area-de-entrega";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { lojasVisiveisDoGrupo, slugValido } from "@/lib/vitrine-do-grupo";
import { distanciaRetaKm, escolherLoja, type ResultadoDaLoja } from "@/lib/escolha-de-loja-do-grupo";

/**
 * POST: qual loja do grupo atende o cliente. Corpo: `{ bairro?, cidade?, endereco?, lat?, lng? }`.
 *
 * Cada loja responde pela própria área com `avaliarEntrega` — a mesma regra
 * do checkout e do robô (lib/escolha-de-loja-do-grupo.ts explica a escolha).
 * Rota pública que pode ir ao mapa uma vez por loja: limite por IP, e as
 * buscas contam no teto do IP e de cada loja (lib/geocodificacao-servidor.ts).
 */

// No celular muita gente sai pelo mesmo IP da operadora (CGNAT); a busca no
// mapa já tem o teto próprio por IP e por loja na fila do servidor.
const LIMITE_POR_IP = { windowMs: 60_000, maxRequests: 60 };
/** As lojas são avaliadas juntas; o cliente não espera o prazo inteiro do checkout. */
const PRAZO_MS = 9000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const ip = getClientIp(req);
  const limite = checkRateLimit(`qual-loja:ip:${ip}`, LIMITE_POR_IP);
  if (!limite.allowed) {
    return NextResponse.json({ error: "Muitas consultas seguidas. Espere alguns segundos." }, { status: 429 });
  }

  const corpo = await req.json().catch(() => ({}));
  const bairro = String(corpo?.bairro || "").trim().slice(0, 120);
  const cidade = String(corpo?.cidade || "").trim().slice(0, 80);
  const endereco = String(corpo?.endereco || "").trim().slice(0, 300);
  const lat = Number(corpo?.lat);
  const lng = Number(corpo?.lng);
  const coords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null;
  if (!bairro && !endereco && !coords) {
    return NextResponse.json({ error: "Diga o bairro, o endereço ou use a localização." }, { status: 400 });
  }

  // Loja que o dono escondeu da página não é escolhida por ela.
  const atual = await slugValido(slug);
  const visiveis = atual ? (await lojasVisiveisDoGrupo(atual))?.lojas : null;
  if (!visiveis || visiveis.length === 0) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  // Bairro escolhido na lista vem com a cidade: "Centro" de Rio das Ostras não
  // é o "Centro" da loja de Barra de São João (Jerrajê). Sem loja na cidade
  // (cadastro com a cidade escrita diferente), vale o grupo inteiro.
  const semAcento = (t: string | null | undefined) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const daCidade = cidade ? visiveis.filter((l) => semAcento(l.city) === semAcento(cidade)) : [];
  const lojas = daCidade.length > 0 ? daCidade : visiveis;

  const resultados: ResultadoDaLoja[] = await Promise.all(
    lojas.map(async (loja) => {
      // Loja SEM área de entrega: para o checkout ela atende qualquer lugar
      // (area-de-entrega.ts, SEM_AREA), mas aqui isso faria a filial recém-
      // criada roubar o cliente de todo bairro. Para a escolha, ela é dúvida.
      const v = modoDaArea(loja) === "SEM_AREA"
        ? { resultado: "DESCONHECIDO" as const, taxa: null, tempoMin: null }
        : await avaliarEntrega(
            loja,
            {
              endereco: endereco || bairro,
              bairro: bairro || null,
              coords,
              origemDasCoords: "gps",
              partes: { neighborhood: bairro || undefined, city: loja.city || "" },
            },
            { prazoMs: PRAZO_MS, donos: [`ip:${ip}`, `loja:${loja.id}`] },
          ).catch(() => ({ resultado: "DESCONHECIDO" as const, taxa: null, tempoMin: null }));
      const daLoja = lerPontoDaLoja(loja.storeLatLng);
      const doCliente = coords || ("ponto" in v && v.ponto ? { lat: v.ponto.lat, lng: v.ponto.lng } : null);
      return {
        lojaId: loja.id,
        veredicto: {
          resultado: v.resultado,
          taxa: v.taxa,
          tempoMin: v.tempoMin,
          distanciaKm: "distanciaKm" in v ? v.distanciaKm : undefined,
          bairro: "bairro" in v ? v.bairro : undefined,
        },
        distanciaRetaKm: daLoja && doCliente ? Math.round(distanciaRetaKm(daLoja, doCliente) * 10) / 10 : null,
      };
    }),
  );

  return NextResponse.json({ escolha: escolherLoja(resultados), resultados });
}
