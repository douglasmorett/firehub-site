import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { avaliarEntrega, raioMaximoKm, taxaFixaDaLoja, type VeredictoDeEntrega } from "@/lib/area-de-entrega";
import { assinarCotacao, chaveDoEndereco } from "@/lib/cotacao-de-entrega";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { pontoDaLojaDesconhecido, taxaDaLojaSemPonto } from "@/lib/entrega-do-pedido";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

/**
 * GET: taxa de entrega para um endereço/bairro/GPS. A decisão vem de
 * `avaliarEntrega` (src/lib/area-de-entrega.ts) — a MESMA regra da rota de
 * pedido e do robô.
 *
 * Esta rota falhava ABERTA: endereço que o mapa não achava, mapa fora do ar ou
 * loja sem pino viravam "disponível, R$ 5,00". Depois passou a cobrar a faixa
 * MAIS CARA de quem o mapa não achava — e em 25/09/2026 a Divinos cobrou R$ 12
 * de 4 clientes a 0,5–0,9 km. Agora:
 *   - ATENDE       → taxa da faixa/bairro, e o TOKEN da cotação (R1): o pedido
 *                    que o devolve usa esta mesma taxa, sem ir ao mapa de novo;
 *   - ATENDE com `pedeConfirmacao` → taxa ESTIMADA por um ponto aproximado; o
 *                    checkout exige o pino antes de fechar (R3) e só a cotação
 *                    do pino confirmado sai com token;
 *   - FORA         → indisponível, com o motivo;
 *   - DESCONHECIDO → em KM/ROTA e área desenhada: sem taxa, "confirme no mapa"
 *                    (R2). Nunca mais a faixa mais cara.
 *
 * Rota pública. Cada chamada pode custar buscas no Nominatim e no roteador,
 * que limitam o IP do SERVIDOR — um laço aqui derrubaria o frete de todas as
 * lojas. Por isso dois freios: por requisição (o IP) e, o que importa, por
 * BUSCA NO MAPA (o IP e a loja, na fila do servidor: ver LIMITES_DO_DONO em
 * lib/geocodificacao-servidor.ts). Cotação que sai do cache não gasta busca.
 */

/** Por IP, no cardápio público: o checkout cota a cada correção do endereço. */
const LIMITE_POR_IP = { windowMs: 60_000, maxRequests: 40 };
/** O balcão e o simulador do painel (sessão da loja) têm um balde próprio. */
const LIMITE_DA_SESSAO = { windowMs: 60_000, maxRequests: 120 };
/** Acima disto o palpite do mapa é homônimo em outra cidade: o mapa não abre lá. */
const PALPITE_ABSURDO_KM = 60;

const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const kmBr = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

function muitoRapido(resetInMs: number) {
  const segundos = Math.max(1, Math.ceil(resetInMs / 1000));
  return NextResponse.json(
    {
      fee: 0, available: false, error: "Muitas consultas de frete seguidas",
      message: `Muitas consultas de frete seguidas. Espere ${segundos} s e tente de novo.`,
    },
    { status: 429, headers: { "Retry-After": String(segundos) } },
  );
}

/**
 * O balde do IP. IPv6 conta por /64 — é o que um cliente doméstico recebe
 * inteiro, e cada endereço dele seria um balde novo. IPv4 mapeado em IPv6
 * ("::ffff:1.2.3.4") é o IPv4.
 */
function grupoDoIp(ip: string): string {
  const bruto = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapeado = bruto.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return mapeado[1];
  if (!bruto.includes(":")) return bruto || "unknown";
  const comDoisPontos = bruto.includes("::");
  const [esq, dir = ""] = bruto.split("::");
  const a = esq ? esq.split(":") : [];
  const b = comDoisPontos && dir ? dir.split(":") : [];
  const zeros = comDoisPontos ? Array(Math.max(0, 8 - a.length - b.length)).fill("0") : [];
  const grupos = [...a, ...zeros, ...b].map((g) => (g || "0").replace(/^0+(?=.)/, ""));
  return `${grupos.slice(0, 4).join(":")}::/64`;
}

