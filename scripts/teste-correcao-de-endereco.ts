/**
 * "Corrigir endereço" do pedido (lib/correcao-de-endereco.ts) e o painel que
 * a usa (components/customer/CorrigirEnderecoPainel.tsx).
 *   npx tsx scripts/teste-correcao-de-endereco.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  enderecoParaGravar,
  mesmoEndereco,
  motivoParaNaoCorrigir,
  problemaDoEndereco,
  refazADistancia,
} from "../src/lib/correcao-de-endereco";
import CorrigirEnderecoPainel from "../src/components/customer/CorrigirEnderecoPainel";

let falhas = 0;
let oks = 0;
const confere = (nome: string, cond: boolean, detalhe?: unknown) => {
  if (cond) { oks++; console.log(`✓ ${nome}`); }
  else { falhas++; console.log(`✖ ${nome}`, detalhe ?? ""); }
};

const dono = { role: "FRANCHISEE", permissions: "" };
const funcionarioSem = { role: "STAFF", permissions: "orders" };
const funcionarioCom = { role: "STAFF", permissions: "orders,editar_pedidos" };
const base = { id: "p1", status: "ACEITO", deliveryType: "DELIVERY", customerAddress: "Rua Campo de Marlin, 120 - Atlantica, casa 1" };

// ── Quem pode ──────────────────────────────────────────────────────────────
confere("dono corrige pedido próprio", motivoParaNaoCorrigir(base, dono) === null);
confere("pedido do 99Food também (o endereço não é dinheiro do app)",
  motivoParaNaoCorrigir({ ...base, openDeliveryChannel: "99FOOD", openDeliveryOrderId: "x", paymentMethod: "Dinheiro" }, dono) === null);
confere("pedido do iFood também", motivoParaNaoCorrigir({ ...base, ifoodOrderId: "abc", source: "IFOOD" }, dono) === null);
confere("pedido já entregue ainda corrige (registro)", motivoParaNaoCorrigir({ ...base, status: "ENTREGUE" }, dono) === null);
confere("NFC-e autorizada NÃO trava o endereço",
  motivoParaNaoCorrigir({ ...base, fiscalStatus: "AUTORIZADA", fiscalInfo: { status: "AUTORIZADA" } }, dono) === null);
confere("cancelado não", /cancelado/i.test(motivoParaNaoCorrigir({ ...base, status: "CANCELADO" }, dono) || ""));
confere("retirada não", /não é de entrega/.test(motivoParaNaoCorrigir({ ...base, deliveryType: "PICKUP" }, dono) || ""));
confere("rascunho do robô não", !!motivoParaNaoCorrigir({ ...base, status: "CRIANDO_IA" }, dono));
confere("mesa não", !!motivoParaNaoCorrigir({ ...base, deliveryType: "MESA" }, dono));
confere("funcionário sem 'editar pedidos' não", /permissão/.test(motivoParaNaoCorrigir(base, funcionarioSem) || ""), motivoParaNaoCorrigir(base, funcionarioSem));
confere("funcionário com 'editar pedidos' sim", motivoParaNaoCorrigir(base, funcionarioCom) === null, motivoParaNaoCorrigir(base, funcionarioCom));

// ── O texto ────────────────────────────────────────────────────────────────
confere("espaços e quebras de linha juntados", enderecoParaGravar("  Rua X,\n 10  - Centro ") === "Rua X, 10 - Centro");
confere("curto demais recusa", !!problemaDoEndereco("Rua"));
confere("longo demais recusa", !!problemaDoEndereco("x".repeat(301)));
confere("endereço normal passa", problemaDoEndereco("Rua Campo de Marlin, 122 - Atlantica") === null);
confere("mesmo endereço com caixa/espaço diferente não é correção", mesmoEndereco("rua x, 10", "  Rua X,  10 "));
confere("número diferente é correção", !mesmoEndereco("Rua X, 10", "Rua X, 12"));

// ── A distância ────────────────────────────────────────────────────────────
const agora = new Date("2026-10-17T23:00:00Z");
confere("pedido sem distância: mede", refazADistancia({ createdAt: "2026-10-01T00:00:00Z", deliveryDistance: null }, agora));
confere("pedido de hoje: refaz", refazADistancia({ createdAt: "2026-10-17T20:00:00Z", deliveryDistance: 3.2 }, agora));
confere("pedido de 2 dias: mantém (acerto pode ter sido pago)", !refazADistancia({ createdAt: "2026-10-15T20:00:00Z", deliveryDistance: 3.2 }, agora));

// ── O painel ───────────────────────────────────────────────────────────────
const html = (pedido: any, operador: any) =>
  renderToStaticMarkup(React.createElement(CorrigirEnderecoPainel, { pedido, operador, aoSalvar: () => {} }));
const comBotao = html(base, dono);
confere("painel mostra o endereço e o botão", comBotao.includes("Corrigir endereço") && comBotao.includes("Rua Campo de Marlin"), comBotao);
confere("painel some no pedido cancelado", html({ ...base, status: "CANCELADO" }, dono) === "");
confere("painel some na retirada", html({ ...base, deliveryType: "PICKUP" }, dono) === "");

console.log(`\n${oks} ok, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
