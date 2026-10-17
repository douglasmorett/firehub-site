/**
 * O que a rota DESPACHADA dispara depois de gravada.
 *
 * Despachar é gravar: a rota vira DISPATCHED e os pedidos SAIU_ENTREGA com o
 * entregador (api/store/routes/dispatch). O resto é CONSEQUÊNCIA, e pode
 * falhar sem desfazer o despacho: o aviso ao cliente, a NFC-e, o aviso no app
 * do entregador, o "saiu" no iFood/99Food/Brendi/Wabiz/Keeta/CardápioWeb/JotaJá e o
 * WhatsApp com as paradas para o motoboy.
 *
 * Esses efeitos já não eram aguardados pela rota, mas nasciam no meio dela,
 * soltos: uma exceção no laço das plataformas (o iFood de um pedido que
 * lançava) virava rejeição sem dono e os pedidos seguintes da rota nunca
 * eram avisados ao parceiro. Agora a rota grava, agenda `efeitosDoDespacho`
 * pelo `after()` do Next e responde — o lojista vê o "despachado" assim que o
 * banco grava (queixa do Lucas, Frangoso, 13/10/2026: "toda vez que eu
 * despacho trava") — e aqui cada efeito roda isolado do outro, uma vez só.
 *
 * O que NÃO mudou: quem é avisado, em que ordem os efeitos começam, as
 * plataformas na mesma sequência por pedido, os mesmos rótulos de log, e o
 * iFood barrado continua indo para `ifoodAcoesPendentes` (lib/ifood-pedido →
 * lib/ifood-acao-pendente), que o ifood-poll repete.
 *
 * Teste: scripts/teste-despacho-da-rota.ts (quem é avisado, a mensagem do
 * motoboy, a ordem e o isolamento dos efeitos — com dependências falsas, sem
 * banco nem rede).
 */
import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";
import { linkDaRotaNoMaps } from "@/lib/link-da-rota";

/** O pedido como a rota de despacho o leu, ANTES de gravar o SAIU_ENTREGA. */
export type PedidoDaRota = {
  id: string;
  franchiseeId: string;
  status: string;
  source: string | null;
  deliveryType: string | null;
  deliveryBy: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  dailyOrderNumber: number | null;
  ifoodOrderId: string | null;
  ifoodReference: string | null;
  ifoodStoreMerchant: string | null;
  openDeliveryOrderId: string | null;
  openDeliveryChannel: string | null;
  openDeliveryReference: string | null;
  motoboyId: string | null;
};

export type MotoboyDoDespacho = { id: string; name: string; phone: string | null };

export type ContextoDoDespacho = {
  /**
   * A LOJA (ownerId || id de quem despachou). O WhatsApp sai pela instância
   * dela — era `route.franchiseeId`, que pode ser o id de um funcionário: a
   * instância não existia e nada saía.
   */
  lojaId: string;
  rota: { id: string; routeNumber: string };
  motoboy: MotoboyDoDespacho;
  /** O retrato de antes do despacho: é por ele que se sabe quem saiu AGORA. */
  pedidos: PedidoDaRota[];
};

/** Quem já estava na rua, entregue ou cancelado: não muda com este despacho. */
const JA_SAIU_OU_FECHOU: string[] = [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS, "SAIU_ENTREGA"];

/**
 * O cliente sabe que saiu.
 *
 * O botão "Saiu" do painel, o app do motoboy e o despacho pelo WhatsApp
 * avisam o cliente; a roteirização punha a rota inteira em SAIU_ENTREGA
 * calada (conferência de 09/10/2026, pedido do Douglas: todo aviso em toda
 * modalidade). Só o que mudou AGORA: o que já estava na rua já foi avisado —
 * e é isso que impede o segundo aviso quando a mesma rota chega duas vezes.
 */
export function quemSaiuAgora(pedidos: PedidoDaRota[]): PedidoDaRota[] {
  return pedidos.filter((o) => !JA_SAIU_OU_FECHOU.includes(o.status));
}

/**
 * Aviso no app nativo, só do que CHEGOU ao celular dele agora: a rota montada
 * já com este entregador avisou na montagem (api/store/routes, POST).
 */
export function quemChegouAoEntregador(pedidos: PedidoDaRota[], motoboyId: string): PedidoDaRota[] {
  return pedidos.filter((o) => o.motoboyId !== motoboyId && !JA_SAIU_OU_FECHOU.includes(o.status));
}

