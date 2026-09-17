/**
 * A régua de cupons (lib/cupons.ts): validade, limite por cliente, primeiro
 * pedido — e a compatibilidade com o formato antigo, que é o que está gravado
 * nas lojas hoje (5 cupons em 2 lojas em 17/09/2026, só com code/type/discount/
 * minOrderValue/active).
 *
 * Função pura, sem banco. Os fatos que dependem do banco (dia da loja, usos,
 * já pediu) entram prontos, que é exatamente como o servidor os passa.
 */
const path = require('path');
const createJiti = require('jiti');
const jiti = createJiti(__filename, { alias: { '@': path.resolve(__dirname, '..', 'src') }, interopDefault: true, esmResolve: true });
const { lerCupom, lerCupons, acharCupom, cupomDePrimeiroPedido, cupomVenceu, avaliarCupom, descreverBeneficio, cuponsAnunciaveis } =
  jiti(path.resolve(__dirname, '..', 'src', 'lib', 'cupons.ts'));

let ok = 0, falhou = 0;
function conferir(nome, real, esperado) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

const HOJE = '2026-09-17';
const fatos = (extra = {}) => ({ subtotal: 100, taxa: 8, hojeDaLoja: HOJE, usosDoCliente: null, jaPediuPeloSite: null, ...extra });

console.log('\n== O formato antigo continua valendo como está ==');
// Os cinco cupons reais de produção, como estão gravados.
const ANTIGOS = [
  { code: 'BROCADO', type: 'percent', discount: 10, minOrderValue: 60, active: true },
  { code: 'HAKIM10', discount: 10, active: true },                       // sem type
  { code: 'SAUDADE10', type: 'fixed', discount: 10, minOrderValue: 40, active: true },
  { code: 'HAKIM15', type: 'percent', discount: 15, active: true },
  { code: 'SAMANTHA20', type: 'percent', discount: 20, active: true },
];
conferir('os 5 são lidos', lerCupons(ANTIGOS).length, 5);
conferir('sem type vira percent', lerCupom(ANTIGOS[1]).type, 'percent');
conferir('sem validade = não vence', lerCupom(ANTIGOS[0]).validade, null);
conferir('sem limite = 0 (ilimitado)', lerCupom(ANTIGOS[0]).usosPorCliente, 0);
conferir('não é de primeiro pedido', lerCupom(ANTIGOS[0]).primeiroPedido, false);
conferir('HAKIM10 dá 10% de 100', avaliarCupom(lerCupom(ANTIGOS[1]), fatos()).desconto, 10);
conferir('SAUDADE10 abaixo do mínimo recusa', avaliarCupom(lerCupom(ANTIGOS[2]), fatos({ subtotal: 30 })).ok, false);
conferir('SAUDADE10 no mínimo dá R$ 10', avaliarCupom(lerCupom(ANTIGOS[2]), fatos({ subtotal: 40 })).desconto, 10);
conferir('código é normalizado (minúsculo, espaços)', acharCupom(ANTIGOS, ' hakim10 ')?.code, 'HAKIM10');
conferir('inativo não é achado', acharCupom([{ code: 'X', discount: 5, active: false }], 'X'), null);

console.log('\n== Validade: último dia inclusive, no dia da loja ==');
const comValidade = lerCupom({ code: 'SETEMBRO', type: 'percent', discount: 10, active: true, validade: '2026-09-17' });
conferir('vale no próprio dia', cupomVenceu(comValidade, '2026-09-17'), false);
conferir('venceu no dia seguinte', cupomVenceu(comValidade, '2026-09-18'), true);
conferir('recusa com a data na frase', avaliarCupom(comValidade, fatos({ hojeDaLoja: '2026-09-18' })).motivo, 'Este cupom venceu em 17/09.');
conferir('validade mal escrita é ignorada (não vence)', lerCupom({ code: 'A', discount: 5, active: true, validade: '17/09/2026' }).validade, null);

