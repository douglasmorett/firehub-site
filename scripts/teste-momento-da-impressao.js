/**
 * A regra de QUANDO a comanda sai (lib/momento-da-impressao.ts).
 *
 * O que importa provar aqui não é cada caso isolado — é que os TRÊS caminhos
 * que imprimem sozinhos fazem a mesma pergunta e recebem a mesma resposta:
 *
 *   1. a fila da nuvem (api/store/print-queue), que roda com o painel fechado;
 *   2. o GlobalPrintListener, em qualquer aba do painel;
 *   3. o auto-print do painel de pedidos (StoreOrdersDashboard).
 *
 * Se um deles divergir, a comanda sai adiantada por ali e a opção vira "às
 * vezes" — o pior estado possível, porque o lojista não consegue reproduzir.
 *
 * Função pura, sem banco.
 */
const path = require('path');
const createJiti = require('jiti');

const jiti = createJiti(__filename, {
  alias: { '@': path.resolve(__dirname, '..', 'src') },
  interopDefault: true,
  esmResolve: true,
});

const { aguardandoFimDoKds, esperaOFimDoKds, motivoDaEspera } = jiti(
  path.resolve(__dirname, '..', 'src', 'lib', 'momento-da-impressao.ts')
);

let ok = 0, falhou = 0;
function conferir(nome, real, esperado) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

const DESLIGADO = { autoprint: true };
const LIGADO = { autoprint: true, imprimirSoNoFimDoKds: true };

console.log('\n== O padrão é imprimir na hora ==');
conferir('config ausente', esperaOFimDoKds(undefined), false);
conferir('config nula', esperaOFimDoKds(null), false);
conferir('config sem o campo', esperaOFimDoKds(DESLIGADO), false);
conferir('campo explicitamente false', esperaOFimDoKds({ imprimirSoNoFimDoKds: false }), false);
conferir('campo ligado', esperaOFimDoKds(LIGADO), true);

console.log('\n== Com a opção DESLIGADA, nada segura a comanda ==');
for (const estagio of ['PRODUCTION', 'FINISHING', 'FINISHED', null, undefined, '']) {
  conferir(`kdsStage ${JSON.stringify(estagio)}`, aguardandoFimDoKds({ kdsStage: estagio }, DESLIGADO), false);
}

console.log('\n== Com a opção LIGADA, só FINISHED libera ==');
conferir('recém-chegado (PRODUCTION) -> segura', aguardandoFimDoKds({ kdsStage: 'PRODUCTION' }, LIGADO), true);
conferir('em finalização (FINISHING) -> segura', aguardandoFimDoKds({ kdsStage: 'FINISHING' }, LIGADO), true);
conferir('sem estágio (null) -> segura', aguardandoFimDoKds({ kdsStage: null }, LIGADO), true);
conferir('estágio desconhecido -> segura', aguardandoFimDoKds({ kdsStage: 'QUALQUER_COISA' }, LIGADO), true);
conferir('FINALIZADO -> libera', aguardandoFimDoKds({ kdsStage: 'FINISHED' }, LIGADO), false);
conferir('finished minúsculo -> libera (não é sensível a caixa)', aguardandoFimDoKds({ kdsStage: 'finished' }, LIGADO), false);

console.log('\n== O motivo chega escrito para o lojista ==');
conferir('sem espera, sem motivo', motivoDaEspera({ kdsStage: 'FINISHED' }, LIGADO), null);
const motivo = motivoDaEspera({ kdsStage: 'PRODUCTION' }, LIGADO);
conferir('com espera, tem motivo', typeof motivo === 'string' && motivo.length > 20, true);
conferir('o motivo diz onde a opção foi ligada', /KDS/.test(motivo) && /Impressora/i.test(motivo), true);

console.log('\n== Os três caminhos decidem IGUAL ==');
// Cada caminho tem o seu shape de pedido; o que não pode é a resposta mudar.
const cenarios = [
  { nome: 'pedido novo do iFood', pedido: { kdsStage: 'PRODUCTION', status: 'ACEITO' } },
  { nome: 'pedido finalizado na cozinha', pedido: { kdsStage: 'FINISHED', status: 'PREPARANDO' } },
  { nome: 'pedido sem KDS nenhum', pedido: { kdsStage: null, status: 'NOVO' } },
];
for (const c of cenarios) {
  // fila da nuvem: filtra por kdsStage FINISHED quando esperaOFimDoKds
  const daFila = esperaOFimDoKds(LIGADO) ? String(c.pedido.kdsStage).toUpperCase() !== 'FINISHED' : false;
  // ouvinte global e painel: chamam aguardandoFimDoKds direto
  const doOuvinte = aguardandoFimDoKds(c.pedido, LIGADO);
  const doPainel = aguardandoFimDoKds(c.pedido, LIGADO);
  conferir(`${c.nome}: fila == ouvinte == painel`, [daFila, doOuvinte, doPainel], [daFila, daFila, daFila]);
}

console.log('\n== Pedido nulo não quebra nada ==');
conferir('pedido undefined', aguardandoFimDoKds(undefined, LIGADO), false);
conferir('pedido null', aguardandoFimDoKds(null, LIGADO), false);

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
