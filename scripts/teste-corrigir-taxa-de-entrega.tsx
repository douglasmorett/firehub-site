/**
 * scripts/teste-corrigir-taxa-de-entrega.tsx — a tela "Corrigir taxa de
 * entrega" do painel (src/components/customer/CorrigirTaxaDeEntregaPainel.tsx),
 * sem navegador e sem rede.
 *
 *   npx tsx scripts/teste-corrigir-taxa-de-entrega.tsx
 *
 * Prova:
 *   1. o botão aparece só onde a rota aceita (entrega própria, não cancelada,
 *      editável) — tela e servidor na MESMA régua;
 *   2. a faixa da distância digitada e o total depois são a MESMA conta do
 *      servidor (lib/entrega-do-pedido.ts: faixaDaDistancia, ajusteDaTaxa);
 *   3. a divisão nova do pago dividido já vem preenchida e fechando;
 *   4. o PATCH: 200, 409 `precisaDividir`, 400 da divisão, 409 de
 *      concorrência, 403 e sem conexão, cada um no caminho certo;
 *   5. a tela renderizada (renderToStaticMarkup): sugestão, faixas, motivo
 *      obrigatório, divisão com o total novo, salvar travado até fechar.
 *
 * Caso real: Divinos Burger (Cabo Frio, ROTA), 25/09/2026 — cliente a 0,84 km
 * cobrado R$ 12 (faixa mais cara) porque o mapa não achou o endereço.
 */
process.env.COTACAO_SECRET = process.env.COTACAO_SECRET || "segredo-de-teste-da-tela";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CorrigirTaxaDeEntregaPainel, {
  FormularioDaTaxa,
  divisaoFecha,
  divisaoInicial,
  distanciaValida,
  enviarCorrecao,
  faixaDaDistanciaNaTela,
  lerDadosDaTaxa,
  lerNumero,
  partesDaDivisao,
  pedidoDeEntrega,
  podeCorrigirTaxa,
  taxaValida,
  totalComTaxaNova,
  type DadosDaTaxa,
} from "../src/components/customer/CorrigirTaxaDeEntregaPainel";
import { ajusteDaTaxa, faixaDaDistancia, faixasDaLoja } from "../src/lib/entrega-do-pedido";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe).slice(0, 400)}` : ""}`); }
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const DIVINOS = [
  { km: 1, fee: 5, time: 30, motoboyFee: 4 },
  { km: 1.5, fee: 8, time: 30, motoboyFee: 7 },
  { km: 2, fee: 10, time: 35, motoboyFee: 9 },
  { km: 2.5, fee: 12, time: 35, motoboyFee: 11 },
  { km: 3, fee: 15, time: 40, motoboyFee: 14 },
  { km: 3.5, fee: 17, time: 40, motoboyFee: 16 },
  { km: 4, fee: 18, time: 45, motoboyFee: 17 },
  { km: 4.5, fee: 19, time: 45, motoboyFee: 18 },
  { km: 5, fee: 20, time: 50, motoboyFee: 19 },
];

const DONO = { role: "FRANCHISEE", permissions: "" };
const FUNC_SEM = { role: "STAFF", permissions: "ver_pedidos" };
const FUNC_COM = { role: "STAFF", permissions: "ver_pedidos,editar_pedidos" };
const PEDIDO = { id: "ped1", status: "ENTREGUE", source: "SITE", deliveryType: "DELIVERY", deliveryFee: 12, totalAmount: 42, paymentMethod: "Dinheiro" };

