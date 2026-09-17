/**
 * O número do pager (lib/pager.ts).
 *
 * O que importa provar: como o número chega ao PAPEL. Ele entra pelo nome do
 * cliente porque campo novo na comanda só apareceria nas lojas que
 * atualizassem o Assistente — e em 17/09/2026 só 2 de 8 estavam na versão
 * atual. Então o formato do nome é a funcionalidade, não um detalhe.
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

const { lerPager, nomeComPager, ETIQUETA_DO_PAGER } = jiti(
  path.resolve(__dirname, '..', 'src', 'lib', 'pager.ts')
);

let ok = 0, falhou = 0;
function conferir(nome, real, esperado) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

console.log('\n== Sem pager, nada muda ==');
conferir('vazio', lerPager(''), null);
conferir('só espaços', lerPager('   '), null);
conferir('null', lerPager(null), null);
conferir('undefined', lerPager(undefined), null);
conferir('nome intacto sem pager', nomeComPager('João da Silva', null), 'João da Silva');
conferir('nome intacto com pager vazio', nomeComPager('João da Silva', '  '), 'João da Silva');

console.log('\n== A loja numera do jeito dela ==');
conferir('número simples', lerPager('12'), '12');
conferir('com letra', lerPager('A3'), 'A3');
conferir('com zero à esquerda (não vira número)', lerPager('07'), '07');
conferir('espaços em volta são aparados', lerPager('  12  '), '12');

console.log('\n== O nome que vai para a COMANDA ==');
conferir('nome + pager', nomeComPager('João', '12'), `João · ${ETIQUETA_DO_PAGER} 12`);
conferir('"Balcão" dá lugar ao número', nomeComPager('Balcão', '12'), `${ETIQUETA_DO_PAGER} 12`);
conferir('"Balcao" sem acento também', nomeComPager('Balcao', '12'), `${ETIQUETA_DO_PAGER} 12`);
conferir('"Cliente" também é genérico', nomeComPager('Cliente', '7'), `${ETIQUETA_DO_PAGER} 7`);
conferir('caixa não importa no genérico', nomeComPager('BALCÃO', '9'), `${ETIQUETA_DO_PAGER} 9`);
conferir('nome vazio vira só o pager', nomeComPager('', '12'), `${ETIQUETA_DO_PAGER} 12`);
conferir('nome nulo vira só o pager', nomeComPager(null, '12'), `${ETIQUETA_DO_PAGER} 12`);

console.log('\n== Teto de 10 caracteres ==');
// Sem teto, alguém cola a observação inteira e ela vai parar no nome impresso.
const enorme = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
conferir('corta em 10', lerPager(enorme), enorme.slice(0, 10));
conferir('o nome impresso não estoura', nomeComPager('João', enorme).length <= 'João · PAGER '.length + 10, true);

console.log('\n== Não sensível a caixa nem a tipo ==');
conferir('número em vez de texto', lerPager(12), '12');
conferir('zero é pager válido', lerPager(0), '0');

console.log('\n== O caso real do balcão ==');
// O lançamento grava "Balcão" quando ninguém digita nome. Numa bobina de 32
// colunas, "Balcão · PAGER 12" gasta metade da linha dizendo o que o
// cabeçalho já diz.
const semNome = nomeComPager('Balcão', '12');
conferir('sai curto na bobina de 58 mm', semNome.length <= 12, true);
conferir('e é exatamente o número', semNome, 'PAGER 12');

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