/** Telefone no formato do WhatsApp (55 + DDD + número), ou null sem dígitos. */
export function telefoneDoMotoboyNoWhatsApp(telefone: string | null | undefined): string | null {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (!digitos) return null;
  return digitos.startsWith("55") ? digitos : `55${digitos}`;
}

/**
 * A mensagem com as paradas e o link do Google Maps que vai para o motoboy.
 * Sem nenhum endereço não há rota para mostrar: null, e nada é enviado.
 *
 * O texto é o mesmo de antes (o motoboy já lê assim); só o link mudou: era
 * uma rota partindo de "Rio das Ostras, RJ" fixo, e agora é o do COPIAR
 * (lib/link-da-rota.ts) — sem partida, com a cidade da loja.
 */
export function mensagemDaRotaParaOMotoboy(routeNumber: string, pedidos: PedidoDaRota[], cidadeDaLoja?: string | null): string | null {
  const addresses = pedidos.map((o) => o.customerAddress).filter(Boolean) as string[];
  const mapsUrl = linkDaRotaNoMaps(addresses, cidadeDaLoja);
  if (!mapsUrl) return null;

  let summaryText = `🚀 *NOVA ROTA ATRIBUÍDA: ${routeNumber}*\n\n`;
  summaryText += `📦 *Total de Pedidos:* ${pedidos.length}\n\n`;
  summaryText += `📍 *Paradas da Rota:*\n`;

  pedidos.forEach((o, idx) => {
    const displayNum = o.dailyOrderNumber ? `#${o.dailyOrderNumber}` : (o.ifoodReference || o.openDeliveryReference || "");
    summaryText += `${idx + 1}️⃣ *Pedido ${displayNum}*: ${o.customerName || "Cliente"}\n   🏠 ${o.customerAddress || "Sem endereço"}\n`;
  });

  summaryText += `\n🗺️ *Navegação GPS (Google Maps):*\n${mapsUrl}`;
  return summaryText;
}

/**
 * O "saiu" de UM pedido no parceiro de onde ele veio. A sequência e os logs
 * são os que a rota de despacho sempre teve; erro de um parceiro é logado e
 * não impede o próximo.
 */