// ── 1. Quando o botão aparece ──────────────────────────────────────────────
{
  confere("entrega do site, dono: aparece", podeCorrigirTaxa(PEDIDO, DONO));
  confere("funcionário com 'editar pedidos': aparece", podeCorrigirTaxa(PEDIDO, FUNC_COM));
  confere("funcionário sem a permissão: não aparece (a rota dá 403)", !podeCorrigirTaxa(PEDIDO, FUNC_SEM));
  confere("tipo vazio é entrega (a rota trata assim)", pedidoDeEntrega({ deliveryType: null }) && podeCorrigirTaxa({ ...PEDIDO, deliveryType: "" }, DONO));
  for (const t of ["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO", "MESA", " retirada "]) {
    confere(`retirada '${t}': não aparece`, !podeCorrigirTaxa({ ...PEDIDO, deliveryType: t }, DONO));
  }
  for (const s of ["CANCELADO", "CANCELLED", "canceled"]) {
    confere(`cancelado '${s}': não aparece`, !podeCorrigirTaxa({ ...PEDIDO, status: s }, DONO));
  }
  confere("aguardando pagamento: não aparece (ainda não é pedido)", !podeCorrigirTaxa({ ...PEDIDO, status: "AGUARDANDO_PAGAMENTO" }, DONO));
  confere("iFood: não aparece (a taxa é do app)", !podeCorrigirTaxa({ ...PEDIDO, source: "IFOOD", ifoodOrderId: "abc" }, DONO));
  confere("99Food: não aparece", !podeCorrigirTaxa({ ...PEDIDO, source: "99FOOD", openDeliveryOrderId: "x", openDeliveryChannel: "99FOOD" }, DONO));
  confere("pedido de mesa com conta: não aparece", !podeCorrigirTaxa({ ...PEDIDO, tableSessionId: "mesa1" }, DONO));
  confere("balcão com entrega: aparece", podeCorrigirTaxa({ ...PEDIDO, source: "PRESENCIAL" }, DONO));
  confere("sem id: não aparece", !podeCorrigirTaxa({ ...PEDIDO, id: undefined }, DONO));
}

// ── 2. Números digitados e a mesma conta do servidor ───────────────────────
{
  confere("'5' → 5", lerNumero("5") === 5);
  confere("'5,50' → 5.5", lerNumero("5,50") === 5.5);
  confere("'R$ 5.5' → 5.5", lerNumero("R$ 5.5") === 5.5);
  confere("'1.234,56' não vira 1,23", lerNumero("1.234,56") === null);
  confere("vazio → null", lerNumero("") === null && lerNumero("  ") === null && lerNumero(",") === null);
  confere("taxa 0 vale (cortesia)", taxaValida("0") === 0);
  confere("taxa 300 vale, 300,01 não (teto da rota)", taxaValida("300") === 300 && taxaValida("300,01") === null);
  confere("distância 0 vale, 60 vale, 60,5 não", distanciaValida("0") === 0 && distanciaValida("60") === 60 && distanciaValida("60,5") === null);

  // A faixa que a tela mostra para a distância digitada é a do servidor.
  const faixasDaTela = lerDadosDaTaxa({ faixas: faixasDaLoja(DIVINOS) }).faixas;
  confere("as 9 faixas da Divinos chegam na tela em ordem", faixasDaTela.map((f) => f.km).join() === "1,1.5,2,2.5,3,3.5,4,4.5,5");
  const divergencias: number[] = [];
  for (let c = 0; c <= 560; c++) {
    const km = c / 100;
    const tela = faixaDaDistanciaNaTela(faixasDaTela, km);
    const servidor = faixaDaDistancia(DIVINOS, km);
    if (!igual(tela, servidor)) divergencias.push(km);
  }
  confere("0 a 5,6 km de 10 em 10 m: a faixa da tela = a do servidor", divergencias.length === 0, divergencias.slice(0, 10));
  confere("0,84 km → até 1 km, R$ 5", faixaDaDistanciaNaTela(faixasDaTela, 0.84)?.taxa === 5);
  confere("1,00 km → até 1 km (limite inclusivo)", faixaDaDistanciaNaTela(faixasDaTela, 1)?.km === 1);
  confere("1,01 km → até 1,5 km", faixaDaDistanciaNaTela(faixasDaTela, 1.01)?.km === 1.5);
  confere("5,05 km → última (folga de 50 m)", faixaDaDistanciaNaTela(faixasDaTela, 5.05)?.km === 5);
  confere("5,06 km → nenhuma", faixaDaDistanciaNaTela(faixasDaTela, 5.06) === null);
  confere("sem faixas → nenhuma", faixaDaDistanciaNaTela([], 1) === null);

  // O total que a tela prevê é o que o servidor grava.
  const casos: [number, number, number][] = [[42, 12, 5], [35, 5, 12], [20, 12, 0], [10, 12, 0], [99.99, 7.33, 4.1], [42, 0, 8]];
  for (const [total, antes, nova] of casos) {
    const servidor = ajusteDaTaxa({ totalAntes: total, taxaAntes: antes, taxaNova: nova, motoboyFeeAntes: null, distanciaAntes: null, regra: { separado: false } as any, zonas: DIVINOS }).totalDepois;
    confere(`total ${total} com taxa ${antes} → ${nova}: tela = servidor (${servidor})`, totalComTaxaNova(total, antes, nova) === servidor, totalComTaxaNova(total, antes, nova));
  }
}

