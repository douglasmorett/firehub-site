/**
 * A régua de origem da venda (lib/origem-da-venda.ts): BALCÃO, MESA, DELIVERY
 * ou RETIRADA. É ela que separa as linhas do Relatório de Mesas.
 *
 * Os casos são as combinações (source, deliveryType, tableSessionId) que
 * EXISTEM no banco — medidas em 17/09/2026 nos últimos 30 dias, com a
 * contagem de cada uma ao lado. Uma combinação classificada errado não é um
 * caso de canto: é uma linha inteira do relatório indo para a coluna errada.
 *
 * Função pura, sem banco.
 */
const path = require('path');
const createJiti = require('jiti');
const jiti = createJiti(__filename, { alias: { '@': path.resolve(__dirname, '..', 'src') }, interopDefault: true, esmResolve: true });
const { origemDaVenda, canalDentroDoDelivery } = jiti(path.resolve(__dirname, '..', 'src', 'lib', 'origem-da-venda.ts'));

let ok = 0, falhou = 0;
function conferir(nome, real, esperado) {
  if (real === esperado) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${esperado}\n         veio:     ${real}`); }
}

console.log('\n== As combinações reais do banco (30 dias, contagem ao lado) ==');
const CASOS = [
  // [descrição,                                   pedido,                                                                      esperado]
  ['iFood DELIVERY (5.057)',                       { source: 'IFOOD', deliveryType: 'DELIVERY', ifoodOrderId: 'x' },                 'DELIVERY'],
  ['PRESENCIAL MESA com sessão (777)',             { source: 'PRESENCIAL', deliveryType: 'MESA', tableSessionId: 's1' },              'MESA'],
  ['PRESENCIAL RETIRADA = balcão (270)',           { source: 'PRESENCIAL', deliveryType: 'RETIRADA' },                                'BALCAO'],
  ['99Food DELIVERY (249)',                        { source: '99FOOD', deliveryType: 'DELIVERY', openDeliveryChannel: '99FOOD' },     'DELIVERY'],
  ['Jotajá DELIVERY (201)',                        { source: 'JOTAJA', deliveryType: 'DELIVERY', openDeliveryOrderId: 'j' },         'DELIVERY'],
  ['ONLINE DELIVERY (162)',                        { source: 'ONLINE', deliveryType: 'DELIVERY' },                                    'DELIVERY'],
  ['ONLINE PICKUP = retirada, não balcão (53)',    { source: 'ONLINE', deliveryType: 'PICKUP' },                                      'RETIRADA'],
  ['iFood RETIRADA = retirada (44)',               { source: 'IFOOD', deliveryType: 'RETIRADA', ifoodOrderId: 'x' },                 'RETIRADA'],
  ['WhatsApp IA DELIVERY (44)',                    { source: 'WHATSAPP_IA', deliveryType: 'DELIVERY' },                               'DELIVERY'],
  ['Brendi DELIVERY (34)',                         { source: 'BRENDI', deliveryType: 'DELIVERY', openDeliveryChannel: 'BRENDI' },     'DELIVERY'],
  ['Jotajá RETIRADA (32)',                         { source: 'JOTAJA', deliveryType: 'RETIRADA', openDeliveryOrderId: 'j' },         'RETIRADA'],
  ['WhatsApp IA RETIRADA (17)',                    { source: 'WHATSAPP_IA', deliveryType: 'RETIRADA' },                               'RETIRADA'],
  ['TOTEM TAKEOUT = balcão (5)',                   { source: 'TOTEM', deliveryType: 'TAKEOUT' },                                      'BALCAO'],
  ['PRESENCIAL DELIVERY = entrega lançada no caixa (5)', { source: 'PRESENCIAL', deliveryType: 'DELIVERY' },                         'DELIVERY'],
  ['PDV DELIVERY (2)',                             { source: 'PDV', deliveryType: 'DELIVERY' },                                       'DELIVERY'],
  ['SITE MESA sem sessão = mesa antiga pelo PDV (1)', { source: 'SITE', deliveryType: 'MESA' },                                       'MESA'],
  ['SITE TAKEOUT = retirada (1)',                  { source: 'SITE', deliveryType: 'TAKEOUT' },                                       'RETIRADA'],
];
for (const [nome, pedido, esperado] of CASOS) conferir(nome, origemDaVenda(pedido), esperado);

console.log('\n== A sessão manda, venha o pedido de onde vier ==');
conferir('pedido do QR da mesa (source SITE) com sessão -> MESA', origemDaVenda({ source: 'SITE', deliveryType: 'DELIVERY', tableSessionId: 's' }), 'MESA');
conferir('pedido de garçom pelo link com sessão -> MESA', origemDaVenda({ source: 'PRESENCIAL', deliveryType: 'RETIRADA', tableSessionId: 's' }), 'MESA');

console.log('\n== Caixa e nulos não derrubam ==');
conferir('deliveryType minúsculo', origemDaVenda({ source: 'presencial', deliveryType: 'delivery' }), 'DELIVERY');
conferir('tudo nulo -> RETIRADA (nunca some, nunca vira balcão)', origemDaVenda({}), 'RETIRADA');

console.log('\n== O nome da plataforma dentro do delivery vem da régua oficial ==');
conferir('iFood', canalDentroDoDelivery({ source: 'IFOOD', ifoodOrderId: 'x' }), 'iFood');
conferir('99Food', canalDentroDoDelivery({ source: '99FOOD', openDeliveryChannel: '99FOOD' }), '99Food');
conferir('site próprio', canalDentroDoDelivery({ source: 'ONLINE' }), 'Online');

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