export async function sincronizarPedidoNasPlataformas(
  ord: PedidoDaRota,
  motoboy: MotoboyDoDespacho,
  lojaId: string,
): Promise<void> {
  const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");
  const { ehPedidoWabiz, sincronizarWabiz } = await import("@/lib/wabiz-status");
  const { ehPedidoBrendi, sincronizarBrendi } = await import("@/lib/brendi-status");
  const { ehPedidoKeeta, sincronizarKeeta } = await import("@/lib/keeta/status");
  const { ehPedidoCardapioWeb, sincronizarCardapioWeb } = await import("@/lib/cardapioweb/status");

  // ── Sync Brendi ──
  //
  // Faltava. `ehPedidoBrendi` era importado só para EXCLUIR a Brendi do
  // ramo do JotaJá (os dois usam `openDeliveryOrderId`), e depois ninguém
  // a avisava: despachar a rota punha o pedido em SAIU_ENTREGA aqui e o
  // cliente da Brendi continuava vendo "em preparo".
  //
  // E não era só o aviso: a escada de status da Brendi é progressiva, e
  // `delivered` depois de um `dispatch` que nunca saiu é recusado — então
  // o pedido também não FECHAVA lá. Pelo botão do KDS e pelo despacho por
  // WhatsApp isso já funcionava; só a roteirização ficava de fora.
  if (ehPedidoBrendi(ord)) {
    await sincronizarBrendi(
      {
        // O resgate manual grava o id com sufixo `_recovered`; a API da
        // Brendi só conhece o UUID limpo (mesma normalização do KDS e da
        // rota de status).
        openDeliveryOrderId: ord.openDeliveryOrderId!.replace(/_recovered$/, ""),
        franchiseeId: ord.franchiseeId,
        status: ord.status,
        deliveryBy: ord.deliveryBy,
      },
      "SAIU_ENTREGA"
    ).catch((err: any) =>
      console.warn(`[Route Dispatch → Brendi] Erro sync ${ord.openDeliveryOrderId}:`, err?.message)
    );
  }
  // ── Sync Wabiz ──
  if (ehPedidoWabiz(ord)) {
    await sincronizarWabiz(
      {
        openDeliveryOrderId: ord.openDeliveryOrderId!,
        openDeliveryReference: ord.openDeliveryReference,
        franchiseeId: ord.franchiseeId,
        deliveryType: ord.deliveryType,
      },
      "SAIU_ENTREGA"
    ).catch((err: any) =>
      console.warn(`[Route Dispatch → Wabiz] Erro sync ${ord.openDeliveryOrderId}:`, err?.message)
    );
  }
  // ── Sync 99Food ──
  // Mesmo campo (`openDeliveryOrderId`), parceiro diferente. Sem esta
  // separação, despachar a rota mandava o pedido do 99Food para a API do
  // JotaJá e o 99 nunca sabia que a comida tinha saído.
  if (ehPedido99Food(ord)) {
    await sincronizar99Food(
      {
        openDeliveryOrderId: ord.openDeliveryOrderId!,
        franchiseeId: ord.franchiseeId,
        status: ord.status,
        deliveryBy: ord.deliveryBy,
        // A rota inteira sai com o mesmo motoboy — é ele que o 99Food
        // mostra ao cliente no acompanhamento.
        entregador: motoboy ? { nome: motoboy.name, telefone: motoboy.phone, id: motoboy.id } : null,
      },
      "SAIU_ENTREGA"
    ).catch((err: any) =>
      console.warn(`[Route Dispatch → 99Food] Erro sync ${ord.openDeliveryOrderId}:`, err?.message)
    );
  }
  // ── Sync Keeta ──
  if (ehPedidoKeeta(ord)) {
    await sincronizarKeeta(
      { openDeliveryOrderId: ord.openDeliveryOrderId!, franchiseeId: ord.franchiseeId, status: ord.status, deliveryBy: ord.deliveryBy, deliveryType: ord.deliveryType },
      "SAIU_ENTREGA"
    ).catch((err: any) => console.warn(`[Route Dispatch → Keeta] Erro sync ${ord.openDeliveryOrderId}:`, err?.message));
  }
  // ── Sync CardápioWeb ──
  // A loja de lá (uma por marca) sai do próprio id do pedido; o que falhar
  // vai para a fila de pendentes do polling (lib/cardapioweb/acoes-pendentes.ts).
  if (ehPedidoCardapioWeb(ord)) {
    await sincronizarCardapioWeb(
      { openDeliveryOrderId: ord.openDeliveryOrderId!, franchiseeId: ord.franchiseeId, status: ord.status, deliveryBy: ord.deliveryBy, deliveryType: ord.deliveryType },
      "SAIU_ENTREGA",
      { limiteMs: 30_000 }
    ).catch((err: any) => console.warn(`[Route Dispatch → CardápioWeb] Erro sync ${ord.openDeliveryOrderId}:`, err?.message));
  }
  // ── Sync Jotajá (Open Delivery) ──
  if (ord.openDeliveryOrderId && !ehPedido99Food(ord) && !ehPedidoWabiz(ord) && !ehPedidoBrendi(ord) && !ehPedidoKeeta(ord) && !ehPedidoCardapioWeb(ord)) {
    try {
      const { jotajaMutate } = await import("@/lib/jotaja-api");
      const odId = ord.openDeliveryOrderId;
      // Garantir startPreparation antes do dispatch
      if (ord.status === "ACEITO" || ord.status === "NOVO") {
        await jotajaMutate(`/v1/orders/${odId}/startPreparation`, { method: "POST" }, lojaId).catch(() => {});
      }
      const r = await jotajaMutate(`/v1/orders/${odId}/dispatch`, { method: "POST" }, lojaId);
      console.log(`[Route Dispatch → Jotajá] dispatch ${odId}: ${r.status}`);
    } catch (err: any) {
      console.warn(`[Route Dispatch → Jotajá] Erro sync ${ord.openDeliveryOrderId}:`, err?.message);
    }
  }
  // ── Sync iFood ──
  // Com a credencial do dono do pedido — o token central só alcança a
  // Hakim, e nas outras lojas o despacho era um 403 engolido pelo log.
  // Barrado pelo iFood (403 HTML, 429, 5xx, rede), o `dispatch` fica anotado
  // em `ifoodAcoesPendentes` e o ifood-poll repete (lib/ifood-acao-pendente).
  if (ord.ifoodOrderId) {
    try {
      const { despacharNoIfood } = await import("@/lib/ifood-pedido");
      await despacharNoIfood(ord, "Route Dispatch → iFood");
    } catch (err: any) {
      // Antes esta exceção derrubava o laço inteiro: os pedidos seguintes da
      // rota não eram avisados a parceiro nenhum.
      console.warn(`[Route Dispatch → iFood] Erro sync ${ord.ifoodOrderId}:`, err?.message);
    }
  }
}