// ── 3. A divisão nova do pago dividido ─────────────────────────────────────
{
  const pix20din22 = [{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 22 }];
  const a = divisaoInicial(pix20din22, 35);
  confere("Pix 20 + Dinheiro 22, total 42 → 35: a diferença cai na última", igual(a, [{ method: "Pix", valor: "20,00" }, { method: "Dinheiro", valor: "15,00" }]), a);
  confere("e fecha", divisaoFecha(a, 35));
  const b = divisaoInicial([{ method: "Pix", amount: 38 }, { method: "Dinheiro", amount: 4 }], 35);
  confere("a última não comporta (-7 em 4): cai na maior", igual(b, [{ method: "Pix", valor: "31,00" }, { method: "Dinheiro", valor: "4,00" }]), b);
  const c = divisaoInicial(pix20din22, 49);
  confere("taxa subiu 7: a última recebe", c[1].valor === "29,00" && divisaoFecha(c, 49), c);
  const d = divisaoInicial([{ method: "Crédito", amount: 20 }, { method: "débito", amount: 22 }], 42);
  confere("forma antiga vira a do seletor (o servidor recusa fora da lista)", d[0].method === "Cartão Crédito" && d[1].method === "Cartão Débito", d);
  confere("sem partes gravadas: sem divisão", divisaoInicial([], 35).length === 0);
  confere("uma forma só não fecha (mínimo duas)", !divisaoFecha([{ method: "Pix", valor: "35" }], 35));
  confere("2 centavos de tolerância (a do servidor)", divisaoFecha([{ method: "Pix", valor: "20" }, { method: "Dinheiro", valor: "15,02" }], 35));
  confere("3 centavos já não fecha", !divisaoFecha([{ method: "Pix", valor: "20" }, { method: "Dinheiro", valor: "15,03" }], 35));
  confere("linha sem forma ou sem valor não conta", partesDaDivisao([{ method: "", valor: "5" }, { method: "Pix", valor: "" }, { method: "Pix", valor: "3,5" }]).length === 1);
}