console.log('\n== Limite de usos por cliente ==');
const umaVez = lerCupom({ code: 'BEMVINDO', type: 'fixed', discount: 15, active: true, usosPorCliente: 1 });
conferir('telefone desconhecido: aceita, mas depende do telefone', avaliarCupom(umaVez, fatos()).dependeDoTelefone, true);
conferir('0 usos: aceita', avaliarCupom(umaVez, fatos({ usosDoCliente: 0 })).ok, true);
conferir('1 uso com limite 1: recusa', avaliarCupom(umaVez, fatos({ usosDoCliente: 1 })).ok, false);
conferir('a frase diz "1 vez"', /1 vez por cliente/.test(avaliarCupom(umaVez, fatos({ usosDoCliente: 1 })).motivo), true);
const tresVezes = lerCupom({ code: 'TRIO', type: 'percent', discount: 5, active: true, usosPorCliente: 3 });
conferir('2 de 3: aceita', avaliarCupom(tresVezes, fatos({ usosDoCliente: 2 })).ok, true);
conferir('3 de 3: recusa e diz "3 vezes"', /3 vezes/.test(avaliarCupom(tresVezes, fatos({ usosDoCliente: 3 })).motivo), true);
conferir('limite negativo vira ilimitado', lerCupom({ code: 'N', discount: 5, active: true, usosPorCliente: -2 }).usosPorCliente, 0);

console.log('\n== Cupom de primeiro pedido ==');
const primeiro = lerCupom({ code: 'PRIMEIROPEDIDO', type: 'percent', discount: 15, active: true, primeiroPedido: true });
conferir('é o cupom de primeiro pedido da lista', cupomDePrimeiroPedido([ANTIGOS[0], primeiro])?.code, 'PRIMEIROPEDIDO');
conferir('lista sem ele -> null', cupomDePrimeiroPedido(ANTIGOS), null);
conferir('inativo não conta', cupomDePrimeiroPedido([{ ...primeiro, active: false }]), null);
conferir('quem nunca pediu: aceita', avaliarCupom(primeiro, fatos({ jaPediuPeloSite: false })).ok, true);
conferir('quem já pediu: recusa', avaliarCupom(primeiro, fatos({ jaPediuPeloSite: true })).ok, false);
conferir('a frase explica', /primeiro pedido pelo site/.test(avaliarCupom(primeiro, fatos({ jaPediuPeloSite: true })).motivo), true);
conferir('telefone desconhecido: aceita, depende do telefone', avaliarCupom(primeiro, fatos()).dependeDoTelefone, true);
conferir('somentePrimeiroPedido (campanha) é lido igual', lerCupom({ code: 'VOLTA', discount: 10, active: true, somentePrimeiroPedido: true }).primeiroPedido, true);

console.log('\n== Frete grátis e teto do desconto ==');
const frete = lerCupom({ code: 'FRETE', type: 'free_shipping', active: true });
conferir('frete grátis zera a taxa, desconto 0', [avaliarCupom(frete, fatos()).zeraTaxa, avaliarCupom(frete, fatos()).desconto], [true, 0]);
const gigante = lerCupom({ code: 'MIL', type: 'fixed', discount: 1000, active: true });
conferir('desconto fixo não passa de itens + taxa', avaliarCupom(gigante, fatos()).desconto, 108);

console.log('\n== O que o robô pode anunciar ==');
const lista = [
  { code: 'PUB', type: 'percent', discount: 10, active: true, isPublic: true },
  { code: 'PUBVENCIDO', type: 'percent', discount: 10, active: true, isPublic: true, validade: '2026-01-01' },
  { code: 'PRIM', type: 'percent', discount: 15, active: true, isPublic: true, primeiroPedido: true },
  { code: 'PRIVADO', type: 'percent', discount: 30, active: true },
];
conferir('só o público, ativo, não vencido e sem regra de primeiro pedido', cuponsAnunciaveis(lista, HOJE).map((c) => c.code), ['PUB']);

console.log('\n== Texto do benefício ==');
conferir('percentual', descreverBeneficio(primeiro), '15% de desconto');
conferir('fixo', descreverBeneficio(umaVez), 'R$ 15,00 de desconto');
conferir('frete', descreverBeneficio(frete), 'frete grátis');

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
