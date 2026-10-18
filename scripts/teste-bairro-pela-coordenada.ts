/**
 * O bairro pelo ponto do cliente quando o endereço não tem bairro
 * (src/lib/bairro-pela-coordenada.ts e -servidor.ts).
 *
 * Caso real: Divinos Burguer (Cabo Frio), pedido 25 de 18/10/2026 — "Em frente
 * à Dolcice" com a localização do WhatsApp em (-22.854977, -42.032589). O
 * reverse do Nominatim desse ponto (lido em 18/10/2026) e o ViaCEP da rua
 * (Rua Rosalina Cardoso da Fonseca → Porto do Carro) estão gravados abaixo:
 * o teste não vai à rede.
 *
 * Rodar: DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-bairro-pela-coordenada.ts
 */
import {
  bairroDoPonto,
  bairroQueAComandaLe,
  decidirBairroDoPedido,
  enderecoComOBairro,
  pontoDoClienteParaBairro,
  type BuscasDoBairro,
} from "../src/lib/bairro-pela-coordenada";
import { camposDoEnderecoParaImpressao } from "../src/lib/endereco-impresso";

let falhas = 0;
function conferir(nome: string, ok: boolean, detalhe?: unknown) {
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${!ok && detalhe !== undefined ? ` — ${JSON.stringify(detalhe)}` : ""}`);
}

const PONTO_25 = { lat: -22.854977, lng: -42.032589, medida: "linha-reta", origem: "gps" };
const REVERSO_25 = {
  road: "Rua Rosalina Cardoso da Fonseca",
  residential: "Vila Porto do Carro",
  suburb: "Gamboa",
  city: "Cabo Frio",
  municipality: "Cabo Frio",
  state: "Rio de Janeiro",
  "ISO3166-2-lvl4": "BR-RJ",
  postcode: "28922-000",
  country: "Brasil",
};
const DIVINOS = { city: "CABO FRIO", deliveryZoneType: "KM", deliveryZones: [{ km: 1, fee: 5 }, { km: 5.5, fee: 20 }] };

let chamadasDoMapa = 0;
const buscas = (o: { reverso?: unknown; correios?: string | null; falhaMapa?: boolean; falhaCorreios?: boolean } = {}): BuscasDoBairro => ({
  async reverso() {
    chamadasDoMapa++;
    if (o.falhaMapa) throw new Error("HTTP 429");
    return o.reverso === undefined ? REVERSO_25 : o.reverso;
  },
  async correios(rua, cidade, uf) {
    if (o.falhaCorreios) throw new Error("ViaCEP fora");
    if (o.correios !== undefined) return o.correios;
    return rua === "Rua Rosalina Cardoso da Fonseca" && cidade === "Cabo Frio" && uf === "RJ" ? "Porto do Carro" : null;
  },
});

const pedido25 = { customerAddress: "Em frente à Dolcice", customerLatLng: PONTO_25, deliveryType: "DELIVERY", source: "WHATSAPP_IA" };

async function main() {
  // ── O caso da Divinos ──────────────────────────────────────────────────────
  conferir("pedido 25 hoje: a comanda não lê bairro", bairroQueAComandaLe(pedido25, "CABO FRIO") === null);
  const d25 = await decidirBairroDoPedido(pedido25, DIVINOS, buscas());
  conferir("pedido 25: bairro dos Correios (Porto do Carro), não o 'Gamboa'/'Vila…' do OSM",
    d25.mudar && d25.bairro === "Porto do Carro" && d25.fonte === "correios", d25);
  conferir("pedido 25: endereço vira 'Em frente à Dolcice - Porto do Carro'",
    d25.mudar && d25.endereco === "Em frente à Dolcice - Porto do Carro", d25);
  if (d25.mudar) {
    const papel = camposDoEnderecoParaImpressao({ ...pedido25, customerAddress: d25.endereco }, "CABO FRIO");
    conferir("pedido 25: a linha BAIRRO da comanda sai", papel.bairroDoPedido === "Porto do Carro", papel);
  }

  // ── Endereço com bairro: não mexe, nem vai à rede ─────────────────────────
  chamadasDoMapa = 0;
  for (const a of ["Rua Dimas Texeira, n50 - Porto do Carro", "Rua diamante, monte alegre", "Rua Beira Alta, 83 - Monte Alegre"]) {
    const d = await decidirBairroDoPedido({ ...pedido25, customerAddress: a }, DIVINOS, buscas());
    conferir(`com bairro não mexe: "${a}"`, !d.mudar && d.motivo === "ja-tem-bairro", d);
  }
  conferir("com bairro: nenhuma busca no mapa", chamadasDoMapa === 0, chamadasDoMapa);

  // ── Falhas: segue sem bairro, sem lançar ──────────────────────────────────
  const semMapa = await decidirBairroDoPedido(pedido25, DIVINOS, buscas({ falhaMapa: true }));
  conferir("mapa fora (429): segue sem bairro", !semMapa.mudar && semMapa.motivo === "sem-bairro-no-ponto", semMapa);
  const mapaNulo = await decidirBairroDoPedido(pedido25, DIVINOS, buscas({ reverso: null }));
  conferir("mapa sem resposta (null): segue sem bairro", !mapaNulo.mudar && mapaNulo.motivo === "sem-bairro-no-ponto", mapaNulo);
  const mar = await decidirBairroDoPedido(pedido25, DIVINOS, buscas({ reverso: { city: "Cabo Frio", state: "Rio de Janeiro" } }));
  conferir("ponto sem rua nem bairro no mapa: segue sem bairro", !mar.mudar, mar);
  const semCorreios = await decidirBairroDoPedido(pedido25, DIVINOS, buscas({ falhaCorreios: true }));
  conferir("Correios fora: fica o bairro do mapa (ordem do checkout: suburb)",
    semCorreios.mudar && semCorreios.bairro === "Gamboa" && semCorreios.fonte === "mapa", semCorreios);

  // ── Só o ponto do cliente ─────────────────────────────────────────────────
  conferir("ponto 'gps' vale", !!pontoDoClienteParaBairro(PONTO_25));
  conferir("ponto 'pino' e 'manual' valem", !!pontoDoClienteParaBairro({ ...PONTO_25, origem: "pino" }) && !!pontoDoClienteParaBairro({ ...PONTO_25, origem: "manual" }));
  conferir("ponto do mapa (achado pelo texto) não vale", pontoDoClienteParaBairro({ ...PONTO_25, origem: "mapa" }) === null);
  conferir("centro de bairro não vale", pontoDoClienteParaBairro({ ...PONTO_25, origem: "bairro" }) === null);
  conferir("0,0 não vale", pontoDoClienteParaBairro({ lat: 0, lng: 0, origem: "gps" }) === null);
  const doMapa = await decidirBairroDoPedido({ ...pedido25, customerLatLng: { ...PONTO_25, origem: "mapa" } }, DIVINOS, buscas());
  conferir("pedido com ponto do mapa: não mexe", !doMapa.mudar && doMapa.motivo === "sem-ponto-do-cliente", doMapa);
  const retirada = await decidirBairroDoPedido({ ...pedido25, deliveryType: "PICKUP" }, DIVINOS, buscas());
  conferir("retirada: não mexe", !retirada.mudar && retirada.motivo === "nao-e-entrega", retirada);

  // ── Loja por bairro: o nome cadastrado ────────────────────────────────────
  const porBairro = { city: "CABO FRIO", deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [{ name: "Gamboa e Porto do Carro", fee: 6 }, { name: "Monte Alegre", fee: 5 }] };
  const z = await bairroDoPonto({ lat: PONTO_25.lat, lng: PONTO_25.lng }, porBairro, buscas());
  conferir("loja por bairro: vale o nome da zona", z?.bairro === "Gamboa e Porto do Carro" && z?.fonte === "zona-da-loja", z);
  const porBairro2 = { city: "CABO FRIO", deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [{ name: "Gamboa", fee: 6 }] };
  const z2 = await bairroDoPonto({ lat: PONTO_25.lat, lng: PONTO_25.lng }, porBairro2, buscas({ correios: null }));
  conferir("loja por bairro sem Correios: zona pelo nome do OSM", z2?.bairro === "Gamboa" && z2?.fonte === "zona-da-loja", z2);

  // ── O texto do endereço com o bairro ──────────────────────────────────────
  const loc = "📍 Localização enviada pelo WhatsApp (-22.854977, -42.032589)";
  const comLoc = enderecoComOBairro({ customerAddress: loc, source: "WHATSAPP_IA" }, "Porto do Carro", "CABO FRIO");
  conferir("só a localização: 'WhatsApp: Bairro: Porto do Carro (…)'",
    comLoc === "📍 Localização enviada pelo WhatsApp: Bairro: Porto do Carro (-22.854977, -42.032589)", comLoc);
  conferir("só a localização: a comanda lê o bairro",
    bairroQueAComandaLe({ customerAddress: comLoc, source: "WHATSAPP_IA" }, "CABO FRIO") === "Porto do Carro");
  const papelLoc = camposDoEnderecoParaImpressao({ customerAddress: comLoc, deliveryType: "DELIVERY", source: "WHATSAPP_IA" }, "CABO FRIO");
  conferir("só a localização: o papel leva a localização e o bairro",
    papelLoc.customerAddress === "Localização pelo WhatsApp (-22.854977, -42.032589) | Bairro: Porto do Carro", papelLoc);
  const locComLugar = enderecoComOBairro({ customerAddress: "📍 Localização enviada pelo WhatsApp: Dolcice (-22.854977, -42.032589)", source: "WHATSAPP_IA" }, "Porto do Carro", "CABO FRIO");
  conferir("localização com o nome do lugar: 'Dolcice - Porto do Carro (…)'",
    locComLugar === "📍 Localização enviada pelo WhatsApp: Dolcice - Porto do Carro (-22.854977, -42.032589)", locComLugar);
  const fimSemSeparador = enderecoComOBairro({ customerAddress: "Rua andorinha N°9 Monte Alegre", source: "WHATSAPP_IA" }, "Monte Alegre", "CABO FRIO");
  conferir("nome do bairro já no fim, sem separador: não escreve duas vezes",
    fimSemSeparador === "Rua andorinha N°9 - Monte Alegre", fimSemSeparador);
  const comVila = enderecoComOBairro({ customerAddress: "Rua do Ouro 18 Monte Alegre", source: "SITE" }, "Vila Monte Alegre", "CABO FRIO");
  conferir("'Vila Monte Alegre' casa com 'Monte Alegre' no fim", comVila === "Rua do Ouro 18 - Monte Alegre", comVila);
  const ruaHomonima = enderecoComOBairro({ customerAddress: "Rua Monte Alegre", source: "SITE" }, "Monte Alegre", "CABO FRIO");
  conferir("rua com o nome do bairro: acrescenta, não come a rua", ruaHomonima === "Rua Monte Alegre - Monte Alegre", ruaHomonima);
  conferir("endereço vazio: não inventa", enderecoComOBairro({ customerAddress: "", source: "SITE" }, "Centro", "CABO FRIO") === null);
  const site = await decidirBairroDoPedido(
    { customerAddress: "Rua Eva, 3", customerLatLng: { lat: -22.8549, lng: -42.0325, origem: "pino" }, deliveryType: "DELIVERY", source: "SITE" },
    DIVINOS,
    buscas(),
  );
  conferir("site com pino e sem bairro: 'Rua Eva, 3 - Porto do Carro'", site.mudar && site.endereco === "Rua Eva, 3 - Porto do Carro", site);

  // ── O servidor: grava no banco, com a espera curta ────────────────────────
  const { prisma } = await import("../src/lib/prisma");
  const { completarBairroPelaCoordenada } = await import("../src/lib/bairro-pela-coordenada-servidor");
  const banco: Record<string, any> = {
    p25: { ...pedido25, franchiseeId: "loja", franchisee: DIVINOS },
    lento: { ...pedido25, franchiseeId: "loja", franchisee: DIVINOS },
    trocou: { ...pedido25, franchiseeId: "loja", franchisee: DIVINOS },
  };
  const delegado: any = prisma.customerOrder;
  const original = { findUnique: delegado.findUnique, updateMany: delegado.updateMany };
  let remendou = true;
  try {
    delegado.findUnique = async ({ where }: any) => (banco[where.id] ? { ...banco[where.id] } : null);
    delegado.updateMany = async ({ where, data }: any) => {
      const p = banco[where.id];
      if (!p || p.customerAddress !== where.customerAddress) return { count: 0 };
      Object.assign(p, data);
      return { count: 1 };
    };
    if (prisma.customerOrder.findUnique !== delegado.findUnique) remendou = false;
  } catch {
    remendou = false;
  }
  if (!remendou) {
    console.log("(o cliente do Prisma não aceitou o remendo: parte do servidor não testada)");
  } else {
    const g = await completarBairroPelaCoordenada("p25", { buscas: buscas() });
    conferir("servidor: grava 'Em frente à Dolcice - Porto do Carro'", g === "Porto do Carro" && banco.p25.customerAddress === "Em frente à Dolcice - Porto do Carro", banco.p25);

    // Reverse lento: devolve na espera, grava depois (segundo plano).
    const lenta: BuscasDoBairro = { ...buscas(), reverso: () => new Promise((r) => setTimeout(() => r(REVERSO_25), 300)) };
    const t0 = Date.now();
    const gl = await completarBairroPelaCoordenada("lento", { buscas: lenta, esperaMs: 50 });
    const levou = Date.now() - t0;
    conferir("servidor: reverse lento não segura a gravação (volta na espera)", gl === null && levou < 250 && banco.lento.customerAddress === "Em frente à Dolcice", { gl, levou });
    await new Promise((r) => setTimeout(r, 400));
    conferir("servidor: reverse lento grava em segundo plano", banco.lento.customerAddress === "Em frente à Dolcice - Porto do Carro", banco.lento);

    // O endereço mudou enquanto o mapa respondia: não sobrescreve.
    const trocando: BuscasDoBairro = {
      ...buscas(),
      reverso: async () => {
        banco.trocou.customerAddress = "Rua Nova, 10 - Centro";
        return REVERSO_25;
      },
    };
    await completarBairroPelaCoordenada("trocou", { buscas: trocando });
    conferir("servidor: endereço trocado no meio não é sobrescrito", banco.trocou.customerAddress === "Rua Nova, 10 - Centro", banco.trocou);

    const falhou = await completarBairroPelaCoordenada("p-inexistente", { buscas: buscas({ falhaMapa: true }) });
    conferir("servidor: pedido que não existe não lança", falhou === null);
    delegado.findUnique = original.findUnique;
    delegado.updateMany = original.updateMany;
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