/** Como a distância foi medida, para a mensagem do cliente. */
function textoDaDistancia(v: VeredictoDeEntrega): string {
  if (v.distanciaKm == null) return "";
  const km = kmBr(v.distanciaKm);
  if (v.medida === "rota") return `${km} km pela rua`;
  if (v.medida === "estimada") return `~${km} km (distância estimada)`;
  return `${km} km`;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  let franchiseeId = q.get("franchiseeId");
  const street = q.get("street") || "";
  const number = q.get("number") || "";
  const neighborhood = q.get("neighborhood") || "";
  const address = q.get("address") || "";
  const latStr = q.get("lat");
  const lngStr = q.get("lng");
  const origemDasCoords: "pino" | "gps" = q.get("origem") === "pino" ? "pino" : "gps";

  // ── SEM `franchiseeId`: QUEM PERGUNTA É O BALCÃO ───────────────────────────
  //
  // O cardápio do cliente sabe o id da loja porque a página nasce dela. O PDV
  // não: ele roda dentro do painel, onde a loja é a sessão. Mandar o id da loja
  // para o navegador só para ele devolver aqui seria expor o que não precisa
  // sair. A resolução é a MESMA de /api/store/orders/presencial (ownerId || id),
  // para a taxa COTADA e a taxa GRAVADA saírem da mesma loja.
  let daSessao = false;
  if (!franchiseeId) {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    const usuario = email
      ? await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } })
      : null;
    if (!usuario) return NextResponse.json({ error: "Falta franchiseeId" }, { status: 400 });
    franchiseeId = usuario.ownerId || usuario.id;
    daSessao = true;
  }

  // ── LIMITE ────────────────────────────────────────────────────────────────
  //
  // Por requisição, só o IP (IPv6 por /64). O teto por LOJA contava toda
  // cotação, inclusive a que sai do cache, e 6 IPs travavam o checkout de uma
  // loja-alvo; e 40 GETs de um IP dentro do limite enchiam a fila do mapa e
  // derrubavam o frete de TODAS as lojas. O que o IP e a loja gastam de
  // verdade — buscas no mapa — tem teto (em voo e por minuto) na fila.
  let donos: string[] | undefined;
  if (daSessao) {
    const r = checkRateLimit(`frete:sessao:${franchiseeId}`, LIMITE_DA_SESSAO);
    if (!r.allowed) return muitoRapido(r.resetIn);
  } else {
    const ip = grupoDoIp(getClientIp(req));
    const porIp = checkRateLimit(`frete:ip:${ip}`, LIMITE_POR_IP);
    if (!porIp.allowed) return muitoRapido(porIp.resetIn);
    donos = [`ip:${ip}`, `loja:${franchiseeId}`];
  }

  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { deliveryZoneType: true, deliveryZones: true, deliveryConfig: true, storeLatLng: true, storeAddress: true, city: true },
  });
  if (!user) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const lat = latStr != null && latStr !== "" ? Number(latStr) : NaN;
  const lng = lngStr != null && lngStr !== "" ? Number(lngStr) : NaN;
  const coords = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const fullQuery = address || `${street} ${number}, ${neighborhood}`.trim().replace(/^,\s*|,\s*$/g, "") || neighborhood || "";

  const v = await avaliarEntrega(
    user,
    {
      endereco: fullQuery,
      bairro: neighborhood || null,
      coords,
      origemDasCoords,
      partes: { street, number, neighborhood, city: user.city || "" },
    },
    { donos },
  );
  const type = v.modo === "BAIRRO" ? "neighborhood" : v.modo === "POLIGONO" ? "poligono" : "radius";
  const porKm = v.modo === "KM";
  // Quem pergunta passou do teto de buscas no mapa (o IP ou a loja): é o laço
  // que o limite existe para parar, não um endereço que o mapa não conhece.
  if (v.falhaDoMapa === "limite") return muitoRapido(20_000);
  // O palpite do mapa só serve até 60 km: a Rua Juriti de São Paulo abria o
  // pino a 476 km da casa (o pedido, em lib/entrega-do-pedido.ts, também o
  // descarta). Sem palpite e sem o pino da loja, o mapa abre no endereço da
  // loja achado no mapa — é dele que a distância é medida.
  const palpite = v.ponto && (v.distanciaKm == null || v.distanciaKm <= PALPITE_ABSURDO_KM) ? v.ponto : null;
  // Sem o pino da loja o mapa de confirmação abre no palpite do servidor, no
  // endereço da loja achado no mapa (`v.pontoDaLoja`) ou, sem nenhum dos dois,
  // no GPS do cliente — a mensagem manda para o GPS (lib/entrega-do-pedido.ts,
  // recusaDoSite, decide igual).
  const lojaTemPino = lerPontoDaLoja(user.storeLatLng) != null;
  // O que a cotação sabe da entrega, em KM/ROTA. O repasse do motoboy é da
  // loja: só vai para o painel dela (balcão, simulador), não para o cardápio.
  const detalhes = porKm
    ? {
        distanceKm: v.distanciaKm,
        maxRadiusKm: v.raioMaxKm ?? raioMaximoKm(user),
        matchedAddress: v.enderecoNoMapa,
        tempoMin: v.tempoMin,
        medida: v.medida ?? null,
        faixaKm: v.faixaKm ?? null,
        taxaDoEntregador: daSessao ? v.taxaDoEntregador ?? null : null,
        ponto: v.ponto ?? null,
        pedeConfirmacao: v.pedeConfirmacao === true,
      }
    : {};

  if (v.modo === "BAIRRO" && v.resultado === "DESCONHECIDO") {
    return NextResponse.json({ fee: 0, available: false, type, message: "Selecione seu bairro para calcular a entrega." });
  }
  if (porKm && !coords && fullQuery.trim().length < 4) {
    return NextResponse.json({ fee: 0, available: false, type, message: "Informe o endereço completo (rua, número e bairro) para calcular o frete." });
  }

  if (v.resultado === "FORA") {
    // A mensagem tem que caber no modo. Em área desenhada não existe raio, e a
    // frase saía "fora do raio de entrega (undefined km. Raio máximo:
    // undefined km)" — no cardápio e, pior, na boca do robô no WhatsApp.
    const mensagemDeFora =
      v.areaDeRisco
        ? "A loja não entrega nesse endereço."
        : v.modo === "BAIRRO"
          ? "Bairro não atendido pela loja. Por favor, selecione um dos bairros cadastrados."
          : v.modo === "POLIGONO"
            ? "Esse endereço está fora da área que a loja entrega. Se o ponto no mapa não for a sua casa, ajuste e tentamos de novo."
            : v.distanciaKm != null && v.raioMaxKm != null
              ? `Endereço fora da área de entrega (${textoDaDistancia(v)} da loja; entregamos até ${kmBr(v.raioMaxKm)} km).`
              : "Endereço fora da área de entrega da loja.";
    return NextResponse.json({
      fee: 0, available: false, type, distanceKm: v.distanciaKm, maxRadiusKm: v.raioMaxKm,
      ...detalhes,
      // O cliente pode corrigir o ponto: pode ser o mapa que errou a casa
      // (rua homônima), não ele que mora longe.
      ...(v.modo === "POLIGONO" || (porKm && lojaTemPino && !v.areaDeRisco) ? { podeConfirmarNoMapa: true } : {}),
      precisaConfirmarNoMapa: false,
      message: mensagemDeFora,
    });
  }

  // [cluster B — espelho de recusaDoSite, lib/entrega-do-pedido.ts] O pino da
  // LOJA não decide mais: o checkout abre o mapa no palpite ou no GPS do
  // cliente. Só a loja cujo PRÓPRIO ponto é desconhecido (sem pino e o
  // endereço dela não achado) fica fora deste "confirme no mapa".
  if (v.resultado === "DESCONHECIDO" && (v.modo === "POLIGONO" || (porKm && !pontoDaLojaDesconhecido(v)))) {
    // Área DESENHADA é geometria, e KM/ROTA é distância: sem ponto confiável
    // não há o que calcular, e chutar a faixa mais cara era cobrar R$ 12 de
    // quem mora a 300 m (R2). A resposta é "confirme no mapa" — o checkout
    // mostra o pino, aberto no palpite do mapa quando há um (até 60 km) ou,
    // na loja sem pino, no endereço dela achado no mapa.
    const ondeAbrir = palpite ?? (!lojaTemPino ? v.pontoDaLoja ?? null : null);
    const soGps = !ondeAbrir && !lojaTemPino;
    return NextResponse.json({
      fee: 0, available: false, unknown: true, type,
      ...detalhes,
      // A distância e o ponto do homônimo a 476 km não vão para a tela.
      ...(palpite ? {} : { distanceKm: null }),
      ponto: ondeAbrir,
      precisaConfirmarNoMapa: true,
      podeConfirmarNoMapa: true,
      ...(soGps ? { pedirGps: true } : {}),
      message: v.falhaDoMapa
        // Não é "não localizamos": o mapa não respondeu (fila, prazo, 429).
        ? soGps
          ? 'O mapa está ocupado agora e não conseguimos localizar o seu endereço. Toque em "Usar minha localização atual (GPS)" para calcular a entrega.'
          : "O mapa está ocupado agora e não conseguimos localizar o seu endereço. Marque no mapa onde fica a sua casa para calcular a entrega."
        : palpite
          ? "Achamos o seu endereço só de forma aproximada. Confirme no mapa onde fica a sua casa para calcular a entrega."
          : soGps
            ? 'Não localizamos esse endereço no mapa. Toque em "Usar minha localização atual (GPS)" para calcular a entrega.'
            : "Não localizamos esse endereço no mapa. Confirme no mapa onde fica a sua casa para calcular a entrega.",
    });
  }

  if (v.resultado === "DESCONHECIDO") {
    // Loja por km cujo PRÓPRIO ponto é desconhecido (sem pino e o endereço
    // dela não achado): nem o pino do cliente mediria. Segue aceito, como o
    // pedido (recusaDoSite), pela 1ª faixa — nunca a mais cara (R2) — e o
    // pedido vai marcado para a loja conferir e corrigir (R10).
    const fee = taxaDaLojaSemPonto(user.deliveryZones, taxaFixaDaLoja(user));
    return NextResponse.json({
      fee, available: true, unknown: true, type, maxRadiusKm: v.raioMaxKm ?? raioMaximoKm(user),
      message: `A loja ainda não marcou a localização dela no mapa, então a distância não foi medida. Por enquanto a taxa é ${brl(fee)}, e a loja confirma a entrega.`,
    });
  }

  // ATENDE
  // Loja sem área cadastrada segue como sempre: R$ 5,00 quando não há taxa fixa.
  const fee = v.taxa ?? taxaFixaDaLoja(user) ?? (v.modo === "SEM_AREA" ? 5 : 0);
  const pede = v.pedeConfirmacao === true;

  // ── O TOKEN DA COTAÇÃO (R1) ────────────────────────────────────────────
  //
  // Só sai quando o resultado é o que o pedido pode usar sem perguntar nada:
  // com ponto aproximado (R3), o pedido só fecha depois do pino — e a cotação
  // do pino confirmado é que leva o token. A chave é do endereço como o
  // checkout mandou (peças, texto e, quando veio, o ponto): é o que o POST do
  // pedido recalcula para conferir (lib/entrega-do-pedido.ts, chavesDoPedido).
  let cotacao: string | null = null;
  if (!pede) {
    try {
      cotacao = assinarCotacao({
        loja: franchiseeId,
        chave: chaveDoEndereco({ street, number, neighborhood, address, lat: coords?.lat ?? null, lng: coords?.lng ?? null }),
        lat: v.ponto?.lat ?? null,
        lng: v.ponto?.lng ?? null,
        origemDoPonto: v.ponto?.origem ?? null,
        distanciaKm: v.distanciaKm ?? null,
        medida: v.medida ?? null,
        faixaKm: v.faixaKm ?? null,
        taxa: fee,
        // O token é ASSINADO, não cifrado: o corpo é JSON em base64url que
        // qualquer um lê no DevTools. O repasse do motoboy é da loja (mesma
        // regra de `detalhes` acima): só no token do painel. O pedido do site
        // acha o repasse pela faixa do token (repasseDaEntrega → repasseDoPedido).
        taxaDoEntregador: daSessao ? v.taxaDoEntregador ?? null : null,
        tempoMin: v.tempoMin ?? null,
      });
    } catch (e: any) {
      // Sem segredo configurado: o pedido reavalia, como antes do token.
      console.warn("[delivery-fee] cotação sem token:", e?.message);
    }
  }

  const mensagem =
    v.modo === "BAIRRO" ? `Bairro atendido: ${v.bairro}`
      : porKm
        ? pede
          ? `Achamos o seu endereço só de forma aproximada: a entrega fica em torno de ${brl(fee)}. Confirme no mapa onde fica a sua casa para fechar o pedido.`
          : v.medida === "linha-reta" ? `Distância aproximada: ${kmBr(v.distanciaKm ?? 0)} km`
            : `Distância: ${textoDaDistancia(v)}`
        : v.modo === "POLIGONO" ? `Área de entrega: ${v.bairro}`
          : "Taxa padrão da loja";

  return NextResponse.json({
    fee, available: true, type, distanceKm: v.distanciaKm, maxRadiusKm: v.raioMaxKm, matchedAddress: v.enderecoNoMapa, neighborhood: v.bairro,
    ...detalhes,
    ...(v.modo === "POLIGONO" ? { tempoMin: v.tempoMin, ponto: v.ponto ?? null } : {}),
    // Mesmo com taxa calculada, o cliente pode conferir o pino: o mapa acha
    // rua homônima em outro bairro com a mesma facilidade com que não acha
    // nada, e aí a taxa é de outro lugar.
    ...(v.modo === "POLIGONO" || (porKm && lojaTemPino) ? { podeConfirmarNoMapa: true } : {}),
    precisaConfirmarNoMapa: false,
    cotacao,
    message: mensagem,
  });
}
