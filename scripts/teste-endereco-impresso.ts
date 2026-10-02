/**
 * O endereço de entrega no papel: uma linha por informação (lib/endereco-impresso.ts).
 *
 *   npx tsx scripts/teste-endereco-impresso.ts
 *
 * Os endereços são montados pelo MESMO código que cada integração usa para
 * gravar o `customerAddress` (copiado abaixo, canal a canal, de
 * lib/ifood-eventos.ts, processBrendiEvent.ts, processJotajaEvent.ts,
 * wabiz-traducao.ts; o do 99Food é importado de lib/food99-pedido.ts), a
 * partir de payloads de exemplo no formato de cada parceiro — nada de banco.
 * Os textos já medidos em produção que estão em scripts/teste-areas-de-entrega.ts
 * entram também.
 *
 * Confere três coisas:
 *   1. a separação de cada canal (Rua / Número / Complemento / Bairro / Referência / Cidade / CEP);
 *   2. que o que não dá para separar com segurança cai no texto original;
 *   3. o papel de verdade, pelo código do Assistente (lib/gerado/comanda-do-assistente.ts):
 *      hoje × Assistente antigo com o site novo × Assistente 1.2.31.
 */
import { camposDoEnderecoParaImpressao, enderecoImpresso, type PedidoParaEndereco } from "../src/lib/endereco-impresso";
import { enderecoDoCliente as enderecoDo99 } from "../src/lib/food99-pedido";
import { comandaDoAssistente } from "../src/lib/gerado/comanda-do-assistente";
import { lerPapel } from "../src/lib/papel-da-impressora";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n     obtido   ${JSON.stringify(obtido)}\n     esperava ${JSON.stringify(esperado)}`}`);
};

// ── COMO CADA CANAL GRAVA O TEXTO (cópia fiel do tradutor) ──────────────────

/** lib/ifood-eventos.ts (pedido novo do iFood). */
function textoDoIfood(orderData: any): string {
  const addr = orderData.delivery?.deliveryAddress;
  if (!addr) return "";
  const formatted = addr.formattedAddress || "";
  const neighborhood = addr.neighborhood || "";
  const city = addr.city || "";
  const complement = addr.complement || addr.streetNameComplement || "";
  const reference = addr.reference || addr.streetNameReference || orderData.delivery?.observations || orderData.customer?.customerNote || "";
  const parts: string[] = [];
  if (formatted) parts.push(formatted);
  else if (addr.streetName) parts.push(`${addr.streetName}${addr.streetNumber ? `, ${addr.streetNumber}` : ""}`);
  if (complement && !parts.some((p) => p.toLowerCase().includes(complement.toLowerCase()))) parts.push(`Comp: ${complement}`);
  if (reference && !parts.some((p) => p.toLowerCase().includes(reference.toLowerCase()))) parts.push(`Ref: ${reference}`);
  if (neighborhood && (!parts[0] || !parts[0].toLowerCase().includes(neighborhood.toLowerCase()))) parts.push(neighborhood);
  if (city) parts.push(city);
  return parts.join(" - ");
}

/** lib/processBrendiEvent.ts. */
function textoDaBrendi(addr: any): string {
  const formatted = addr.formattedAddress || "";
  const via = addr.street || addr.streetName || "";
  const numero = addr.number || addr.streetNumber || "";
  const complemento = addr.complement || "";
  const bairro = addr.district || addr.neighborhood || "";
  const city = addr.city || "";
  const rua = via ? `${via}${numero ? `, ${numero}` : ""}${complemento ? ` - ${complemento}` : ""}` : formatted;
  const parts: string[] = [];
  if (rua) parts.push(rua);
  if (bairro && (!rua || !rua.toLowerCase().includes(bairro.toLowerCase()))) parts.push(bairro);
  if (city) parts.push(city);
  return parts.join(" - ");
}

