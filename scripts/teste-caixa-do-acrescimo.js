/**
 * O acréscimo tem que cair na linha CERTA do fechamento de caixa.
 *
 * Este foi o cuidado que o dono levantou ("cuidado pro caixa fechar
 * corretamente"), e ele estava certo: a régua de api/cash-session/route.ts
 * testa `m.includes("food")` para vale-refeição, e "iFood" contém "food".
 *
 * Aqui a cadeia principal daquele arquivo (linhas 190-270) é replicada tal como
 * está, e usada para responder duas perguntas:
 *   A) o que aconteceria se o acréscimo fosse gravado DENTRO do pedido do iFood
 *      (o desenho que foi descartado);
 *   B) o que acontece com o desenho escolhido — pedido próprio colado, com a
 *      forma de pagamento que o cliente usou.
 */

// Cópia da decisão de linha do caixa, para um pedido sem pagamento dividido.
function linhaDoCaixa(o) {
  const pm = (o.paymentMethod || '').toLowerCase();
  const src = (o.source || '').toUpperCase();

  if (o.tableSessionId) return 'mesa (fora do laço)';

  const ehVendaDeSalao = src === 'PDV' || src === 'TOTEM';
  const isOnlinePayment =
    pm.includes('online') ||
    pm.includes('prepaid') ||
    pm.includes('ifood') ||
    pm.includes('pago_online') ||
    (!ehVendaDeSalao && !!(o.paymentPaidAt || o.gatewayProvider)) ||
    (src === 'IFOOD' && !pm.includes('dinheiro') && !pm.includes('debito') && !pm.includes('débito') && !pm.includes('credito') && !pm.includes('crédito') && !pm.includes('maquininha') && !pm.includes('cobrar'));

  const ehFiado = pm.includes('funcion') || pm.includes('fiado');

  if (src === 'IFOOD' && isOnlinePayment) return 'ifoodOnline (informativo)';
  if (isOnlinePayment && !ehVendaDeSalao) return 'ifoodOnline (informativo)';
  if (ehFiado) return 'fiado (fora da conferência)';
  if (pm.includes('dinheiro') || pm.includes('cash')) return 'GAVETA (dinheiro)';
  if (pm.includes('débito') || pm.includes('debito') || pm.includes('debit')) return 'debito';
  if (pm.includes('crédito') || pm.includes('credito') || pm.includes('credit')) return 'credito';
  if (pm.includes('pix')) return 'pix';
  if (pm.includes('voucher') || pm.includes('vale') || pm.includes('meal') || pm.includes('food')) return 'VOUCHER (vale-refeição)';
  if (pm.includes('maquininha') || pm.includes('cartão') || pm.includes('cartao')) return 'credito';
  return 'não identificado';
}

let ok = 0, falhou = 0;
function conferir(nome, real, esperado) {
  if (real === esperado) { ok++; console.log(`  ok   ${nome}  ->  ${real}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${esperado}\n         veio:     ${real}`); }
}

console.log('\n== A) O desenho DESCARTADO: acréscimo dentro do pedido do iFood ==');
console.log('   (gravar as duas partes em paymentMethods exigiria um rótulo "iFood")');
const somarParte = (metodo) => {
  const m = metodo.toLowerCase();
  if (m.includes('dinheiro') || m.includes('cash')) return 'GAVETA (dinheiro)';
  if (m.includes('débito') || m.includes('debito') || m.includes('debit')) return 'debito';
  if (m.includes('crédito') || m.includes('credito') || m.includes('credit')) return 'credito';
  if (m.includes('pix')) return 'pix';
  if (m.includes('voucher') || m.includes('vale') || m.includes('meal') || m.includes('food')) return 'VOUCHER (vale-refeição)';
  if (m.includes('cart') || m.includes('maquin')) return 'credito';
  return 'não identificado';
};
conferir('parte "iFood (Pago Online)" R$ 50', somarParte('iFood (Pago Online)'), 'VOUCHER (vale-refeição)');
conferir('parte "99Food (Pago Online)" R$ 50', somarParte('99Food (Pago Online)'), 'VOUCHER (vale-refeição)');
console.log('   ^ o repasse do marketplace iria para a linha de vale-refeição. Por isso NÃO se faz assim.');

console.log('\n== B) O desenho ESCOLHIDO: pedido do parceiro intocado + acréscimo próprio ==');
const pedidoIfood = { source: 'IFOOD', paymentMethod: 'iFood (Pago Online)', ifoodOrderId: 'abc' };
conferir('pedido do iFood continua na linha dele', linhaDoCaixa(pedidoIfood), 'ifoodOnline (informativo)');

for (const [forma, esperado] of [
  ['Dinheiro', 'GAVETA (dinheiro)'],
  ['Pix', 'pix'],
  ['Débito', 'debito'],
  ['Crédito', 'credito'],
]) {
  conferir(`acréscimo pago em ${forma}`, linhaDoCaixa({ source: 'PRESENCIAL', paymentMethod: forma }), esperado);
}

console.log('\n== C) Armadilhas verificadas ==');
conferir(
  'acréscimo NÃO herda o canal do pai (seria voucher se herdasse)',
  linhaDoCaixa({ source: 'IFOOD', paymentMethod: 'Pix' }),
  'credito'.replace('credito', 'ifoodOnline (informativo)')
);
console.log('   ^ marcar o acréscimo como IFOOD o jogaria na linha do repasse, e o dinheiro sumiria da gaveta.');
conferir(
  'acréscimo não pode nascer com paymentPaidAt',
  linhaDoCaixa({ source: 'PRESENCIAL', paymentMethod: 'Dinheiro', paymentPaidAt: new Date() }),
  'ifoodOnline (informativo)'
);
console.log('   ^ por isso a rota grava o acréscimo SEM paymentPaidAt: o carimbo de "pago" o tiraria da gaveta.');

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
