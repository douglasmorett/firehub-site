/**
 * O módulo Balança (self-service por quilo) e a comanda numerada, sem banco:
 * - o protocolo Toledo (lib/balanca/protocolo-toledo.ts) e o peso firme;
 * - a balança simulada passando pelo leitor de verdade (lib/balanca/leitor-serial.ts);
 * - a faixa de cartões, o número lido do cartão e o Code 39 (lib/comanda.ts);
 * - a cobrança de R$ 197 no mês (lib/balanca/assinatura.ts);
 * - a nota em KG (lib/fiscal-itens.ts), a linha da conta e o papel sem "MESA 155".
 * Roda: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-balanca.ts
 */
import assert from "node:assert/strict";
import {
  ENQ, extrairQuadros, lerQuadro, pesoFirme, quadroDoPeso, textoDoPeso, valorDoPeso, type LeituraDaBalanca,
} from "../src/lib/balanca/protocolo-toledo";
import { PortaSimulada, conectarNaBalanca } from "../src/lib/balanca/leitor-serial";
import { barrasCode39, faixaDeComandas, nomeDaMesa, numeroLidoDoCartao } from "../src/lib/comanda";
import { valorDaBalancaNoMes, PRECO_DA_BALANCA, DIAS_DE_TESTE_DA_BALANCA, type TrechoDaBalanca } from "../src/lib/balanca/assinatura";
import { CLAUSULAS_DO_TERMO_DA_BALANCA } from "../src/lib/balanca/termo";
import { montarItensDaNota } from "../src/lib/fiscal-itens";
import { nomeDaLinhaDaConta } from "../src/lib/conta-da-mesa";
import { numeroDaMesa, nomeComMesa, camposDaMesaParaImpressao } from "../src/lib/mesa-na-comanda";
import { planejarEdicaoNaMesa } from "../src/lib/edicao-na-mesa";
import { receitaDoMes, SERVICOS_VAZIOS } from "../src/lib/performance-das-carteiras/regras";

const STX = 0x02;
const ETX = 0x03;
const bytes = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

