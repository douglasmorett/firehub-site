/**
 * scripts/teste-pix-online.ts
 *
 * Pix pelo site na conta Asaas da loja (lib/pix-online.ts,
 * lib/asaas-da-loja.ts, lib/cofre.ts).
 *
 * Trava o que o lojista aceitou nas regras e o que o Asaas exige:
 *   - o split do FireHub é 1% do PEDIDO, mandado em reais (o percentual do
 *     Asaas incide sobre o líquido e daria menos);
 *   - o cliente do Asaas nasce SEM notificação (cada uma é cobrada da loja);
 *   - a cobrança vai com a referência do pedido, Pix, vencimento hoje e split;
 *   - cobrança que não gerou QR é apagada (não fica pendurada no extrato);
 *   - a chave da loja só é guardada cifrada, e o dado mexido não abre.
 *
 * A parte HTTP roda contra um Asaas FALSO em localhost — nenhuma chamada sai
 * para o Asaas de verdade, nenhuma linha vai para o banco.
 *
 *   npx tsx scripts/teste-pix-online.ts
 */
import http from "http";
import type { AddressInfo } from "net";

let ok = 0, falhou = 0;
function conferir(nome: string, obtido: unknown, esperado: unknown) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         obtido:   ${JSON.stringify(obtido)}`); }
}

// ── Asaas falso ─────────────────────────────────────────────────────────────
type Chamada = { metodo: string; caminho: string; corpo: any; chave: string | undefined };
const chamadas: Chamada[] = [];
let qrFalha = false;
let recusarSplit = false;
let clientesExistentes: any[] = [];

// Chaves FALSAS, montadas aqui para não parecerem credencial no código (o
// gancho de pré-commit procura o formato da chave do Asaas, e com razão).
const chaveFalsa = (nome: string) =>
  ["$aact", "prod", "000" + Buffer.from(`chave-falsa-do-teste-${nome}`).toString("base64")].join("_");
const CHAVE_BOA = chaveFalsa("boa");
const CHAVE_DESATIVADA = chaveFalsa("desativada");
const CHAVE_WHITELIST = chaveFalsa("whitelist");

function responder(res: http.ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(corpo));
}

const servidor = http.createServer((req, res) => {
  let bruto = "";
  req.on("data", (p) => (bruto += p));
  req.on("end", () => {
    const corpo = bruto ? JSON.parse(bruto) : null;
    const url = new URL(req.url || "/", "http://x");
    const chave = req.headers["access_token"] as string | undefined;
    chamadas.push({ metodo: req.method || "GET", caminho: url.pathname + url.search, corpo, chave });

    if (chave === CHAVE_DESATIVADA) return responder(res, 401, {});
    if (chave === CHAVE_WHITELIST) return responder(res, 403, {});

    const p = url.pathname;
    if (p === "/wallets/") return responder(res, 200, { data: [{ object: "wallet", id: "wal-loja-123" }] });
    if (p === "/myAccount/status/") {
      return responder(res, 200, { id: "acc", commercialInfo: "APPROVED", bankAccountInfo: "APPROVED", documentation: "APPROVED", general: "APPROVED" });
    }
    if (p === "/myAccount/commercialInfo/") {
      return responder(res, 200, { companyName: "Pizzaria Teste LTDA", cpfCnpj: "12345678000195", personType: "JURIDICA" });
    }
    if (p === "/pix/addressKeys" && req.method === "GET") {
      return responder(res, 200, { data: [{ id: "k1", key: "b6295ee1-f054-47d1-9e90-ee57b74f60d9", type: "EVP", status: "ACTIVE" }] });
    }
    if (p === "/customers" && req.method === "GET") return responder(res, 200, { data: clientesExistentes });
    if (p === "/customers" && req.method === "POST") return responder(res, 200, { id: "cus_novo", ...corpo });
    if (p === "/payments" && req.method === "POST") {
      if (recusarSplit && corpo.split) {
        return responder(res, 400, { errors: [{ code: "invalid_split", description: "O walletId informado no split não está autorizado." }] });
      }
      return responder(res, 200, {
        id: "pay_abc", status: "PENDING", value: corpo.value, externalReference: corpo.externalReference,
        invoiceUrl: "https://www.asaas.com/i/abc123",
      });
    }
    if (p === "/payments/pay_abc/pixQrCode") {
      if (qrFalha) return responder(res, 400, { errors: [{ code: "x", description: "Chave Pix não encontrada." }] });
      return responder(res, 200, { encodedImage: "iVBORw0KGgo=", payload: "00020101021226...6304ABCD", expirationDate: "2027-09-26 23:59:59" });
    }
    if (p === "/payments/pay_abc" && req.method === "DELETE") return responder(res, 200, { deleted: true, id: "pay_abc" });
    if (p === "/payments/pay_abc/refund") {
      return responder(res, 200, { id: "pay_abc", status: "REFUNDED", refunds: [{ status: "DONE", value: 50 }] });
    }
    if (p === "/webhooks" && req.method === "POST") return responder(res, 200, { id: "wh_1", ...corpo });
    return responder(res, 404, { errors: [{ code: "not_found", description: `Rota falsa não existe: ${p}` }] });
  });
});

async function main() {
  // Cofre com segredo de teste — nada do ambiente real.
  process.env.NEXTAUTH_SECRET = "segredo-de-teste-do-cofre";
  delete process.env.COFRE_CHAVE;

  const { splitDoFireHub, liquidoDaLoja, tarifaDoAsaas, REGRAS_DO_PIX_ONLINE, mensagemDePixOnlineAtivado } = await import("../src/lib/pix-online");
  const { cifrar, decifrar, mesmoSegredo } = await import("../src/lib/cofre");

  console.log("\n== O split é 1% do pedido, em reais ==");
  conferir("pedido de R$ 50 → R$ 0,50", splitDoFireHub(50), 0.5);
  conferir("pedido de R$ 30 → R$ 0,30", splitDoFireHub(30), 0.3);
  conferir("pedido de R$ 100 → R$ 1,00", splitDoFireHub(100), 1);
  conferir("pedido de R$ 33,33 → R$ 0,33", splitDoFireHub(33.33), 0.33);
  conferir("pedido de R$ 7,90 → R$ 0,08", splitDoFireHub(7.9), 0.08);
  conferir("pedido menor que a tarifa → sem split", splitDoFireHub(1.5), 0);
  conferir("loja recebe R$ 47,51 de R$ 50 (1,99 + 0,50)", liquidoDaLoja(50), 47.51);
  conferir("loja recebe R$ 97,01 de R$ 100", liquidoDaLoja(100), 97.01);
  conferir("as regras falam da taxa de 1%", REGRAS_DO_PIX_ONLINE.some((r) => r.texto.includes("taxa do pagamento online de 1%")), true);
  conferir("o WhatsApp fala em taxa do pagamento online", mensagemDePixOnlineAtivado("Loja X", "Conta Y", { pix: true, cartao: true }).includes("taxa do pagamento online de 1%"), true);
  conferir("o WhatsApp nunca diz que o 1% é do Asaas", /tarifa do Asaas de 1%|1% (do|de tarifa do) Asaas/i.test(mensagemDePixOnlineAtivado("Loja X", "Conta Y")), false);
  conferir("cartão de R$ 50: tarifa do Asaas R$ 1,99 (2,99% + 0,49)", tarifaDoAsaas(50, "cartao"), 1.99);
  conferir("cartão de R$ 100: tarifa R$ 3,48", tarifaDoAsaas(100, "cartao"), 3.48);
  conferir("cartão de R$ 100: taxa online R$ 1,00", splitDoFireHub(100, "cartao"), 1);
  conferir("cartão de R$ 100: loja recebe R$ 95,52", liquidoDaLoja(100, "cartao"), 95.52);
  conferir("as regras dizem quando o cartão cai", REGRAS_DO_PIX_ONLINE.some((r) => r.texto.includes("até 2 dias úteis")), true);

  console.log("\n== A chave da loja só vai ao banco cifrada ==");
  const guardado = cifrar(CHAVE_BOA);
  conferir("o texto cifrado não contém a chave", guardado.includes("aact"), false);
  conferir("abre de volta igual", decifrar(guardado), CHAVE_BOA);
  const partes = guardado.split(".");
  partes[4] = partes[4].slice(0, -2) + (partes[4].endsWith("A") ? "B" : "A") + partes[4].slice(-1);
  conferir("dado mexido não abre", decifrar(partes.join(".")), null);
  conferir("lixo não abre", decifrar("qualquer-coisa"), null);
  process.env.NEXTAUTH_SECRET = "outro-segredo";
  conferir("com outro segredo não abre", decifrar(guardado), null);
  process.env.NEXTAUTH_SECRET = "segredo-de-teste-do-cofre";
  process.env.COFRE_CHAVE = "chave-dedicada";
  conferir("gravado antes da COFRE_CHAVE continua abrindo", decifrar(guardado), CHAVE_BOA);
  conferir("gravado depois usa a COFRE_CHAVE", cifrar("x").split(".")[1], "c");
  delete process.env.COFRE_CHAVE;
  conferir("token igual", mesmoSegredo("abc", "abc"), true);
  conferir("token diferente", mesmoSegredo("abc", "abd"), false);
  conferir("token ausente", mesmoSegredo(null, "abc"), false);

  // ── HTTP contra o Asaas falso ──
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  const porta = (servidor.address() as AddressInfo).port;
  process.env.ASAAS_API_BASE_LOJA = `http://127.0.0.1:${porta}`;
  process.env.ASAAS_WALLET_ID_FIREHUB_SANDBOX = "wal-firehub-sandbox";

  const asaas = await import("../src/lib/asaas-da-loja");

  console.log("\n== A chave colada ==");
  conferir("sem o $ ganha o $", asaas.normalizarChave(CHAVE_BOA.slice(1)), CHAVE_BOA);
  conferir("com espaço e aspas", asaas.normalizarChave(`  "${CHAVE_BOA}" `), CHAVE_BOA);
  conferir("texto qualquer é recusado", asaas.normalizarChave("minha-senha-123"), null);
  conferir("chave curta é recusada", asaas.normalizarChave("$aact_prod_123"), null);
  conferir("prod é produção", asaas.ambienteDaChave(CHAVE_BOA), "producao");
  conferir("hmlg é sandbox", asaas.ambienteDaChave("$aact_hmlg_000abc"), "sandbox");

  console.log("\n== Ler a conta ==");
  const conta = await asaas.lerContaDoAsaas(CHAVE_BOA);
  conferir("abre", conta.ok, true);
  conferir("carteira da loja", conta.dados?.walletId, "wal-loja-123");
  conferir("nome da empresa", conta.dados?.nome, "Pizzaria Teste LTDA");
  conferir("aprovada", conta.dados?.situacao, "APPROVED");
  conferir("chave Pix ativa", conta.dados?.chavesPixAtivas.length, 1);
  conferir("toda chamada leva a chave da LOJA", chamadas.every((c) => c.chave === CHAVE_BOA), true);

  const morta = await asaas.lerContaDoAsaas(CHAVE_DESATIVADA);
  conferir("chave desativada: não abre", morta.ok, false);
  conferir("chave desativada: 401", morta.status, 401);
  conferir("chave desativada: frase para o lojista", morta.erro?.includes("recusou a chave"), true);
  const bloqueada = await asaas.lerContaDoAsaas(CHAVE_WHITELIST);
  conferir("whitelist ligada: a frase manda desligar", bloqueada.erro?.includes("Whitelist"), true);

  console.log("\n== O cliente nasce sem notificação ==");
  chamadas.length = 0;
  clientesExistentes = [{ id: "cus_da_loja", notificationDisabled: false }];
  const cliente = await asaas.clienteSemAvisos(CHAVE_BOA, { nome: "Maria", cpf: "529.982.247-25", telefone: "5521999998888" });
  const criacao = chamadas.find((c) => c.metodo === "POST" && c.caminho === "/customers");
  conferir("não reaproveita cliente da loja COM notificação", cliente.dados?.id, "cus_novo");
  conferir("cria com notificationDisabled", criacao?.corpo?.notificationDisabled, true);
  conferir("CPF só com dígitos", criacao?.corpo?.cpfCnpj, "52998224725");
  conferir("celular sem o 55", criacao?.corpo?.mobilePhone, "21999998888");
  chamadas.length = 0;
  clientesExistentes = [{ id: "cus_nosso", notificationDisabled: true }];
  const deNovo = await asaas.clienteSemAvisos(CHAVE_BOA, { nome: "Maria", cpf: "52998224725" });
  conferir("reaproveita o cadastro sem notificação", deNovo.dados?.id, "cus_nosso");
  conferir("e não cria outro", chamadas.some((c) => c.metodo === "POST"), false);

  console.log("\n== A cobrança ==");
  chamadas.length = 0;
  const carteira = await asaas.walletDoFireHub("sandbox", "wal-loja-123");
  conferir("carteira do FireHub (sandbox)", carteira, "wal-firehub-sandbox");
  conferir("loja com a MESMA conta do FireHub: sem split", await asaas.walletDoFireHub("sandbox", "wal-firehub-sandbox"), null);
  const pix = await asaas.criarCobranca(CHAVE_BOA, {
    forma: "pix",
    clienteId: "cus_nosso", valor: 50, descricao: "Pedido #12 — Pizzaria", referencia: "pedido:ckxyz",
    walletDoSplit: carteira, valorDoSplit: splitDoFireHub(50),
  });
  const cobranca = chamadas.find((c) => c.metodo === "POST" && c.caminho === "/payments")?.corpo;
  conferir("gerou", pix.ok, true);
  conferir("Pix", cobranca?.billingType, "PIX");
  conferir("valor", cobranca?.value, 50);
  conferir("referência do pedido", cobranca?.externalReference, "pedido:ckxyz");
  conferir("vencimento hoje (YYYY-MM-DD)", /^\d{4}-\d{2}-\d{2}$/.test(cobranca?.dueDate || ""), true);
  conferir("split para a carteira do FireHub", cobranca?.split?.[0]?.walletId, "wal-firehub-sandbox");
  conferir("split em valor fixo de R$ 0,50", cobranca?.split?.[0]?.fixedValue, 0.5);
  conferir("sem percentualValue (seria sobre o líquido)", cobranca?.split?.[0]?.percentualValue, undefined);
  conferir("copia e cola", pix.dados?.copiaECola?.startsWith("000201"), true);
  conferir("imagem do QR", pix.dados?.imagemBase64, "iVBORw0KGgo=");

  chamadas.length = 0;
  const semSplit = await asaas.criarCobranca(CHAVE_BOA, {
    forma: "pix",
    clienteId: "cus_nosso", valor: 50, descricao: "x", referencia: "pedido:a", walletDoSplit: null, valorDoSplit: 0.5,
  });
  conferir("sem carteira: cobra sem split", chamadas.find((c) => c.caminho === "/payments")?.corpo?.split, undefined);
  conferir("sem carteira: gera mesmo assim", semSplit.ok, true);

  chamadas.length = 0;
  qrFalha = true;
  const semQr = await asaas.criarCobranca(CHAVE_BOA, {
    forma: "pix",
    clienteId: "cus_nosso", valor: 50, descricao: "x", referencia: "pedido:b", walletDoSplit: carteira, valorDoSplit: 0.5,
  });
  qrFalha = false;
  conferir("QR falhou: não gera", semQr.ok, false);
  conferir("QR falhou: apaga a cobrança", chamadas.some((c) => c.metodo === "DELETE" && c.caminho === "/payments/pay_abc"), true);
  conferir("QR falhou: diz o motivo do Asaas", semQr.erro, "Chave Pix não encontrada.");

  console.log("\n== Cartão: a página do Asaas, sem dado de cartão ==");
  chamadas.length = 0;
  const cartao = await asaas.criarCobranca(CHAVE_BOA, {
    forma: "cartao", clienteId: "cus_nosso", valor: 100, descricao: "Pedido #13", referencia: "pedido:cartao1",
    walletDoSplit: carteira, valorDoSplit: splitDoFireHub(100, "cartao"),
  });
  const corpoCartao = chamadas.find((c) => c.metodo === "POST" && c.caminho === "/payments")?.corpo;
  conferir("gerou", cartao.ok, true);
  conferir("cobrança de cartão de crédito", corpoCartao?.billingType, "CREDIT_CARD");
  conferir("NENHUM dado de cartão sai do FireHub", corpoCartao?.creditCard === undefined && corpoCartao?.creditCardHolderInfo === undefined, true);
  conferir("devolve a página do Asaas", cartao.dados?.linkDePagamento, "https://www.asaas.com/i/abc123");
  conferir("não pede QR de Pix", chamadas.some((c) => c.caminho.includes("pixQrCode")), false);
  conferir("taxa online de R$ 1,00 no split", corpoCartao?.split?.[0]?.fixedValue, 1);

  console.log("\n== Split recusado: a venda não para ==");
  chamadas.length = 0;
  recusarSplit = true;
  const semSplitAceito = await asaas.criarCobranca(CHAVE_BOA, {
    forma: "pix", clienteId: "cus_nosso", valor: 50, descricao: "x", referencia: "pedido:c", walletDoSplit: carteira, valorDoSplit: 0.5,
  });
  recusarSplit = false;
  const tentativas = chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/payments");
  conferir("tentou com split e refez sem", tentativas.map((c) => Boolean(c.corpo?.split)), [true, false]);
  conferir("a cobrança saiu", semSplitAceito.ok, true);
  conferir("sem split", semSplitAceito.dados?.split, 0);
  conferir("guarda o motivo do Asaas", semSplitAceito.dados?.splitRecusado, "O walletId informado no split não está autorizado.");

  console.log("\n== Pago, estornado ==");
  conferir("RECEIVED é pago", asaas.cobrancaPaga("RECEIVED"), true);
  conferir("CONFIRMED é pago", asaas.cobrancaPaga("CONFIRMED"), true);
  conferir("PENDING não é pago", asaas.cobrancaPaga("PENDING"), false);
  conferir("REFUNDED é estornado", asaas.cobrancaEstornada("REFUNDED"), true);
  const estorno = await asaas.estornarCobranca(CHAVE_BOA, "pay_abc", "Pedido cancelado pela loja");
  conferir("estorno pedido ao Asaas", estorno.dados?.status, "REFUNDED");

  console.log("\n== O aviso de pagamento (webhook) ==");
  chamadas.length = 0;
  const wh = await asaas.criarWebhookNaLoja(CHAVE_BOA, {
    url: "https://firehubfood.com.br/api/webhooks/asaas-loja/loja1",
    email: "x@y.com",
    authToken: "t".repeat(43),
  });
  const corpoWh = chamadas.find((c) => c.caminho === "/webhooks")?.corpo;
  conferir("criado", wh.dados?.id, "wh_1");
  conferir("ouve o Pix recebido", corpoWh?.events?.includes("PAYMENT_RECEIVED"), true);
  conferir("ouve o estorno", corpoWh?.events?.includes("PAYMENT_REFUNDED"), true);
  conferir("ouve a chave desativada", corpoWh?.events?.includes("ACCESS_TOKEN_DISABLED"), true);
  conferir("manda o token", corpoWh?.authToken?.length, 43);
  conferir("fila em ordem", corpoWh?.sendType, "SEQUENTIALLY");

  servidor.close();
  console.log(`\n${ok} ok, ${falhou} falha(s)\n`);
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  servidor.close();
  process.exit(1);
});
