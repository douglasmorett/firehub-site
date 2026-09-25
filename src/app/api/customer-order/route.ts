import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { precoUnitarioDoItem, pisoDoPreco } from "@/lib/preco-combo";
import { aplicarPrecoDoCanalComCombo } from "@/lib/preco-por-canal";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { trackSaleForBilling } from "@/lib/billing";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { disponivelHoje, diaDaSemanaDaLoja } from "@/lib/cardapio-interno";
import { conferirEstoque } from "@/lib/estoque-restante";
import { estadoDaLoja } from "@/lib/loja-aberta";
import { dataDaLoja } from "@/lib/fuso";
import { avaliarEntrega, modoDaArea, taxaFixaDaLoja } from "@/lib/area-de-entrega";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import {
  camposDaEntrega,
  coordenadaDoCorpo,
  cotacaoDoPedido,
  entregaDaCotacao,
  entregaDoVeredicto,
  notasDaEntrega,
  recusaDoSite,
  taxaDaLojaSemPonto,
  type EntregaDoPedido,
} from "@/lib/entrega-do-pedido";
import { porValorMinimo, type EntregaGratis } from "@/lib/entrega-gratis";
import { cuponsComCampanha } from "@/lib/campanha-converter";
import { premioDoCliente } from "@/lib/premio-no-pedido";
import { efeitoDoPremio } from "@/lib/trilha-premiada";

/**
 * Este telefone já fez pedido PELO SITE nesta loja? É a regra do "só no
 * primeiro pedido" do cupom da campanha "converter para site próprio".
 *
 * Marketplace e salão não contam (FONTES_QUE_NAO_SAO_SITE): o cliente do
 * iFood é justamente quem a campanha quer trazer, e quem comeu na mesa nunca
 * pediu pelo site. Cancelado e pagamento abandonado também não: ninguém
 * comprou. Compara pelos 8 últimos dígitos, porque o telefone é gravado como
 * o cliente digitou — com máscara, com 55, com ou sem o nono dígito.
 */
// A régua dos cupons (validade, limite por cliente, primeiro pedido) e os fatos
// que ela precisa do banco. `jaPediuPeloSite` morava aqui; saiu para
// lib/cupons-no-banco.ts porque a validação que o site chama ao digitar o
// código e a consulta do cliente precisam da MESMA resposta que este checkout.
import { acharCupom, avaliarCupom } from "@/lib/cupons";
import { fatosDoCupom } from "@/lib/cupons-no-banco";

