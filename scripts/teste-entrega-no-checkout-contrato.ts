/**
 * CONTRATO: a cotação que o checkout (site e balcão) pede é a que o pedido
 * aceita de volta.
 *
 *   npx tsx scripts/teste-entrega-no-checkout-contrato.ts
 *
 * O caminho inteiro, sem rede e sem banco:
 *   1. a tela monta a consulta (consultaDaCotacao / consultaDoBalcao);
 *   2. o servidor da cotação assina com chaveDoEndereco(street, number,
 *      neighborhood, address, lat, lng) — como a especificação manda para
 *      /api/delivery-fee (R1);
 *   3. a tela monta o corpo do pedido (entregaNoPedidoDoSite /
 *      entregaNoPedidoDoBalcao);
 *   4. o pedido lê o token com a regra de lib/entrega-do-pedido.ts.
 *
 * Se qualquer lado mudar o que entra na chave, este teste quebra antes de o
 * cliente pagar R$ 12 por uma entrega cotada a R$ 5.
 */
process.env.COTACAO_SECRET = "segredo-de-teste";
import { assinarCotacao, chaveDoEndereco } from "../src/lib/cotacao-de-entrega";
import {
  assinaturaDaConsulta,
  consultaDaCotacao,
  consultaDoBalcao,
  entregaNoPedidoDoBalcao,
  entregaNoPedidoDoSite,
  type PontoDoCliente,
} from "../src/lib/entrega-no-checkout";
import { coordenadaDoCorpo, cotacaoDoPedido } from "../src/lib/entrega-do-pedido";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`); }
}

const LOJA = "cmudbzcus0008ka010pmo1e0w";

/** O servidor da cotação, como a especificação o define: lê a query e assina. */
function cotarNoServidor(query: string, loja: string, taxa: number) {
  const q = new URLSearchParams(query);
  const lat = q.get("lat") != null ? parseFloat(q.get("lat")!) : null;
  const lng = q.get("lng") != null ? parseFloat(q.get("lng")!) : null;
  const chave = chaveDoEndereco({
    street: q.get("street") || "",
    number: q.get("number") || "",
    neighborhood: q.get("neighborhood") || "",
    address: q.get("address") || "",
    lat, lng,
  });
  return assinarCotacao({
    loja, chave, lat: lat ?? -22.8518, lng: lng ?? -42.0353, origemDoPonto: lat != null ? "gps" : "mapa",
    distanciaKm: 0.84, medida: "rota", faixaKm: 1, taxa, taxaDoEntregador: 4, tempoMin: 30,
  });
}

// ── SITE ─────────────────────────────────────────────────────────────────
{
  const endereco = { street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" };

  // Sem ponto: o texto decide.
  const token = cotarNoServidor(consultaDaCotacao({ franchiseeId: LOJA, cidade: "Cabo Frio", ...endereco, ponto: null }), LOJA, 5);
  const corpo = {
    customerAddress: "Travessa Canaã, 6 - Boca do Mato (casa 2)",
    customerStreet: endereco.street, customerNumber: endereco.number, customerNeighborhood: endereco.neighborhood,
    ...entregaNoPedidoDoSite(null, token),
  };
  const coords = coordenadaDoCorpo(corpo.customerCoords, corpo.customerCoordsOrigem);
  const lida = cotacaoDoPedido(corpo.cotacao, {
    loja: LOJA,
    endereco: { street: corpo.customerStreet, number: corpo.customerNumber, neighborhood: corpo.customerNeighborhood, address: corpo.customerAddress },
    coords,
  });
  confere("site sem ponto: o pedido aceita a cotação (complemento não atrapalha)", lida?.taxa === 5, lida);

  // Com o pino confirmado: rua/número/bairro + ponto na cotação e no pedido.
  const pino: PontoDoCliente = { lat: -22.8531234, lng: -42.0301234, origem: "pino" };
  const tokenPino = cotarNoServidor(consultaDaCotacao({ franchiseeId: LOJA, cidade: "Cabo Frio", ...endereco, ponto: pino }), LOJA, 5);
  const corpoPino = {
    customerAddress: "Travessa Canaã, 6 - Boca do Mato",
    customerStreet: endereco.street, customerNumber: endereco.number, customerNeighborhood: endereco.neighborhood,
    ...entregaNoPedidoDoSite(pino, tokenPino),
  };
  const coordsPino = coordenadaDoCorpo(corpoPino.customerCoords, corpoPino.customerCoordsOrigem);
  confere("site com pino: o pedido lê a origem 'pino'", coordsPino?.origem === "pino", coordsPino);
  const lidaPino = cotacaoDoPedido(corpoPino.cotacao, {
    loja: LOJA,
    endereco: { street: corpoPino.customerStreet, number: corpoPino.customerNumber, neighborhood: corpoPino.customerNeighborhood, address: corpoPino.customerAddress },
    coords: coordsPino,
  });
  confere("site com pino: o pedido aceita a cotação", lidaPino?.taxa === 5, lidaPino);

  // GPS dentro de customerCoords também é lido (quem só olha o objeto).
  const soDentro = coordenadaDoCorpo({ lat: -22.85312, lng: -42.03012, origem: "gps" });
  confere("origem dentro de customerCoords também vale", soDentro?.origem === "gps");

  // Número trocado depois da cotação: a tela recota (assinatura muda) e o
  // servidor também recusaria o token velho — os dois lados concordam.
  const assinaturaCotada = assinaturaDaConsulta(endereco, pino);
  const enderecoNovo = { ...endereco, number: "60" };
  confere("número trocado: a tela sabe que a cotação é de outro endereço", assinaturaDaConsulta(enderecoNovo, pino) !== assinaturaCotada);
  const lidaVelha = cotacaoDoPedido(tokenPino, {
    loja: LOJA, endereco: { ...enderecoNovo, address: "Travessa Canaã, 60 - Boca do Mato" }, coords: coordsPino,
  });
  // (com ponto, o pedido também aceita a chave "só do ponto" — e esta cotação
  // foi assinada com rua+ponto, então não casa: vale a do endereço novo)
  confere("número trocado: o pedido não usa a cotação velha", lidaVelha === null, lidaVelha);

  confere("outra loja não usa a cotação", cotacaoDoPedido(token, {
    loja: "outra", endereco: { street: endereco.street, number: endereco.number, neighborhood: endereco.neighborhood }, coords: null,
  }) === null);
}

// ── BALCÃO ───────────────────────────────────────────────────────────────
{
  const textos = [
    "Travessa Canaã, 6 - Boca do Mato", "Rua Diamante 19 Monte Alegre", "  Rua Beira Alta, 11, Vila Monte Alegre, Cabo Frio  ",
    // Referência e cidade no lugar do bairro: sem partes, só o texto — dos dois lados.
    "Rua Beira Alta, 100 - perto do Shopping Park Lagos", "Rua X, 10 - Cabo Frio",
  ];
  // Com e sem a cidade da loja (a sessão chega depois da tela): o que importa
  // é a MESMA cidade na cotação e no POST.
  for (const cidade of [undefined, "Cabo Frio - RJ"]) {
    for (const texto of textos) {
      const token = cotarNoServidor(consultaDoBalcao(texto, cidade), LOJA, 8);
      const corpo: any = { customerAddress: texto, ...entregaNoPedidoDoBalcao(texto, { token, endereco: texto.trim() }, false, cidade) };
      const lida = cotacaoDoPedido(corpo.cotacao, {
        loja: LOJA,
        endereco: { street: corpo.customerStreet, number: corpo.customerNumber, neighborhood: corpo.customerNeighborhood, address: String(corpo.customerAddress).trim() },
        coords: coordenadaDoCorpo(corpo.customerCoords, corpo.customerCoordsOrigem),
      });
      confere(`balcão '${texto.trim()}' (cidade ${cidade ?? "—"}): o pedido aceita a cotação`, lida?.taxa === 8, { corpo, lida });
    }
  }
  {
    const q = new URLSearchParams(consultaDoBalcao("Rua X, 10 - Cabo Frio", "Cabo Frio - RJ"));
    const corpo: any = entregaNoPedidoDoBalcao("Rua X, 10 - Cabo Frio", null, false, "Cabo Frio - RJ");
    confere("balcão: a cidade não vai como bairro, nem na cotação nem no pedido",
      !q.has("neighborhood") && !q.has("street") && !("customerNeighborhood" in corpo), { q: Object.fromEntries(q), corpo });
  }
  const velha = entregaNoPedidoDoBalcao("Rua X, 10 - Centro", { token: "tk", endereco: "Rua X, 1 - Centro" }, true);
  confere("balcão: endereço mudou, a cotação não vai (mas a taxa digitada sim)", !("cotacao" in velha) && velha.taxaDigitadaNoBalcao === true, velha);
}

console.log(`\n${ok} ok, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