async function main() {
  // ── Protocolo ──────────────────────────────────────────────────────────
  assert.equal(ENQ, 0x05);
  assert.deepEqual(lerQuadro("00446"), { tipo: "peso", kg: 0.446 });
  assert.deepEqual(lerQuadro("15000"), { tipo: "peso", kg: 15 });
  assert.deepEqual(lerQuadro("IIIII"), { tipo: "instavel" });
  assert.deepEqual(lerQuadro("NNNNN"), { tipo: "negativo" });
  assert.deepEqual(lerQuadro("SSSSS"), { tipo: "sobrecarga" });
  assert.equal(lerQuadro("x?1").tipo, "invalida");

  // A porta entrega aos pedaços: o quadro só sai inteiro.
  let r = extrairQuadros([STX, ...bytes("004")]);
  assert.equal(r.leituras.length, 0);
  r = extrairQuadros([...r.resto, ...bytes("46"), ETX, STX, ...bytes("00")]);
  assert.deepEqual(r.leituras, [{ tipo: "peso", kg: 0.446 }]);
  assert.deepEqual(r.resto, [STX, ...bytes("00")]);
  // ETX repetido (log do ACBr) não vira quadro vazio; lixo antes do STX é ignorado.
  r = extrairQuadros([...bytes("lixo"), STX, ...bytes("00512"), ETX, ETX]);
  assert.deepEqual(r.leituras, [{ tipo: "peso", kg: 0.512 }]);
  assert.deepEqual(r.resto, []);
  // Velocidade errada (só lixo): não acumula para sempre.
  assert.deepEqual(extrairQuadros(new Array(100).fill(0x41)).resto, []);
  // A simulada fala o mesmo protocolo.
  assert.deepEqual(extrairQuadros(quadroDoPeso(0.452)).leituras, [{ tipo: "peso", kg: 0.452 }]);
  assert.deepEqual(extrairQuadros(quadroDoPeso("instavel")).leituras, [{ tipo: "instavel" }]);

  // Peso firme: 3 leituras iguais, dentro dos limites.
  const p = (kg: number): LeituraDaBalanca => ({ tipo: "peso", kg });
  assert.equal(pesoFirme([p(0.452), p(0.452)]), null);
  assert.equal(pesoFirme([p(0.45), p(0.452), p(0.452), p(0.452)]), 0.452);
  assert.equal(pesoFirme([p(0.452), { tipo: "instavel" }, p(0.452)]), null);
  assert.equal(pesoFirme([p(0.452), p(0.452), p(0.454)]), null);
  assert.equal(pesoFirme([p(0), p(0), p(0)]), null, "balança vazia não é prato");
  assert.equal(pesoFirme([p(40), p(40), p(40)]), null, "acima de 30 kg não é prato");

  // Valor em centavos inteiros: 0,452 kg × R$ 52,01 = 23,50852 → R$ 23,51.
  assert.equal(valorDoPeso(0.452, 52.01), 23.51);
  assert.equal(valorDoPeso(1, 59.9), 59.9);
  assert.equal(textoDoPeso(0.452), "0,452 kg");

  // ── Balança simulada pelo leitor de verdade ────────────────────────────
  const porta = new PortaSimulada();
  const leitor = await conectarNaBalanca(porta, null);
  assert.ok(leitor, "conecta na simulada");
  assert.equal(leitor!.velocidade, 2400, "a primeira velocidade que responde");
  assert.deepEqual(await leitor!.pedirPeso(), { tipo: "peso", kg: 0 });
  porta.pesar(0.452);
  assert.deepEqual(await leitor!.pedirPeso(), { tipo: "instavel" }, "o prato chega balançando");
  await new Promise((ok) => setTimeout(ok, 800));
  const ultimas: LeituraDaBalanca[] = [];
  for (let i = 0; i < 3; i++) ultimas.push((await leitor!.pedirPeso())!);
  assert.equal(pesoFirme(ultimas), 0.452);
  porta.tirar();
  assert.deepEqual(await leitor!.pedirPeso(), { tipo: "peso", kg: 0 });
  await leitor!.fechar();
  assert.equal(await leitor!.pedirPeso(), null, "fechado não responde");

  // ── Comanda ────────────────────────────────────────────────────────────
  const mesas = [1, 2, 3, 30].map((n) => ({ number: n, tipo: null }));
  assert.deepEqual(faixaDeComandas(101, 103, mesas), { ok: true, numeros: [101, 102, 103] });
  const choque = faixaDeComandas(25, 40, mesas);
  assert.equal(choque.ok, false);
  assert.match((choque as any).erro, /30 já são mesas/);
  assert.equal(faixaDeComandas(1, 1000, []).ok, false, "faixa grande demais");
  assert.equal(faixaDeComandas(10, 5, []).ok, false, "faixa invertida");
  // Criar a mesma faixa de novo só cria o que falta.
  assert.deepEqual(faixaDeComandas(101, 104, [...mesas, { number: 101, tipo: "COMANDA" }, { number: 102, tipo: "COMANDA" }]), { ok: true, numeros: [103, 104] });

  assert.equal(numeroLidoDoCartao("155"), 155);
  assert.equal(numeroLidoDoCartao("*155*"), 155, "Code 39 com os asteriscos");
  assert.equal(numeroLidoDoCartao(" 0155\n"), 155);
  assert.equal(numeroLidoDoCartao("abc"), null);
  assert.equal(numeroLidoDoCartao("0"), null);
  assert.equal(nomeDaMesa({ number: 155, tipo: "COMANDA" }), "Comanda 155");
  assert.equal(nomeDaMesa({ number: 4, tipo: null }), "Mesa 4");

  // Code 39: "*1*" = 3 caracteres × 15 módulos + 2 espaços = 47; 5 barras por caractere.
  const c = barrasCode39(1);
  assert.equal(c.total, 47);
  assert.equal(c.barras.length, 15);
  // O "*" começa com barra estreita, espaço largo (nwnnwnwnn).
  assert.deepEqual(c.barras.slice(0, 2), [{ x: 0, largura: 1 }, { x: 4, largura: 1 }]);

  // ── Cobrança ───────────────────────────────────────────────────────────
  assert.equal(PRECO_DA_BALANCA, 197);
  assert.equal(DIAS_DE_TESTE_DA_BALANCA, 7);
  assert.ok(CLAUSULAS_DO_TERMO_DA_BALANCA.some((t) => /R\$\s197,00/.test(t)), "o preço no termo (o pt-BR usa espaço não separável)");
  assert.ok(CLAUSULAS_DO_TERMO_DA_BALANCA.some((t) => /não vende, não aluga e não entrega equipamento/.test(t)));
  const ini = new Date("2026-11-01T03:00:00Z");
  const fim = new Date("2026-12-01T03:00:00Z");
  const agora = new Date("2026-12-05T12:00:00Z");
  const t = (de: string, ate: string | null): TrechoDaBalanca => ({ de: new Date(de).toISOString(), ate: ate ? new Date(ate).toISOString() : null, valor: 197 });
  assert.equal(valorDaBalancaNoMes([t("2026-10-01T12:00:00Z", null)], null, ini, fim, agora), 197);
  // Teste até 10/11 e continuou ligada: novembro inteiro.
  assert.equal(valorDaBalancaNoMes([t("2026-11-03T12:00:00Z", null)], "2026-11-10T12:00:00Z", ini, fim, agora), 197);
  // Desligou dentro do teste: nada.
  assert.equal(valorDaBalancaNoMes([t("2026-11-03T12:00:00Z", "2026-11-06T12:00:00Z")], "2026-11-10T12:00:00Z", ini, fim, agora), 0);
  // Ligou e desligou duas vezes no mês: uma vez só.
  assert.equal(valorDaBalancaNoMes([t("2026-11-12T12:00:00Z", "2026-11-13T12:00:00Z"), t("2026-11-20T12:00:00Z", null)], "2026-11-01T00:00:00Z", ini, fim, agora), 197);

  // ── Nota em KG ─────────────────────────────────────────────────────────
  const produto = { id: "p1", name: "Refeição por kg", ncm: "21069090", cfop: "5102", csosn: "102", origem: 0 } as any;
  const [kg] = montarItensDaNota([{ id: "i1", quantity: 1, price: 23.51, pesoKg: 0.452, menuProduct: produto }]);
  assert.equal(kg.unidadeComercial, "KG");
  assert.equal(kg.quantidade, 0.452);
  assert.equal(kg.valorUnitario, 52.01);
  assert.equal(kg.valorTotal, 23.51);
  const [un] = montarItensDaNota([{ id: "i2", quantity: 2, price: 7, menuProduct: { ...produto, name: "Suco" } }]);
  assert.equal(un.unidadeComercial, "UN");
  assert.equal(un.quantidade, 2);

  // ── Conta e papel ──────────────────────────────────────────────────────
  assert.equal(nomeDaLinhaDaConta({ quantity: 1, price: 23.51, pesoKg: 0.452, menuProduct: { name: "Refeição por kg" } }), "Refeição por kg (0,452 kg)");
  assert.equal(nomeDaLinhaDaConta({ quantity: 1, price: 7, menuProduct: { name: "Suco" } }), "Suco");
  const daComanda = { deliveryType: "MESA", tableSessionId: "s1", customerAddress: "Comanda 155", tableSession: { table: { number: 155, tipo: "COMANDA" } } };
  assert.equal(numeroDaMesa(daComanda), "", "cartão não é mesa no papel");
  assert.equal(nomeComMesa("Comanda 155", camposDaMesaParaImpressao(daComanda)), "Comanda 155");
  const daMesa = { deliveryType: "MESA", tableSessionId: "s2", tableSession: { table: { number: 4, tipo: null } } };
  assert.equal(numeroDaMesa(daMesa), "4");

  // ── Edição na mesa: o prato pesado não vira "2x"; tirar continua valendo ──
  const rodada = { deliveryFee: 0, discountTotal: 0, items: [
    { id: "p", quantity: 1, price: 23.51, productName: "Refeição por kg", menuProductId: "m1", pesoKg: 0.452 },
    { id: "s", quantity: 1, price: 7, productName: "Suco", menuProductId: "m2" },
  ] };
  const dobra = planejarEdicaoNaMesa(rodada, { itens: [{ itemId: "p", quantity: 2 }] }, true);
  assert.equal(dobra.ok, false);
  assert.match((dobra as any).error, /foi pesado \(0,452 kg\)/);
  assert.equal(planejarEdicaoNaMesa(rodada, { removerItemIds: ["p"] }, true).ok, true, "tirar o prato pesado pode");
  assert.equal(planejarEdicaoNaMesa(rodada, { itens: [{ itemId: "s", quantity: 2 }] }, true).ok, true, "o suco muda de quantidade");

  // ── Carteira do vendedor: a Balança entra no boleto previsto ──────────
  const previsto = receitaDoMes(null, { ...SERVICOS_VAZIOS, balanca: 197 }, false);
  assert.equal(previsto.servicos.balanca, 197);
  assert.equal(previsto.boleto, 197);

  console.log("teste-balanca: tudo certo");
}

main().catch((e) => { console.error(e); process.exit(1); });