/** lib/processJotajaEvent.ts. */
function textoDoJotaja(addr: any): string {
  const formatted = addr.formattedAddress || "";
  const street = addr.streetName ? `${addr.streetName}${addr.streetNumber ? ` ${addr.streetNumber}` : ""}${addr.complement ? ` ${addr.complement}` : ""}` : formatted;
  const neighborhood = addr.neighborhood || "";
  const city = addr.city || "";
  const parts: string[] = [];
  if (street) parts.push(street);
  if (neighborhood && (!street || !street.toLowerCase().includes(neighborhood.toLowerCase()))) parts.push(neighborhood);
  if (city) parts.push(city);
  return parts.join(" - ");
}

/** lib/wabiz-traducao.ts. */
function textoDaWabiz(entrega: any): string {
  const texto = (v: unknown) => (v == null ? "" : String(v).trim());
  const rua = [texto(entrega.address), texto(entrega.number)].filter(Boolean).join(", ");
  return [
    rua + (texto(entrega.compl) ? ` - ${texto(entrega.compl)}` : ""),
    texto(entrega.region),
    [texto(entrega.city), texto(entrega.state)].filter(Boolean).join("/"),
    texto(entrega.postalCode) ? `CEP ${texto(entrega.postalCode)}` : "",
  ].filter(Boolean).join(" - ");
}

/** components/customer/CustomerStorePage.tsx (checkout do site). */
function textoDoSite(rua: string, numero: string, bairro: string, complemento = ""): string {
  return `${rua.trim()}, ${numero.trim()} - ${bairro.trim()}${complemento.trim() ? ` (${complemento.trim()})` : ""}`;
}