/** As portas para fora. Os testes trocam por versões que só anotam. */
export type PortasDoDespacho = {
  avisarCliente: (pedidoId: string) => Promise<unknown>;
  emitirNfce: (pedidoIds: string[]) => Promise<unknown>;
  avisarApp: (motoboyId: string, pedidos: PedidoDaRota[], routeNumber: string) => Promise<unknown>;
  sincronizarPlataformas: (pedido: PedidoDaRota, motoboy: MotoboyDoDespacho, lojaId: string) => Promise<unknown>;
  enviarWhatsApp: (lojaId: string, telefone: string, texto: string) => Promise<unknown>;
  /** A cidade cadastrada da loja, para o link do Maps (null = sem cidade). */
  cidadeDaLoja: (lojaId: string) => Promise<string | null>;
};

const PORTAS_DE_VERDADE: PortasDoDespacho = {
  // A própria função pula iFood/99 (telefone 0800) e a loja que desligou os avisos.
  avisarCliente: async (id) => (await import("@/lib/order-notifications")).sendOrderNotification(id, "SAIU_ENTREGA"),
  // NFC-e na SAÍDA (lib/fiscal-momento decide se é a hora): sem esta linha a
  // nota da rota só saía pela varredura do cron.
  emitirNfce: async (ids) => (await import("@/lib/fiscal-automatico")).emitirNfceDosPedidos({ id: { in: ids } }),
  avisarApp: async (motoboyId, pedidos, routeNumber) =>
    (await import("@/lib/app-motoboy/aparelhos")).avisarPedidosNovos(motoboyId, pedidos, routeNumber),
  sincronizarPlataformas: sincronizarPedidoNasPlataformas,
  enviarWhatsApp: async (lojaId, telefone, texto) =>
    (await import("@/lib/whatsapp-evolution")).sendEvolutionMessage(lojaId, telefone, texto),
  cidadeDaLoja: async (lojaId) => {
    const { prisma } = await import("@/lib/prisma");
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { city: true } });
    return loja?.city || null;
  },
};

/**
 * Roda os efeitos de UM despacho. Nunca lança: cada efeito cuida do próprio
 * erro (como antes), e um efeito que falha não segura nem cancela os outros.
 *
 * Os cinco começam juntos e na ordem de sempre (cliente, nota, app,
 * plataformas, WhatsApp) — nenhum depende do outro. As plataformas andam
 * pedido a pedido, como sempre andaram.
 */
export async function efeitosDoDespacho(ctx: ContextoDoDespacho, portas: PortasDoDespacho = PORTAS_DE_VERDADE): Promise<void> {
  const { lojaId, rota, motoboy, pedidos } = ctx;
  if (pedidos.length === 0) return;

  const efeitos: Promise<unknown>[] = [];

  const sairamAgora = quemSaiuAgora(pedidos);
  for (const o of sairamAgora) efeitos.push(portas.avisarCliente(o.id).catch(() => {}));

  efeitos.push(portas.emitirNfce(pedidos.map((o) => o.id)).catch(() => {}));

  const chegaramAgora = quemChegouAoEntregador(pedidos, motoboy.id);
  if (chegaramAgora.length > 0) {
    efeitos.push(portas.avisarApp(motoboy.id, chegaramAgora, rota.routeNumber).catch(() => {}));
  }

  efeitos.push(
    (async () => {
      for (const ord of pedidos) {
        try {
          await portas.sincronizarPlataformas(ord, motoboy, lojaId);
        } catch (err: any) {
          console.warn(`[Route Dispatch] Erro sync do pedido ${ord.id}:`, err?.message);
        }
      }
    })(),
  );

  // Monta o link da rota completa no Google Maps para o motoboy.
  const telefone = telefoneDoMotoboyNoWhatsApp(motoboy.phone);
  if (telefone) {
    efeitos.push(
      (async () => {
        const cidade = await portas.cidadeDaLoja(lojaId).catch(() => null);
        const texto = mensagemDaRotaParaOMotoboy(rota.routeNumber, pedidos, cidade);
        if (texto) await portas.enviarWhatsApp(lojaId, telefone, texto);
      })().catch(() => {}),
    );
  }

  await Promise.allSettled(efeitos);
}
