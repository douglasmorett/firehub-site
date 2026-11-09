/** Regressão de apresentação: renderiza o componente React real, sem API/banco.
 * --antes reproduz a ausência do gráfico na base83bb5bad (deve falhar no zero).
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const rules={};new Function('exports',compile(readFileSync('src/lib/funil-do-site-regras.ts','utf8')))(rules);
const base=execFileSync('git',['show','83bb5badcf8ce81f96dd0555f183afad21a63a5e:src/components/customer/FunilDoSite.tsx'],{encoding:'utf8'});
const load=source=>{const e={};new Function('exports','require',compile(source))(e,name=>name==='@/lib/funil-do-site-regras'?rules:require(name));return e;};
const old=load(base),current=load(readFileSync('src/components/customer/FunilDoSite.tsx','utf8'));
const selected=process.argv.includes('--antes')?old:current;
const zero={visita:0,produto:0,carrinho:0,checkout:0,pedido:0};
const data=funil=>({online:{agora:0,comCarrinho:0,finalizando:0},periodo:{funil,origens:[],dispositivos:{celular:0,computador:0}},anterior:null,desde:null});
const render=(dados,module=selected)=>renderToStaticMarkup(React.createElement(module.FunilDoSiteVisual,{dados,rotulo:'Hoje',inicioDoPeriodo:new Date('2026-11-09T08:00:00Z')}));
const empty=render(data(zero));
assert.match(empty,/role="img"/,'com período real zerado, o desenho deve continuar visível');
assert.match(empty,/aria-label="Entraram no site: 0; Abriram um produto: 0; Puseram no carrinho: 0; Foram finalizar: 0; Fizeram o pedido: 0"/,'cinco etapas com zeros reais');
for(const label of ['Visitas','Conversão','Carrinhos largados','De onde vieram'])assert.ok(empty.includes(label),`indicador ${label} visível`);
assert.ok(empty.includes('Ainda não há visitas registradas neste período.'));
assert.ok(empty.includes('Nenhuma origem registrada neste período.'));
assert.doesNotMatch(empty,/Onde você mais perde clientes|Capriche nas fotos|NaN|Infinity/,'zero não gera conselho sem base nem divisão inválida');
assert.equal(JSON.stringify(zero),JSON.stringify({visita:0,produto:0,carrinho:0,checkout:0,pedido:0}),'renderização não cria eventos');
const since=render({...data(zero),desde:'2026-11-09T12:00:00Z'});
assert.ok(since.includes('Contando desde'));
assert.match(since,/role="img"/,'primeira visita anterior não é requisito para ver o funil zerado');

const missing=render({online:{agora:0,comCarrinho:0,finalizando:0}});
assert.ok(missing.includes('Os dados deste período ainda não estão disponíveis.'));
assert.doesNotMatch(missing,/role="img"|Nenhuma origem registrada|Ainda não há visitas/,'período ausente não vira contagem zero');
const loading=renderToStaticMarkup(React.createElement(selected.default,{janela:{inicio:new Date('2026-11-09T08:00:00Z'),fim:new Date('2026-11-10T08:00:00Z')},anterior:null,loja:null,rotulo:'Hoje'}));
assert.ok(loading.includes('Carregando as visitas'));
assert.doesNotMatch(loading,/role="img"/,'carregamento não inventa métricas');

const visits=data({visita:4,produto:0,carrinho:0,checkout:0,pedido:0});
visits.periodo.origens=[{origem:'direto',visitas:4,pedidos:0}];visits.periodo.dispositivos={celular:4,computador:0};
assert.equal(render(visits,current),render(visits,old),'4 visitas e nenhuma venda preservam exatamente o gráfico/indicadores existentes');
const full=data({visita:200,produto:120,carrinho:60,checkout:30,pedido:24});
full.anterior={funil:{visita:100,produto:60,carrinho:30,checkout:15,pedido:10}};
full.periodo.origens=[{origem:'instagram',visitas:200,pedidos:24}];full.periodo.dispositivos={celular:150,computador:50};
assert.equal(render(full,current),render(full,old),'dados, comparação, origens e diagnóstico existentes ficam idênticos');
console.log('ok: funil React real com zero visitas, início da contagem, ausência/carregamento e dados/comparativos preservados; sem API/banco');