/** lib/entrega-do-robo.ts (enderecoDaLocalizacaoDoCliente). */
function textoDaLocalizacao(lat: number, lng: number, endereco?: string): string {
  return `📍 Localização enviada pelo WhatsApp${endereco ? `: ${endereco}` : ""} (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
}

// ── OS CASOS ────────────────────────────────────────────────────────────────

type Caso = {
  canal: string;
  oQue: string;
  pedido: PedidoParaEndereco;
  cidadeDaLoja?: string;
  /** null = tem de cair no texto original. */
  esperado: string[] | null;
};

const entrega = (source: string, customerAddress: string, extra: Record<string, unknown> = {}): PedidoParaEndereco =>
  ({ deliveryType: "DELIVERY", source, customerAddress, ...extra });

const casos: Caso[] = [
  // iFood
  {
    canal: "iFood", oQue: "campos completos (rua, número, complemento, referência, bairro, cidade)",
    pedido: entrega("IFOOD", textoDoIfood({ delivery: { deliveryAddress: {
      formattedAddress: "R. Itaperu, 107", streetName: "R. Itaperu", streetNumber: "107",
      complement: "casa 1", reference: "perto do colégio", neighborhood: "Centro", city: "Rio das Ostras",
    } } })),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: R. Itaperu", "Número: 107", "Complemento: casa 1", "Bairro: Centro", "Referência: perto do colégio", "Cidade: Rio das Ostras"],
  },
  {
    canal: "iFood", oQue: "entrega na cidade vizinha (a cidade do cliente não é a da loja)",
    pedido: entrega("IFOOD", textoDoIfood({ delivery: { deliveryAddress: {
      streetName: "Rua A", streetNumber: "10", complement: "Casa", neighborhood: "Tamoios", city: "Cabo Frio",
    } } })),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua A", "Número: 10", "Complemento: Casa", "Bairro: Tamoios", "Cidade: Cabo Frio"],
  },
  {
    canal: "iFood", oQue: "bairro apagado pelo iFood (já estava no nome da rua) — sem linha de bairro, nada inventado",
    pedido: entrega("IFOOD", "Sh Mansões Sobradinho Q 52 conjunto B, 20 - Comp: Condominio verde vale - Brasília"),
    cidadeDaLoja: "Brasília",
    esperado: ["Rua: Sh Mansões Sobradinho Q 52 conjunto B", "Número: 20", "Complemento: Condominio verde vale", "Cidade: Brasília"],
  },
  {
    canal: "iFood", oQue: "medido em produção (teste-areas-de-entrega): Q 11 Cl, Sobradinho",
    pedido: entrega("IFOOD", "Q 11 Cl, 10 - Comp: Apartamento 102 - Ref: Em Cima Da Academia Multy Forças - Sobradinho - Brasília"),
    cidadeDaLoja: "Brasília",
    esperado: ["Rua: Q 11 Cl", "Número: 10", "Complemento: Apartamento 102", "Bairro: Sobradinho", "Referência: Em Cima Da Academia Multy Forças", "Cidade: Brasília"],
  },
  {
    canal: "iFood", oQue: "nome da rua com vírgula (medido em produção): o que vem antes do número é rua, não bairro",
    pedido: entrega("IFOOD", "R. Ágatha,Lto Recanto Dos Paratis, 54B - Casimiro de Abreu"),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: R. Ágatha, Lto Recanto Dos Paratis", "Número: 54B", "Cidade: Casimiro de Abreu"],
  },
  {
    canal: "iFood", oQue: "referência com \" - \" dentro continua referência",
    pedido: entrega("IFOOD", textoDoIfood({ delivery: { deliveryAddress: {
      streetName: "Rua das Palmeiras", streetNumber: "80", complement: "casa 2", reference: "casa azul - portão preto",
      neighborhood: "Centro", city: "Rio das Ostras",
    } } })),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua das Palmeiras", "Número: 80", "Complemento: casa 2", "Bairro: Centro", "Referência: casa azul - portão preto", "Cidade: Rio das Ostras"],
  },
  // Brendi
  {
    canal: "Brendi", oQue: "street/number/complement/district/city",
    pedido: entrega("BRENDI", textoDaBrendi({ street: "Rua Caravelas", number: "59", complement: "Sobrado", district: "Trindade", city: "São Gonçalo" })),
    cidadeDaLoja: "São Gonçalo",
    esperado: ["Rua: Rua Caravelas", "Número: 59", "Complemento: Sobrado", "Bairro: Trindade", "Cidade: São Gonçalo"],
  },
  // JotaJá
  {
    canal: "JotaJá", oQue: "streetName + número + complemento colados (sem vírgula): a rua fica inteira",
    pedido: entrega("JOTAJA", textoDoJotaja({ streetName: "Rua da Fonte", streetNumber: "512", complement: "Portão marrom", neighborhood: "Nova Cidade", city: "Rio das Ostras" })),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua da Fonte 512 Portão marrom", "Bairro: Nova Cidade", "Cidade: Rio das Ostras"],
  },
  {
    canal: "JotaJá", oQue: "formattedAddress que repete a cidade e diz \"Brasil\"",
    pedido: entrega("JOTAJA", textoDoJotaja({ formattedAddress: "Rua da Fonte, 512, Portão marrom, Nova Cidade - Rio das Ostras - Brasil", city: "Rio das Ostras" })),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua da Fonte", "Número: 512", "Complemento: Portão marrom", "Bairro: Nova Cidade", "Cidade: Rio das Ostras"],
  },
  // Wabiz
  {
    canal: "Wabiz", oQue: "quadra, Sn, complemento, região, Cidade/UF e CEP",
    pedido: entrega("WABIZ", textoDaWabiz({ address: "Quadra 16 conjunto G", number: "Sn", compl: "Casa 10", region: "QUADRA 16", city: "Brasília", state: "DF", postalCode: "73050167" })),
    cidadeDaLoja: "Brasília",
    esperado: ["Rua: Quadra 16 conjunto G", "Número: Sn", "Complemento: Casa 10", "Bairro: QUADRA 16", "Cidade: Brasília/DF", "CEP: 73050-167"],
  },
  {
    canal: "Wabiz", oQue: "rodovia \"DF - 425\" é bairro, não UF",
    pedido: entrega("WABIZ", "Condominio Vivendas Serrana, 1 - Módulo X casa 01 - DF - 425 - Brasília/DF - CEP 73092900"),
    cidadeDaLoja: "Brasília",
    esperado: ["Rua: Condominio Vivendas Serrana", "Número: 1", "Complemento: Módulo X casa 01", "Bairro: DF-425", "Cidade: Brasília/DF", "CEP: 73092-900"],
  },
  // 99Food
  {
    canal: "99Food", oQue: "formato do Google + complemento depois da UF",
    pedido: entrega("99FOOD", enderecoDo99({ poi_address: "Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ", house_number: "727", poi_display_name: "portão branco", city: "Rio das Ostras" })),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua Mayer", "Número: 727", "Complemento: portão branco", "Bairro: Liberdade", "Cidade: Rio das Ostras - RJ"],
  },
  {
    canal: "99Food", oQue: "bairro da cidade vizinha (Casimiro de Abreu) e complemento mascarado",
    pedido: entrega("99FOOD", enderecoDo99({ poi_address: "Rua Recife, 335 - Barra de São João, Casimiro de Abreu - RJ", house_number: "privacy protection", poi_display_name: "privacy protection", city: "Casimiro de Abreu" })),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua Recife", "Número: 335", "Bairro: Barra de São João", "Cidade: Casimiro de Abreu - RJ"],
  },
  // Site
  {
    canal: "Site", oQue: "rua, número, bairro e o complemento entre parênteses",
    pedido: entrega("SITE", textoDoSite("Rua Nova Iguaçu", "668", "Atlântica", "BL A AP 203 - Cond. Caravelas")),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua Nova Iguaçu", "Número: 668", "Complemento: BL A AP 203 - Cond. Caravelas", "Bairro: Atlântica"],
  },
  {
    canal: "Site", oQue: "sem complemento, S/N",
    pedido: entrega("SITE", textoDoSite("Estrada do Contorno", "S/N", "Âncora")),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Estrada do Contorno", "Número: S/N", "Bairro: Âncora"],
  },
  // Robô do WhatsApp
  {
    canal: "Robô", oQue: "\"rua, nº, Bairro, Cidade\" tudo com vírgula",
    pedido: entrega("WHATSAPP_IA", "Rua Paranaíba, 470, Operário, Rio das Ostras"),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua Paranaíba", "Número: 470", "Bairro: Operário", "Cidade: Rio das Ostras"],
  },
  {
    canal: "Robô", oQue: "\"rua, nº, complemento, Bairro\" sem cidade",
    pedido: entrega("WHATSAPP_IA", "Rua Machado da Silva, 160, casa 2, Recanto"),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua Machado da Silva", "Número: 160", "Complemento: casa 2", "Bairro: Recanto"],
  },
  {
    canal: "Robô", oQue: "só a localização (📎) com o lugar que o WhatsApp deu",
    pedido: entrega("WHATSAPP_IA", textoDaLocalizacao(-22.517, -41.945, "Rua Paranaíba, 470 - Operário, Rio das Ostras - RJ")),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Localização: pelo WhatsApp (-22.517000, -41.945000)", "Rua: Rua Paranaíba", "Número: 470", "Bairro: Operário", "Cidade: Rio das Ostras - RJ"],
  },
  {
    canal: "Robô", oQue: "só a localização, sem nome de lugar",
    pedido: entrega("WHATSAPP_IA", textoDaLocalizacao(-22.517, -41.945)),
    cidadeDaLoja: "Rio das Ostras",
    esperado: null,
  },
  // Balcão
  {
    canal: "Balcão", oQue: "\"Rua, nº - Bairro\" (select de bairros)",
    pedido: entrega("PRESENCIAL", "Rua X, 35 - Centro"),
    cidadeDaLoja: "Rio das Ostras",
    esperado: ["Rua: Rua X", "Número: 35", "Bairro: Centro"],
  },
  {
    canal: "Balcão", oQue: "texto solto (\"quadra 05\") cai no original",
    pedido: entrega("PRESENCIAL", "quadra 05"),
    cidadeDaLoja: "Brasília",
    esperado: null,
  },
  {
    canal: "Balcão", oQue: "frase digitada sem vírgula cai no original",
    pedido: entrega("PRESENCIAL", "casa amarela em frente à padaria do Zé"),
    cidadeDaLoja: "Rio das Ostras",
    esperado: null,
  },
];

console.log("\n— separação, canal a canal —");
const linhasDe = (c: Caso) => {
  const e = enderecoImpresso(c.pedido, { cidadeDaLoja: c.cidadeDaLoja });
  return e.separado ? e.linhas.map((l) => `${l.rotulo}: ${l.valor}`) : null;
};
for (const c of casos) confere(`${c.canal}: ${c.oQue}`, linhasDe(c), c.esperado);

// ── O QUE NÃO PODE MUDAR ────────────────────────────────────────────────────
console.log("\n— o que fica como está —");
confere("mesa: o \"Mesa 4\" segue intacto (o Assistente lê o número dele)",
  camposDoEnderecoParaImpressao({ deliveryType: "MESA", customerAddress: "Mesa 4", source: "PRESENCIAL" }, "Rio das Ostras"), {});
confere("retirada: nada muda",
  camposDoEnderecoParaImpressao({ deliveryType: "RETIRADA", customerAddress: "Rua X, 35 - Centro", source: "SITE" }, "Rio das Ostras"), {});
confere("sem a cidade da loja, o robô com cidade no fim cai no original (Rio das Ostras não vira bairro)",
  linhasDe({ canal: "", oQue: "", pedido: entrega("WHATSAPP_IA", "Rua Paranaíba, 470, Operário, Rio das Ostras"), esperado: null }),
  null);
confere("robô com a cidade vizinha (não é a da loja) cai no original — Cabo Frio não vira bairro",
  linhasDe({ canal: "", oQue: "", pedido: entrega("WHATSAPP_IA", "Rua das Flores, 12, Centro, Cabo Frio"), cidadeDaLoja: "Rio das Ostras", esperado: null }),
  null);
confere("localização com nome de lugar que não é endereço: sai inteiro, rotulado",
  linhasDe({ canal: "", oQue: "", pedido: entrega("WHATSAPP_IA", textoDaLocalizacao(-22.5, -41.9, "Suporte Técnico Celular")), cidadeDaLoja: "Rio das Ostras", esperado: null }),
  ["Localização: pelo WhatsApp (-22.500000, -41.900000)", "Endereço: Suporte Técnico Celular"]);
{
  const ja = camposDoEnderecoParaImpressao(casos[0].pedido, "Rio das Ostras");
  confere("reimpressão: pedido já separado não é lido de novo",
    camposDoEnderecoParaImpressao({ ...casos[0].pedido, ...ja } as any, "Rio das Ostras"), {});
  confere("customerAddress para o Assistente antigo: rotulado numa linha só",
    ja.customerAddress, "R. Itaperu, 107 | Comp: casa 1 | Bairro: Centro | Ref: perto do colégio | Cidade: Rio das Ostras");
}

// Nada sumiu: toda palavra do original está nas linhas (a própria lib confere;
// aqui a conferência é refeita por fora, para não depender só dela).
console.log("\n— nada sumiu —");
const palavras = (t: string) => new Set(
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(comp|ref|cep|brasil)\b/g, " ").replace(/(\d)-(\d)/g, "$1$2")
    .split(/[^a-z0-9]+/).filter(Boolean),
);
for (const c of casos) {
  const e = enderecoImpresso(c.pedido, { cidadeDaLoja: c.cidadeDaLoja });
  const depois = palavras(e.separado ? e.linhas.map((l) => l.valor).join(" ") : e.original);
  const sumiram = [...palavras(String(c.pedido.customerAddress).replace(/^📍 Localização enviada pelo WhatsApp:?/, ""))].filter((p) => !depois.has(p));
  if (sumiram.length) confere(`${c.canal}: ${c.oQue} — palavras perdidas`, sumiram, []);
}
console.log("✅ conferido em todos os casos");

// ── ANTES × DEPOIS ──────────────────────────────────────────────────────────
console.log("\n— antes × depois (texto) —");
for (const c of casos) {
  const e = enderecoImpresso(c.pedido, { cidadeDaLoja: c.cidadeDaLoja });
  console.log(`\n[${c.canal}] ${c.oQue}`);
  console.log(`  antes : Endereco: ${e.original}`);
  if (!e.separado) { console.log("  depois: (igual — não separa com segurança)"); continue; }
  for (const l of e.linhas) console.log(`  depois: ${l.rotulo}: ${l.valor}`);
}

// ── O PAPEL DE VERDADE (código do Assistente) ───────────────────────────────
console.log("\n— o papel (seção ENTREGA, 48 colunas) —");
const papel = (order: Record<string, unknown>, colunas = 48) => {
  const linhas = lerPapel(comandaDoAssistente({
    id: "teste", dailyOrderNumber: 7, customerName: "Cliente Teste", deliveryType: "DELIVERY",
    paymentMethod: "Dinheiro", items: [{ name: "Pizza G", qty: 1, price: 50 }], totalAmount: 57, deliveryFee: 7,
    ...order,
  }, "Loja Teste", colunas, "safe")).map((l) => l.trechos.map((t) => t.texto).join(""));
  const ini = linhas.findIndex((l) => l.trim() === "ENTREGA");
  const fim = linhas.findIndex((l, i) => i > ini && /RESUMO DO PEDIDO/.test(l));
  return linhas.slice(ini, fim).filter((l) => l.trim());
};
const mostrar = (titulo: string, ls: string[]) => {
  console.log(`  ${titulo}`);
  for (const l of ls) console.log(`    |${l}`);
};
/** Um caso por canal para o papel: o primeiro de cada um. */
const umPorCanal = casos.filter((c, i) => c.esperado && casos.findIndex((o) => o.canal === c.canal && o.esperado) === i);
const do99 = casos.find((c) => c.canal === "99Food")!;
for (const c of umPorCanal) {
  const novos = camposDoEnderecoParaImpressao(c.pedido, c.cidadeDaLoja);
  console.log(`\n[${c.canal}] ${c.oQue}`);
  mostrar("hoje:", papel({ ...c.pedido }));
  mostrar("site novo + Assistente antigo (até 1.2.30, ignora `enderecoImpresso`):", papel({ ...c.pedido, customerAddress: novos.customerAddress }));
  mostrar("site novo + Assistente 1.2.31:", papel({ ...c.pedido, ...novos }));
}
{
  const c = do99;
  const novos = camposDoEnderecoParaImpressao(c.pedido, c.cidadeDaLoja);
  const ls = papel({ ...c.pedido, ...novos }, 32);
  confere("58 mm (32 colunas): cada linha cabe na bobina", ls.every((l) => l.length <= 32), true);
  confere("Assistente 1.2.31 imprime uma linha por informação", ls.slice(1, 6), [
    "Rua: Rua Mayer", "Numero: 727", "Complemento: portao branco", "Bairro: Liberdade", "Cidade: Rio das Ostras - RJ",
  ]);
  confere("sem `enderecoImpresso` o Assistente 1.2.31 imprime como sempre",
    papel({ ...c.pedido }).slice(1).join(" ").replace(/\s+/g, " "), "Endereco: Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ, portao branco");
}

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