// ── 4. O PATCH e cada resposta da rota ─────────────────────────────────────
async function testarEnvio() {
  const chamadas: { url: string; init: any }[] = [];
  const resposta = (status: number, corpo: unknown) =>
    (async (url: any, init: any) => {
      chamadas.push({ url: String(url), init });
      return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

  const corpo = { taxa: 5, motivo: "cliente mora a 800 m, faixa de R$ 5", distanciaKm: 0.8 };
  const r1 = await enviarCorrecao("ped1", corpo, resposta(200, { success: true, deliveryFee: 5, totalAmount: 35, motoboyFee: 4, aviso: "O entregador cobra o total novo: R$ 35,00." }));
  confere("200 → ok", r1.tipo === "ok" && r1.dados.totalAmount === 35);
  confere("PATCH na rota do pedido, com o corpo em JSON", chamadas[0].url === "/api/store/orders/ped1/taxa-de-entrega" && chamadas[0].init.method === "PATCH" && igual(JSON.parse(chamadas[0].init.body), corpo));

  const r2 = await enviarCorrecao("ped1", corpo, resposta(409, {
    error: "Este pedido foi pago dividido (Dividido: Pix R$ 20,00 + Dinheiro R$ 22,00). Com a taxa nova o total fica R$ 35,00: informe como fica a divisão.",
    precisaDividir: true, totalDepois: 35, pagamentoDividido: [{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 22 }],
  }));
  confere("409 precisaDividir → pedir a divisão, com as partes e o total do servidor",
    r2.tipo === "dividir" && r2.totalDepois === 35 && r2.partes?.length === 2 && r2.erro.includes("pago dividido"), r2);

  const r3 = await enviarCorrecao("ped1", corpo, resposta(400, { error: "A soma das formas (R$ 34,00) não bate com o total do pedido (R$ 35,00).", precisaDividir: true, totalDepois: 35 }));
  confere("400 da divisão → continua dividindo, sem partes (mantém o digitado)", r3.tipo === "dividir" && r3.partes === null && r3.erro.includes("não bate"), r3);

  const r4 = await enviarCorrecao("ped1", corpo, resposta(409, { error: "O pedido mudou enquanto você corrigia a taxa. Abra o pedido de novo e confira." }));
  confere("409 de concorrência → erro com 'mudou' (a tela relê)", r4.tipo === "erro" && r4.mudou === true, r4);

  const r5 = await enviarCorrecao("ped1", corpo, resposta(403, { error: "A taxa de entrega de um pedido do iFood é do iFood." }));
  confere("403 → erro com a frase da rota, sem reler", r5.tipo === "erro" && !r5.mudou && r5.erro.includes("iFood"), r5);

  const r6 = await enviarCorrecao("ped1", corpo, (async () => { throw new Error("offline"); }) as typeof fetch);
  confere("sem conexão → erro legível", r6.tipo === "erro" && r6.erro === "Sem conexão. Tente de novo.", r6);

  const r7 = await enviarCorrecao("ped1", corpo, (async () => new Response("<html>502</html>", { status: 502 })) as typeof fetch);
  confere("502 sem JSON → 'Erro 502'", r7.tipo === "erro" && r7.erro.includes("502"), r7);
}

// ── 5. A tela renderizada ─────────────────────────────────────────────────
function testarTela() {
  const html = (el: React.ReactElement) => renderToStaticMarkup(el);
  const nada = async () => {};

  const fechado = html(<CorrigirTaxaDeEntregaPainel pedido={PEDIDO} operador={DONO} aoSalvar={nada} />);
  confere("fechado: taxa gravada e o botão", fechado.includes("R$ 12,00") && fechado.includes("Corrigir taxa de entrega"), fechado);
  confere("retirada: nada na tela", html(<CorrigirTaxaDeEntregaPainel pedido={{ ...PEDIDO, deliveryType: "RETIRADA" }} operador={DONO} aoSalvar={nada} />) === "");
  confere("cancelado: nada na tela", html(<CorrigirTaxaDeEntregaPainel pedido={{ ...PEDIDO, status: "CANCELADO" }} operador={DONO} aoSalvar={nada} />) === "");
  confere("iFood: nada na tela", html(<CorrigirTaxaDeEntregaPainel pedido={{ ...PEDIDO, source: "IFOOD", ifoodOrderId: "x" }} operador={DONO} aoSalvar={nada} />) === "");

  // O GET da Divinos para o cliente a 0,84 km cobrado R$ 12.
  const dados: DadosDaTaxa = lerDadosDaTaxa({
    deliveryFee: 12, totalAmount: 42, motoboyFee: 11, deliveryDistance: 0.84, separaRepasse: true,
    faixas: faixasDaLoja(DIVINOS), pagamentoDividido: [], sugestao: faixaDaDistancia(DIVINOS, 0.84),
  });
  const form = (d: DadosDaTaxa, inicial?: { taxaTexto?: string; distanciaTexto?: string; motivo?: string }) =>
    html(<FormularioDaTaxa pedidoId="ped1" dados={d} inicial={inicial} aoCancelar={() => {}} aoConcluir={() => {}} aoPedidoMudou={() => {}} />);

  const f1 = form(dados);
  confere("o que está gravado: taxa, total, distância e repasse", f1.includes("R$ 12,00") && f1.includes("R$ 42,00") && f1.includes("0,84 km") && f1.includes("R$ 11,00"), f1);
  confere("a sugestão: até 1 km, R$ 5,00, com o botão Usar", f1.includes("até 1 km: R$ 5,00") && f1.includes("Usar R$ 5,00"));
  confere("as 9 faixas, com o repasse do motoboy", (f1.match(/até [\d,]+ km · R\$/g) || []).length === 9 && f1.includes("(motoboy R$ 4,00)"));
  confere("motivo obrigatório na tela", f1.includes("Motivo (obrigatório)"));
  confere("salvar travado sem taxa e sem motivo", /<button[^>]*disabled=""[^>]*>Salvar correção/.test(f1));
  confere("opção 'a distância gravada estava errada' (loja separa repasse)", f1.includes("estava errada"));
  confere("sem pago dividido: sem divisão", !f1.includes("Pago dividido"));

  const f2 = form(dados, { taxaTexto: "5", motivo: "cliente mora a 800 m" });
  confere("taxa e motivo: total 42 → 35 e salvar liberado", f2.includes("R$ 42,00 → R$ 35,00") && !/<button[^>]*disabled=""[^>]*>Salvar correção/.test(f2), f2.match(/Total do pedido[^<]*/)?.[0]);
  const f2b = form(dados, { taxaTexto: "5", motivo: "ab" });
  confere("motivo de 2 letras: salvar travado (a rota exige 3)", /<button[^>]*disabled=""[^>]*>Salvar correção/.test(f2b));
  const f2c = form(dados, { taxaTexto: "301", motivo: "motivo ok" });
  confere("taxa acima do teto: aviso e salvar travado", f2c.includes("Taxa inválida") && /<button[^>]*disabled=""[^>]*>Salvar correção/.test(f2c));

  const f3 = form(dados, { distanciaTexto: "0,8" });
  confere("distância digitada: diz a faixa e oferece a taxa", f3.includes("0,8 km cai na faixa até 1 km") && f3.includes("Usar R$ 5,00"));
  confere("com distância nova, a opção da medida errada some (o repasse segue a distância)", !f3.includes("estava errada") && f3.includes("passa a seguir a faixa desta distância"));
  const f3b = form(dados, { distanciaTexto: "61", taxaTexto: "5", motivo: "motivo ok" });
  confere("distância acima de 60 km: aviso e salvar travado", f3b.includes("Distância inválida") && /<button[^>]*disabled=""[^>]*>Salvar correção/.test(f3b));

  // Pago dividido: a divisão nova aparece JÁ preenchida e fechando.
  const dividido = { ...dados, pagamentoDividido: [{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 22 }] };
  const f4 = form(dividido, { taxaTexto: "5", motivo: "cliente mora a 800 m" });
  confere("pago dividido: pede a divisão com o total novo", f4.includes("como fica a divisão com o total de R$ 35,00"), f4);
  confere("a divisão vem preenchida (Pix 20 + Dinheiro 15) e fecha", f4.includes('value="20,00"') && f4.includes('value="15,00"') && f4.includes("✓ fecha em R$ 35,00"));
  confere("fechando, salvar liberado", !/<button[^>]*disabled=""[^>]*>Salvar correção/.test(f4));
  const f5 = form(dividido, { taxaTexto: "12", motivo: "conferido" });
  confere("taxa igual à gravada: total não muda, não pede divisão", !f5.includes("Pago dividido"));

  // Sem distância gravada e sem faixas.
  const semDistancia = form({ ...dados, deliveryDistance: null, sugestao: null });
  confere("sem distância gravada: pede para conferir no mapa", semDistancia.includes("não tem distância gravada") && !semDistancia.includes("estava errada"));
  const longe = form({ ...dados, deliveryDistance: 7.2, sugestao: null });
  confere("distância além da última faixa: avisa", longe.includes("passa da última faixa (5 km)"));
  const semFaixas = form({ ...dados, faixas: [], sugestao: null, separaRepasse: false });
  confere("loja por bairro (sem faixas de km): só o campo da taxa", !semFaixas.includes("Faixas da loja") && semFaixas.includes("Taxa certa"));
  const jaCerta = form(lerDadosDaTaxa({ deliveryFee: 5, totalAmount: 35, deliveryDistance: 0.84, faixas: faixasDaLoja(DIVINOS), sugestao: faixaDaDistancia(DIVINOS, 0.84) }));
  confere("taxa gravada já é a da faixa: diz isso, sem botão Usar", jaCerta.includes("já é a da faixa da distância") && !jaCerta.includes("Usar R$ 5,00"));

  const recado = html(<FormularioDaTaxa pedidoId="ped1" dados={dados} recado="O pedido mudou enquanto você corrigia a taxa." aoCancelar={() => {}} aoConcluir={() => {}} aoPedidoMudou={() => {}} />);
  confere("releitura: o recado aparece", recado.includes("O pedido mudou enquanto você corrigia a taxa."));

  // O GET com lixo não derruba a tela.
  const lixo = lerDadosDaTaxa({ deliveryFee: "abc", totalAmount: null, faixas: [{ km: "x", taxa: 5 }, { km: 2, taxa: "8" }, null], pagamentoDividido: "nada", sugestao: { km: 0 } });
  confere("GET com lixo: zeros, uma faixa válida, sem sugestão", lixo.deliveryFee === 0 && lixo.totalAmount === 0 && lixo.faixas.length === 1 && lixo.faixas[0].taxa === 8 && lixo.sugestao === null && lixo.pagamentoDividido.length === 0, lixo);
}

(async () => {
  await testarEnvio();
  testarTela();
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exit(1);
})();