export async function POST(req: Request) {
  try {
    // ── Rate Limiting ────────────────────────────────────────────────────────
    const ip = getClientIp(req);
    const { allowed } = checkRateLimit(`create-order:${ip}`, { windowMs: 60000, maxRequests: 20 });
    if (!allowed) {
      return NextResponse.json({ error: "Muitas requisições. Tente novamente em 1 minuto." }, { status: 429 });
    }

    const body = await req.json();
    const { franchiseeSlug, franchiseeId, customerName, customerPhone, customerAddress, deliveryType, paymentMethod, notes, items, couponCode, deliveryFee } = body;

    if ((!franchiseeSlug && !franchiseeId) || !customerName || !customerPhone || !items || items.length === 0) {
      return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });
    }

    // Buscar franqueado com config por ID ou Slug
    const franchisee = await prisma.user.findFirst({
      where: franchiseeId ? { id: franchiseeId } : { slug: franchiseeSlug },
      select: {
        id: true, slug: true, storeName: true, storeOpen: true, storePause: true, storeHours: true, storeTimezone: true,
        autoAcceptOrders: true, allowScheduledOrders: true, storeCoupons: true, deliveryConfig: true,
        // O cupom da campanha "converter para site próprio" mora aqui
        // (lib/campanha-converter.ts) e é conferido como os demais.
        storeLoyalty: true,
        // A área de entrega, para o SERVIDOR conferir — antes só o navegador
        // conferia, e um POST direto (ou aba antiga) entrava com qualquer
        // endereço e qualquer taxa.
        deliveryZones: true, deliveryZoneType: true, storeLatLng: true, storeAddress: true, city: true
      }
    });
    if (!franchisee) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

    // Validar se agendamento está desativado
    if ((body.scheduledDatetime || body.scheduledDate || body.isScheduled) && franchisee.allowScheduledOrders === false) {
      return NextResponse.json({ error: "Esta loja não está aceitando pedidos agendados no momento." }, { status: 400 });
    }

    // Verificar se loja está operando
    if (franchisee.storeOpen === false) {
      return NextResponse.json({ error: "Loja fechada no momento." }, { status: 400 });
    }

    // Fora do HORÁRIO de funcionamento também é fechada. Só o front avisava:
    // uma aba aberta desde antes do fechamento (ou um POST direto) criava
    // pedido de madrugada — que tocava na loja vazia e nunca seria feito.
    // Pedido AGENDADO passa: ele é para quando a loja estiver aberta.
    //
    // NO FUSO DA LOJA, não no do servidor. A primeira versão desta trava usava
    // `isStoreOpen` (store-hours.ts), que lê `new Date().getHours()` — a hora do
    // PROCESSO, e o container roda em UTC. Efeito medido em 06/09/2026 na Pastel
    // da Paulista (17:00–23:15): às 20:28 de Brasília o servidor já marcava
    // 23:28, respondia "Loja fechada agora — fechado · abre amanhã" e nenhum
    // cliente conseguia fechar pedido, nem entrega nem retirada, das 20:15 até
    // o fechamento de verdade — todo dia, desde o deploy de 27/08. A tela dizia
    // "Aberta" porque o navegador do cliente está no fuso certo; só o POST
    // recusava. `estadoDaLoja` é a peça feita para o servidor: usa
    // `storeTimezone` e ainda entende o turno de ontem que atravessa a madrugada.
    const ehAgendado = Boolean(body.scheduledDatetime || body.scheduledDate || body.isScheduled);
    if (!ehAgendado) {
      const estadoAgora = estadoDaLoja({
        storeHours: franchisee.storeHours,
        storePause: franchisee.storePause,
        storeOpen: franchisee.storeOpen,
        timezone: franchisee.storeTimezone,
      });
      if (!estadoAgora.aberta) {
        return NextResponse.json({ error: estadoAgora.texto }, { status: 400 });
      }
    }

    // Verificar pausa programada. Para pedido AGENDADO esta é a única trava de
    // pausa (o `estadoDaLoja` acima não roda para ele). Comparar DATA da loja
    // com data: `new Date("AAAA-MM-DDT00:00")` era meia-noite do container
    // (UTC), então a pausa começava às 21:00 da véspera e voltava a aceitar
    // pedido às 21:00 do último dia de férias.
    const pause = franchisee.storePause as any;
    if (pause?.active && pause.from && pause.to) {
      const hoje = dataDaLoja(franchisee.storeTimezone);
      if (hoje >= pause.from && hoje <= pause.to) {
        const [a, m, d] = String(pause.to).split("-");
        return NextResponse.json({ error: `Loja em pausa até ${d}/${m}/${a}.` }, { status: 400 });
      }
    }

    // ── A LOJA ENTREGA NESTE ENDEREÇO? ──────────────────────────────────────
    //
    // A mesma regra do robô e da API de taxa (src/lib/area-de-entrega.ts).
    // FORA → recusa. ATENDE → a taxa é a da faixa/bairro, não a que veio no
    // corpo. DESCONHECIDO (mapa não achou) → em KM/ROTA e área desenhada o
    // site recusa e pede o pino no mapa; no bairro aceita pelo piso, e na
    // loja por km sem localização no mapa pela 1ª faixa — os dois marcados
    // para a loja conferir.
    // ── É ENTREGA OU RETIRADA? A pergunta é pelo COMPLEMENTO ───────────────
    //
    // A guarda de área rodava só quando `deliveryType` era exatamente
    // "DELIVERY". Qualquer outra palavra — "ENTREGA", "delivery" minúsculo,
    // "DELIVERY " com espaço — pulava raio, bairro, polígono e área de risco
    // de uma vez, e ainda gravava frete zero. A rota é PÚBLICA: a palavra vem
    // de fora.
    //
    // Agora a lista fechada é a da RETIRADA. O que não for retirada é entrega,
    // e entrega passa pela área. Palavra desconhecida cai no lado seguro.
    const RETIRADA = ["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO", "MESA"];
    const canalNormalizado = String(deliveryType || "").trim().toUpperCase();
    const ehRetirada = RETIRADA.includes(canalNormalizado);
    const ehEntrega = !ehRetirada;

    // ── A ENTREGA DESTE PEDIDO: A COTAÇÃO QUE O CLIENTE VIU, OU O MAPA ─────
    //
    // Regra e porquês em lib/entrega-do-pedido.ts. Em resumo:
    //
    //  1. O token `cotacao` que /api/delivery-fee assinou, desta loja e deste
    //     endereço, É o resultado — sem geocodificar de novo. Foi a segunda
    //     consulta ao mapa, 51 s depois da cotação, que cobrou R$ 12 (faixa
    //     mais cara) de quem a cotação tinha achado a 0,84 km (Divinos Burger,
    //     pedido #2 de 25/09/2026).
    //  2. Sem token válido (vencido, endereço mudou, aba antiga), o mapa é
    //     consultado com as MESMAS peças que a cotação recebe.
    //  3. Área desenhada e KM/ROTA não fecham com "não sei" nem com ponto
    //     aproximado: o site recusa e pede o pino no mapa (R2/R3) — tenha a
    //     loja pino ou não (o mapa abre no palpite ou no GPS do cliente). Só
    //     a loja por km SEM ponto dela no mapa segue pela 1ª faixa, marcada
    //     para conferir; bairro segue a regra antiga (piso e nota).
    let entrega: EntregaDoPedido | null = null;
    const modoDaLoja = modoDaArea(franchisee);
    if (ehEntrega) {
      // COORDENADA DO CORPO É PALPITE, NÃO PROVA. Ela decide a área inteira, e
      // esta rota é pública: fora da faixa válida, (0,0), ponto de enchimento
      // e lixo saem daqui.
      const coordsBrutas = body.customerCoords;
      const coords = coordenadaDoCorpo(coordsBrutas, body.customerCoordsOrigem);
      if (coordsBrutas && !coords) {
        console.warn(`[customer-order] customerCoords recusado (${JSON.stringify(coordsBrutas)}) na loja ${franchisee.id}`);
      }
      const partesDoEndereco = {
        street: typeof body.customerStreet === "string" ? body.customerStreet : undefined,
        number: typeof body.customerNumber === "string" ? body.customerNumber : undefined,
        neighborhood: typeof body.customerNeighborhood === "string" ? body.customerNeighborhood : undefined,
        city: franchisee.city || undefined,
      };

      const cotacao = cotacaoDoPedido(body.cotacao, {
        loja: franchisee.id,
        endereco: { ...partesDoEndereco, address: customerAddress },
        coords,
      });
      if (cotacao) {
        entrega = entregaDaCotacao(cotacao, modoDaLoja, coords);
      } else {
        if (body.cotacao) {
          // Veio token e não serviu: vencido, de outro endereço ou adulterado.
          // Não é erro — reavalia —, mas a frequência disto diz se o checkout
          // está mandando a chave certa.
          console.warn(`[customer-order] cotação recusada (vencida, outro endereço ou inválida) na loja ${franchisee.id} — reavaliando no mapa`);
        }
        let veredicto = null;
        try {
          // As MESMAS peças que a /api/delivery-fee recebe. Sem elas, a
          // cotação e a gravação geocodificavam o mesmo endereço de jeitos
          // diferentes: duas respostas para o mesmo endereço, no mesmo fluxo.
          veredicto = await avaliarEntrega(franchisee, {
            endereco: customerAddress,
            coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
            ...(coords ? { origemDasCoords: coords.origem === "pino" ? ("pino" as const) : ("gps" as const) } : {}),
            bairro: partesDoEndereco.neighborhood,
            partes: partesDoEndereco,
          });
        } catch (e: any) {
          console.warn(`[customer-order] avaliarEntrega falhou na loja ${franchisee.id}: ${e?.message || e}`);
        }
        entrega = entregaDoVeredicto(veredicto, coords, modoDaLoja);
      }

      const recusa = recusaDoSite(entrega, {
        temCoordenadaDoCliente: coords != null,
        lojaTemPonto: lerPontoDaLoja(franchisee.storeLatLng) != null,
      });
      if (recusa) {
        console.warn(`[customer-order] entrega recusada na loja ${franchisee.id} (${entrega.fonte}, ${entrega.resultado ?? "sem resposta"}): ${entrega.motivo}`);
        return NextResponse.json(recusa.corpo, { status: recusa.status });
      }
      if (entrega.lojaSemPonto) {
        // Só chega aqui a loja em KM/ROTA cujo PRÓPRIO ponto é desconhecido
        // (sem pino e o endereço dela não achado): nem o pino do cliente
        // mediria. Sai pela 1ª faixa, marcado — nunca a faixa mais cara (R2).
        console.warn(`[customer-order] loja ${franchisee.id} em KM/ROTA sem localização no mapa: entrega aceita pela 1ª faixa, sem distância`);
      }
    }

    // Buscar produtos do menu
    // ISOLAMENTO ENTRE LOJAS: o produto TEM que ser desta loja.
    // Esta rota e PUBLICA. Sem o filtro de franchiseeId, qualquer pessoa na
    // internet mandava no carrinho da loja A um menuProductId da loja B: o
    // pedido nascia na loja A, mas a baixa de estoque seguia a ficha tecnica
    // daquele produto e derrubava o insumo DA LOJA B. De quebra, a fila de
    // impressao devolvia o objeto inteiro do produto alheio, inclusive o campo
    // `cost` — a margem do concorrente.
    const productIds = items.map((i: any) => i.menuProductId).filter(Boolean);
    const menuProducts = await prisma.menuProduct.findMany({
      // ── A MESMA REGRA DA VITRINE, e por que ela precisa estar AQUI ────────
      //
      // A vitrine (loja/[slug]) já não mostra complemento nem item desligado no
      // delivery. Mas esta rota aceitava qualquer id: bastava um POST direto —
      // ou uma aba aberta desde antes — para o "Adicional de Bacon" (preço
      // R$ 0,00, `apenasEmCombo: true`) entrar no carrinho e ser gravado. O piso
      // de `precoMinimoDoProduto` não segura: complemento não tem grupo próprio,
      // então o mínimo dele é o próprio zero, e a comanda saía com bacon de graça.
      //
      // Item não encontrado aqui já vira 400 com texto claro (logo abaixo), que é
      // exatamente o comportamento certo: recusar explicando, não cobrar zero.
      //
      // `NOT` em vez de `apenasEmCombo: false` para cobrir linha antiga com NULL.
      where: {
        id: { in: productIds },
        active: true,
        activeDelivery: true,
        franchiseeId: franchisee.id,
        NOT: { apenasEmCombo: true },
      },
      // Os grupos vêm junto porque o preço do item depende deles: sem isso o
      // servidor não tem como saber quanto custa a opção que o cliente marcou.
      include: {
        comboGroups: {
          include: { items: { include: { menuProduct: { select: { name: true, price: true } } } } },
        },
      },
    });

    // Calcular total dos produtos
    let totalAmount = 0;
    const orderItems = items.map((item: any) => {
      const product = menuProducts.find(p => p.id === item.menuProductId);
      // Antes isto era um throw solto, que caia no catch generico e virava 500
      // sem explicacao. Agora o cliente entende o que aconteceu.
      if (!product) {
        throw Object.assign(
          new Error("Um dos itens do carrinho não está mais disponível nesta loja."),
          { statusCode: 400 }
        );
      }

      // Promoção de dia específico não pode ser comprada fora do dia dela. A
      // vitrine já esconde o item, mas a aba aberta desde ontem — ou um POST
      // direto na rota — ainda mandava a esfirra de segunda no domingo, pelo
      // preço de promoção. Mesma regra do totem (api/totem/order).
      if (!disponivelHoje((product as any).availableDays, diaDaSemanaDaLoja(franchisee.storeTimezone))) {
        throw Object.assign(
          new Error(`"${product.name}" só está disponível em dias específicos e hoje não é um deles.`),
          { statusCode: 400 }
        );
      }
      // ── PREÇO COM AS OPÇÕES ESCOLHIDAS ────────────────────────────────
      // Antes somava só `product.price`, ignorando o que o cliente marcou
      // dentro do combo. No "Nugget" da Hakim, cujo preço base é R$ 0,00 e o
      // valor inteiro está nas opções (6/15/40 unidades), o pedido era gravado
      // por R$ 0,00 — a loja entregava e recebia nada. Já aconteceu uma vez,
      // por outro canal.
      //
      // A conta agora é a mesma em todo lugar (src/lib/preco-combo.ts), e
      // continua sendo feita AQUI, no servidor: o carrinho manda só o que foi
      // escolhido, nunca o preço.
      //
      // Canal DELIVERY: o preço cobrado tem que ser o MESMO que a vitrine
      // mostrou (loja/[slug] aplica o preço do canal antes de renderizar).
      // Cobrar pela base aqui seria mostrar um preço e cobrar outro.
      // ComCombo, não só o produto: nas lojas que põem o preço na OPÇÃO de
      // tamanho (base R$ 0,00), resolver só a base cobraria o preço de tabela
      // das opções — e a vitrine já mostrou o do delivery.
      const produtoNoCanal = aplicarPrecoDoCanalComCombo(product as any, "delivery");
      let precoUnitario = precoUnitarioDoItem(produtoNoCanal as any, item.comboSelections);

      // Piso: se a escolha não vier, vier vazia, ou o nome não casar com nenhuma
      // opção do grupo, o cálculo devolve só a base — e no "Nugget" (base
      // R$ 0,00) isso é um pedido de graça. Cobrar o mínimo possível é o pior
      // caso aceitável; entregar sem cobrar não é.
      // `pisoDoPreco`, não o "a partir de": a meia pizza mais barata DESCONTA
      // (acréscimo negativo), e o "a partir de" como piso a cobrava cheia.
      const minimoDoProduto = pisoDoPreco(produtoNoCanal as any);
      if (precoUnitario < minimoDoProduto) {
        console.warn(
          `[customer-order] "${product.name}" sairia por R$ ${precoUnitario} sem escolha válida ` +
          `(loja ${franchisee.id}); aplicando o mínimo R$ ${minimoDoProduto}.`
        );
        precoUnitario = minimoDoProduto;
      }

      // ── QUANTIDADE É INTEIRO POSITIVO ────────────────────────────────────
      //
      // Nada validava este campo. Com `quantity: -5` o total ficava NEGATIVO e
      // dava para zerar o pedido inteiro (comida de graça) ou até gerar
      // "crédito"; com 0.5 nascia meio hambúrguer na comanda; com 99999, um
      // pedido impossível travando a cozinha. O carrinho manda o que quiser —
      // quem decide é aqui.
      const qtd = Number(item.quantity);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 200) {
        throw Object.assign(
          new Error(`Quantidade inválida para "${product.name}". Informe um número inteiro de 1 a 200.`),
          { statusCode: 400 }
        );
      }
      item.quantity = qtd;

      totalAmount += precoUnitario * item.quantity;
      // `notes` e a observacao POR ITEM ("sem cebola"). O carrinho ja mandava
      // (CustomerStorePage envia notes em cada item) e a impressao/KDS ja liam
      // i.notes — mas aqui ela era descartada, entao nunca chegava na cozinha.
      return {
        menuProductId: product.id,
        quantity: item.quantity,
        // O NOME NO MOMENTO DA VENDA. A coluna existia e o pedido do site
        // nunca a preenchia: quem lê `productName` sem cair na relação via
        // "item" no lugar do nome — a tela de editar itens é a mais visível, e
        // a comanda só escapava porque o Assistente tem o `menuProduct.name`
        // de reserva. Também é o que faz o histórico sobreviver ao produto
        // renomeado ou apagado do cardápio depois da venda.
        productName: product.name,
        price: precoUnitario,
        notes: typeof item.notes === "string" && item.notes.trim() ? item.notes.trim().slice(0, 500) : null,
        comboSelections: item.comboSelections || null,
      };
    });

    // ── ESTOQUE DISPONÍVEL ("acabou, fecha") ─────────────────────────────
    // O cardápio público é cacheado por 60 s: o cliente pode ter no carrinho
    // o produto que acabou de esgotar. Soma por produto (a mesma costela em
    // duas linhas) e recusa com a frase que o carrinho mostra.
    const estoque = await conferirEstoque(franchisee.id, orderItems);
    if (!estoque.ok) {
      throw Object.assign(new Error(`${estoque.mensagem} Ajuste o carrinho e tente de novo.`), { statusCode: 409 });
    }

    // Regra de Frete Grátis por valor mínimo da loja
    const delivConfig = (franchisee.deliveryConfig as any) || {};
    const isFreeShippingMin = Boolean(
      deliveryType === "DELIVERY" &&
      (delivConfig.freeShippingActive === true || delivConfig.freeShippingActive === "true") &&
      delivConfig.freeShippingMinValue &&
      Number(delivConfig.freeShippingMinValue) > 0 &&
      totalAmount >= Number(delivConfig.freeShippingMinValue)
    );

    // ── TAXA DE ENTREGA: VEM DO CLIENTE, ENTÃO NÃO SE CONFIA ──────────────
    // Esta rota é PÚBLICA e `deliveryFee` chega no corpo da requisição. Sem
    // piso, um `deliveryFee: -195` num carrinho de R$ 200 fazia o total virar
    // R$ 5,00 — e era esse valor que ia para o banco e, de lá, para a
    // cobrança no gateway. Frete negativo não existe: qualquer valor abaixo
    // de zero é descartado.
    //
    // O teto é rede de segurança contra o oposto (inflar o pedido de outra
    // pessoa): frete acima de R$ 200 ou maior que 3x o valor dos itens não é
    // frete, é erro ou abuso.
    const feeInformada = ehEntrega ? Number(deliveryFee) : 0;
    const feeEhNumero = Number.isFinite(feeInformada);

    // O teto é ABSOLUTO de propósito, não proporcional ao valor dos itens.
    // `totalAmount` sai subestimado quando o pedido tem combo com adicional
    // (bug conhecido e ainda não corrigido, fora do escopo desta mudança), e
    // amarrar o teto a ele faria frete legítimo ser zerado justamente nos
    // pedidos com combo. R$ 300 de entrega não existe em delivery de bairro.
    const TETO_FRETE = 300;
    const feeForaDaFaixa = !feeEhNumero || feeInformada < 0 || feeInformada > TETO_FRETE;

    if (ehEntrega && feeForaDaFaixa && deliveryFee !== undefined && deliveryFee !== null) {
      console.warn(
        `[customer-order] deliveryFee recusado (${JSON.stringify(deliveryFee)}) na loja ${franchisee.id} — gravando 0.`
      );
    }

    let originalFee = feeForaDaFaixa ? 0 : feeInformada;
    // Distância estimada, ponto aproximado, endereço não localizado: o que a
    // loja precisa conferir vai escrito no pedido (lib/entrega-do-pedido.ts).
    const notaDaArea = entrega ? notasDaEntrega(entrega, { canal: "site" }).map((n) => ` ${n}`).join("") : "";
    if (entrega?.resultado === "ATENDE" && entrega.taxa != null && entrega.modo !== "SEM_AREA") {
      // A taxa é a da regra da loja — da cotação que o cliente viu, ou do
      // mapa agora. Se o navegador mandou outra, vale a regra.
      const daRegra = Math.round(Number(entrega.taxa) * 100) / 100;
      if (Math.abs(daRegra - originalFee) >= 0.01) {
        console.warn(`[customer-order] taxa do corpo (${originalFee}) ≠ taxa da área (${daRegra}, ${entrega.fonte}) na loja ${franchisee.id} — gravando a da área.`);
      }
      originalFee = daRegra;
    } else if (ehEntrega && entrega?.modo === "KM") {
      // ── KM/ROTA SEM MEDIDA: A 1ª FAIXA, NUNCA A MAIS CARA (R2) ─────────
      //
      // "Não sei" e ponto aproximado já foram recusados lá em cima; aqui só
      // chega a loja sem ponto no mapa (entrega.lojaSemPonto). A régua antiga
      // — a faixa mais cara — cobrava R$ 20 de quem mora a 300 m. A taxa é a
      // da 1ª faixa (ou a fixa), a mesma que /api/delivery-fee mostrou, e o
      // pedido vai com a nota para a loja corrigir (R10). O corpo não decide:
      // aba antiga com a taxa velha ou POST direto com qualquer valor.
      const daPrimeiraFaixa = taxaDaLojaSemPonto(franchisee.deliveryZones, taxaFixaDaLoja(franchisee as any));
      if (Math.abs(daPrimeiraFaixa - originalFee) >= 0.01) {
        console.warn(`[customer-order] taxa do corpo (${originalFee}) ≠ 1ª faixa (${daPrimeiraFaixa}) na loja ${franchisee.id} sem localização — gravando a 1ª faixa.`);
      }
      originalFee = daPrimeiraFaixa;
    } else if (ehEntrega) {
      // ── O CORPO NÃO DEFINE A TAXA SOZINHO ────────────────────────────
      //
      // Quando o veredicto não é ATENDE (endereço que o mapa não achou, ou
      // loja sem área cadastrada), a taxa gravada era exatamente a que o
      // navegador mandou — e `deliveryFee: 0` num POST fazia a loja entregar
      // de graça, toda vez, sem nada no pedido dizendo por quê.
      //
      // O piso é calculado AQUI, com a mesma régua da cotação (a faixa mais
      // cara da loja, ou a taxa fixa dela). Quem mandar menos que isso grava o
      // piso; quem mandar mais grava o que mandou (a loja pode ter combinado
      // um valor maior com o cliente).
      const zonasDaLoja = Array.isArray(franchisee.deliveryZones) ? (franchisee.deliveryZones as any[]) : [];
      const maisCara = Math.max(0, ...zonasDaLoja.map((z: any) => Number(z?.fee) || 0));
      const piso = Math.round((maisCara || taxaFixaDaLoja(franchisee as any) || 0) * 100) / 100;
      // KM/ROTA tem o ramo próprio acima, e na área desenhada "não sei" é
      // recusado lá em cima (o cliente confirma o pino). Sobra a loja de
      // bairro e a sem área cadastrada.
      if (piso > originalFee) {
        console.warn(`[customer-order] taxa do corpo (${originalFee}) abaixo do piso da loja (${piso}) em ${franchisee.id} — gravando o piso.`);
        originalFee = piso;
      }
    }
    let fee = originalFee;
    let freeShippingNote = "";
    // O que a entrega custaria e por que não foi cobrada. Guardado no pedido
    // (lib/entrega-gratis.ts) porque `deliveryFee: 0` apaga a informação, e a
    // nota passava a não ter linha de entrega nenhuma.
    let entregaGratis: EntregaGratis | null = null;

    if (isFreeShippingMin) {
      fee = 0; // Isenta a taxa cobrada
      const minimo = Number(delivConfig.freeShippingMinValue);
      freeShippingNote = ` [Frete Grátis (Pedido >= R$ ${minimo.toFixed(2).replace('.', ',')}) — Taxa ref: R$ ${originalFee.toFixed(2).replace('.', ',')}]`;
      if (originalFee > 0) entregaGratis = { valor: originalFee, motivo: porValorMinimo(minimo) };
    }

    // ── CUPOM DE DESCONTO ─────────────────────────────────────────────────
    //
    // A régua é lib/cupons.ts (validade, limite de usos por cliente, primeiro
    // pedido, mínimo) e os fatos vêm do banco (lib/cupons-no-banco.ts). É a
    // MESMA avaliação que /api/validate-coupon deu ao site quando o cliente
    // digitou o código — aqui ela roda de novo na hora de gravar, porque o que
    // chega do navegador é intenção, não prova.
    //
    // A recusa volta escrita, nunca em silêncio. O código antigo zerava o
    // desconto de um cupom abaixo do mínimo sem dizer nada, e o cliente via o
    // total subir na hora de pagar sem saber por quê.
    let discount = 0;
    if (couponCode) {
      const coupon = acharCupom(cuponsComCampanha(franchisee.storeCoupons, franchisee.storeLoyalty), couponCode);
      if (coupon) {
        const fatos = await fatosDoCupom(coupon, {
          franchiseeId: franchisee.id,
          telefone: customerPhone,
          timeZone: (franchisee as any).storeTimezone,
          subtotal: totalAmount,
          taxa: fee,
        });
        const veredito = avaliarCupom(coupon, fatos);
        if (!veredito.ok) {
          return NextResponse.json({ error: veredito.motivo }, { status: 400 });
        }
        if (veredito.zeraTaxa) {
          discount = fee;
          if (fee > 0) entregaGratis = { valor: fee, motivo: `Cupom ${coupon.code}` };
          fee = 0;
        } else {
          discount = veredito.desconto;
        }
      }
    }

    // ── PRÊMIO DA TRILHA PREMIADA ────────────────────────────────────────
    //
    // Quem decide qual prêmio está valendo é o servidor, relendo os pedidos
    // deste telefone (lib/premio-no-pedido.ts). O corpo da requisição só
    // consegue DISPENSAR o prêmio, nunca criar um: esta rota é pública, e um
    // prêmio que viesse do navegador seria um desconto digitado pelo cliente.
    //
    // O prêmio que não cabe no pedido (frete grátis numa retirada, produto que
    // saiu do cardápio) não é consumido: continua esperando o próximo pedido.
    let resgateDaTrilha: any = null;
    if (body.dispensarPremioDaTrilha !== true) {
      try {
        const parada = await premioDoCliente(franchisee.id, franchisee.storeLoyalty, customerPhone);
        if (parada) {
          const produtoDoPremio = parada.tipo === "produto" && parada.produtoId
            ? await prisma.menuProduct.findFirst({
                where: { id: parada.produtoId, franchiseeId: franchisee.id },
                select: { id: true, name: true, price: true, active: true },
              })
            : null;
          const efeito = efeitoDoPremio(parada, {
            subtotal: totalAmount,
            taxa: fee,
            // Mesmo padrão do `create` abaixo: sem deliveryType, é entrega.
            entrega: (deliveryType || "DELIVERY") === "DELIVERY",
            produto: produtoDoPremio,
          });
          if (efeito) {
            if (efeito.zeraTaxa) {
              if (fee > 0) entregaGratis = { valor: fee, motivo: "Prêmio da Trilha Premiada" };
              fee = 0;
            }
            discount += efeito.descontoExtra;
            if (efeito.produtoGratis) {
              // Entra como ITEM do pedido com preço zero: a cozinha imprime e
              // prepara o brinde, e o subtotal não se mexe.
              orderItems.push({
                menuProductId: efeito.produtoGratis.id,
                quantity: 1,
                productName: efeito.produtoGratis.nome,
                price: 0,
                notes: "Prêmio da Trilha Premiada",
                comboSelections: null,
              });
            }
            resgateDaTrilha = efeito.resgate;
          }
        }
      } catch (e) {
        // Prêmio é bônus: nunca pode impedir o pedido de entrar.
        console.error("[customer-order] trilha premiada:", e);
      }
    }

    // Arredonda para centavos ANTES de gravar. Em JS 29.9*3 = 89.69999999999999,
    // e era esse número que ia para o banco (`totalAmount Float`) e daí cru como
    // `transaction_amount` para o gateway — que recusa moeda com mais de 2 casas.
    const centavos = (n: number) => Math.round(n * 100) / 100;
    const finalTotal = centavos(Math.max(0, totalAmount - discount + fee));
    // A taxa é gravada ao lado do total e entra em relatório; arredondar só o
    // total deixaria os dois divergindo em frações de centavo.
    fee = centavos(fee);
    let orderNotes = notes || "";
    if (couponCode && discount > 0) {
      orderNotes = `[Cupom: ${couponCode.trim().toUpperCase()}] ${orderNotes}`.trim();
    }
    if (freeShippingNote) {
      orderNotes = `${orderNotes} ${freeShippingNote}`.trim();
    }
    if (resgateDaTrilha) {
      // Sai na comanda: quem monta o pedido precisa ver o brinde, e o motoboy
      // precisa saber por que a entrega está zerada.
      orderNotes = `[Trilha Premiada: ${resgateDaTrilha.descricao}] ${orderNotes}`.trim();
    }
    if (notaDaArea) {
      orderNotes = `${orderNotes}${notaDaArea}`.trim();
    }
    const finalNotes = orderNotes || null;

    // ── O QUE A ENTREGA DEIXA GRAVADO (R7) ────────────────────────────────
    //
    // Distância, o ponto que decidiu a taxa ({lat,lng,origem,medida}) e o
    // repasse da faixa — este só quando a loja separou os dois valores (tela
    // de Entrega); sem isso fica nulo e o relatório usa o acerto do próprio
    // entregador. Antes o ponto que o MAPA achou era descartado e só a
    // coordenada do corpo era gravada: 2 de 168 entregas do site em lojas KM
    // tinham ponto, e a roteirização geocodificava de novo — no pedido #5 da
    // Divinos, a 4,95 km de onde a taxa tinha medido 0,13 km.
    const doPedido = ehEntrega && entrega
      ? camposDaEntrega(entrega, lerRegraDeRepasse(franchisee.deliveryConfig), franchisee.deliveryZones)
      : { deliveryDistance: null, customerLatLng: null, motoboyFee: null };
    const repasseDoEntregador = doPedido.motoboyFee;
    const distanciaDaEntrega = doPedido.deliveryDistance;

    const pmUpper = (paymentMethod || "").toUpperCase().trim();
    const isOnlinePayment = pmUpper.includes("ONLINE") || pmUpper === "PIX" || pmUpper === "PIX_ONLINE" || pmUpper === "CREDITO_ONLINE" || pmUpper === "DEBITO_ONLINE";

    const initialStatus = isOnlinePayment
      ? "AGUARDANDO_PAGAMENTO"
      : franchisee.autoAcceptOrders
      ? "ACEITO"
      : "NOVO";

    const initialKdsStage = isOnlinePayment ? null : "PRODUCTION";
    const initialKdsProductionAt = isOnlinePayment ? null : new Date();

    const dailyOrderNumber = isOnlinePayment 
      ? null 
      : await generateDailyOrderNumber(franchisee.id);

    // Criar pedido
    const order = await prisma.customerOrder.create({
      data: {
        franchiseeId: franchisee.id,
        dailyOrderNumber,
        customerName, customerPhone,
        customerAddress: customerAddress || null,
        deliveryType: deliveryType || "DELIVERY",
        paymentMethod: paymentMethod || null,
        changeAmount: body.changeAmount ? Number(body.changeAmount) : (body.changeFor ? Number(body.changeFor) : null),
        notes: finalNotes,
        totalAmount: finalTotal,
        deliveryFee: fee,
        // O cupom da loja fica REGISTRADO, não só abatido: a mensalidade é
        // sobre o bruto do pedido (lib/billing.ts, faturamentoBruto), e sem
        // isto o desconto sumia do total e a base de cobrança encolhia junto.
        ...(discount > 0 ? { discountTotal: centavos(discount), discountMerchant: centavos(discount) } : {}),
        ...(resgateDaTrilha ? { trilhaPremio: resgateDaTrilha } : {}),
        ...(entregaGratis ? { entregaGratis } : {}),
        // ── O QUE A LOJA PAGA AO ENTREGADOR ─────────────────────────────
        //
        // Gravado na VENDA, não calculado no relatório: a loja reajusta a
        // tabela de entrega e o acerto do mês passado continuaria batendo com
        // o que ela realmente pagou. A regra é uma só, em
        // lib/repasse-do-entregador.ts, e a faixa/bairro que decidiu a taxa do
        // cliente é a mesma que decide esta (lib/area-de-entrega.ts).
        ...(repasseDoEntregador != null ? { motoboyFee: repasseDoEntregador } : {}),
        // A distância que a área de entrega JÁ mediu para decidir a taxa (0 km
        // vale: cliente na porta da loja). Sem ela gravada, a escada de km do
        // entregador não tem o que comparar e o acerto cai no valor por
        // entrega (lib/distancia-da-entrega.ts).
        ...(distanciaDaEntrega != null ? { deliveryDistance: distanciaDaEntrega } : {}),
        status: initialStatus,
        kdsStage: initialKdsStage,
        kdsProductionAt: initialKdsProductionAt,
        // O PONTO QUE DECIDIU A TAXA FICA NO PEDIDO — o pino/GPS do cliente,
        // ou o ponto que o mapa achou para o endereço digitado.
        //
        // Ele decidia a área e era jogado fora: a roteirização, o app do
        // entregador e o mapa do painel geocodificavam o endereço DE NOVO — e
        // erravam de novo, do mesmo jeito que o mapa erra. A coluna já existe
        // e é a mesma que o iFood preenche com o ponto que o parceiro manda;
        // quem lê `{lat,lng}` continua lendo (origem e medida são extras).
        ...(doPedido.customerLatLng ? { customerLatLng: doPedido.customerLatLng } : {}),
        // Cookies do GA4 do cliente, capturados no cardápio. É o que permite o
        // `purchase` enviado pelo NOSSO servidor cair na mesma pessoa e na
        // mesma sessão que veio do anúncio — sem eles a venda aparece como
        // visitante novo, sem origem. Vazio quando o cliente bloqueia cookie
        // ou quando a loja não usa GA4: o disparo simplesmente não acontece.
        gaClientId: typeof body.gaClientId === "string" ? body.gaClientId.slice(0, 64) : null,
        gaSessionId: typeof body.gaSessionId === "string" ? body.gaSessionId.slice(0, 32) : null,
        items: { create: orderItems }
      }
    });

    // Se NÃO for pagamento online (ex: dinheiro/maquininha na entrega), envia direto para a fila de impressão da loja!
    if (!isOnlinePayment) {
      try {
        const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
        const formattedOrder = {
          id: order.id,
          dailyOrderNumber: order.id.slice(-4).toUpperCase(),
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerAddress: order.customerAddress,
          deliveryType: order.deliveryType || "DELIVERY",
          paymentMethod: order.paymentMethod || "Não informado",
          isPrepaid: false,
          items: orderItems.map((i: any) => ({
            name: menuProducts.find(p => p.id === i.menuProductId)?.name || "Item",
            qty: i.quantity,
            price: i.price,
            comboSelections: i.comboSelections,
          })),
          totalAmount: finalTotal,
          deliveryFee: fee,
          notes: finalNotes,
          createdAt: order.createdAt.toISOString(),
        };
        pushJobToPrintQueue(franchisee.id, formattedOrder, franchisee.storeName || "FIREHUB", "80mm");
      } catch (errPrint) {
        console.error("[CustomerOrder] Auto-print error:", errPrint);
      }
    }

    // Incrementar contador de pedidos (Pay as You Grow)
    await prisma.user.update({
      where: { id: franchisee.id },
      data: { storeOrderCount: { increment: 1 } }
    });

    // Envia notificação WhatsApp de confirmação de pedido recebido apenas se for pagamento presencial (não-online)
    if (!isOnlinePayment) {
      const { sendOrderNotification } = await import("@/lib/order-notifications");
      sendOrderNotification(order.id, "CREATED").catch(err =>
        console.warn("[CustomerOrder] Erro ao enviar notificação CREATED:", err)
      );

      // ── PURCHASE PARA O META, PELO SERVIDOR ───────────────────────────────
      //
      // Só no pagamento na entrega, e é aqui de propósito: nesse fluxo o pedido
      // JÁ É a venda — não existe confirmação depois. `paymentPaidAt` fica nulo
      // para sempre, então ancorar o evento em `confirmOrderPayment` mandaria
      // ZERO conversão para o tráfego real das lojas.
      //
      // O pedido de pagamento ONLINE não passa por aqui: ele dispara em
      // order-payment-confirm.ts, quando o dinheiro entra. Disparar na criação
      // contaria como venda quem desiste na tela do cartão — inflando o número
      // e ensinando o algoritmo a buscar mais gente que abandona.
      //
      // Sem await: o Meta não pode segurar a resposta do pedido.
      const { dispararCompraNoMeta } = await import("@/lib/meta-purchase");
      dispararCompraNoMeta(order.id).catch(err =>
        console.error("[Meta CAPI] Falha ao enviar Purchase:", err)
      );

      // Mesmo evento, mesma regra, para o GA4 (Measurement Protocol). Só sai
      // se a loja configurou GA4 e se o pedido guardou o `client_id` do
      // cookie — sem ele a compra viraria um visitante novo sem origem.
      const { dispararCompraNoGoogle } = await import("@/lib/ga-purchase");
      dispararCompraNoGoogle(order.id).catch(err =>
        console.error("[GA4 MP] Falha ao enviar purchase:", err)
      );
    }

    // Se auto-aceito e não-online, contabiliza no faturamento e deduz estoque imediatamente
    if (franchisee.autoAcceptOrders && !isOnlinePayment) {
      trackSaleForBilling(franchisee.id).catch(err =>
        console.error("[Billing] Erro ao atualizar ciclo:", err)
      );
      const { deductStockForOrder } = await import("@/lib/stock");
      deductStockForOrder(order.id).catch(err =>
        console.error("[Stock] Erro ao deduzir estoque auto-aceito:", err)
      );
    }

    return NextResponse.json({
      orderId: order.id,
      total: finalTotal,
      // A taxa que ficou gravada: o checkout confere com a que mostrou antes
      // de abrir o Pix (a cotação e o pedido não podem divergir calados).
      deliveryFee: fee,
      discount,
      status: initialStatus,
      autoAccepted: franchisee.autoAcceptOrders,
    });

  } catch (error: any) {
    console.error("Erro ao criar pedido:", error);
    // Erros de validacao carregam statusCode e devem chegar ao cliente como 4xx
    // com a mensagem util, em vez de virarem "Erro interno" 500.
    const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
    return NextResponse.json(
      { error: status === 500 ? "Erro interno." : error.message },
      { status }
    );
  }
}
