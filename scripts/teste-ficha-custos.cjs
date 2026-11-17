const fs=require('fs'), path=require('path'), ts=require('typescript'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function load(file,mocks={}) {
 const full=path.resolve(root,file);const exp={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const req=(s)=>{if(s in mocks)return mocks[s];if(s.startsWith('.')||s.startsWith('@/'))return load((s.startsWith('@/')?path.join('src',s.slice(2)):path.relative(root,path.resolve(path.dirname(full),s)))+'.ts',mocks);return require(s)};
 new Function('require','module','exports',js)(req,exp,exp.exports);return exp.exports;
}
const {resumirFicha,correspondeBusca}=load('src/lib/estoque/custo-da-ficha.ts');
const {custosNoDia}=load('src/lib/cmv/custo-do-insumo.ts');
const costs={massa:{custo:.5,faltando:[],foraDoCmv:false},queijo:{custo:.03,faltando:[],foraDoCmv:false},fora:{custo:0,faltando:[],foraDoCmv:true}};
const lines=[{stockItemId:'massa',quantityConsumed:1},{stockItemId:'queijo',quantityConsumed:20}];
assert.equal(resumirFicha(lines,costs,5,30).custo,1.1);assert.equal(resumirFicha(lines,costs,5,30).cmvPct,22);
assert.equal(resumirFicha(lines,costs,5,20).margemBaixa,true);
assert.equal(resumirFicha([...lines,{stockItemId:'ausente',quantityConsumed:1}],costs,5,30).custo,null);
assert.equal(resumirFicha([{stockItemId:'massa',quantityConsumed:''}],costs,5,30).custo,null);
assert.equal(resumirFicha([],costs,5,30).custo,null);
assert.equal(resumirFicha(lines,costs,0,30).cmvPct,null);
assert.equal(resumirFicha([{stockItemId:'fora',quantityConsumed:2}],costs,5,30).custo,0);
assert(correspondeBusca('Esfirra de Queijo — Salgadas','ESFIRRA queijo'));assert(correspondeBusca('Pão de queijo','pao'));
assert(!correspondeBusca('Refrigerante','esfirra'));
const ins=[{id:'q',nome:'Queijo',unidade:'g',tipo:'INSUMO',rendimento:null,unitCost:.05,componentes:[]}];
const entradas=[{stockItemId:'q',dia:'2026-11-10',em:1,unitCost:.03,custoAnterior:.02},{stockItemId:'q',dia:'2026-11-17',em:2,unitCost:.05,custoAnterior:.03}];
assert.equal(custosNoDia(ins,entradas,'2026-11-16').get('q').custo,.03);
assert.equal(custosNoDia(ins,entradas,'2026-11-17').get('q').custo,.05);
assert.equal(custosNoDia(ins,entradas,'2026-11-09').get('q').custo,.02);
assert.equal(custosNoDia(ins,[...entradas,{stockItemId:'q',dia:'2026-11-18',em:3,unitCost:.04,custoAnterior:.05}],'2026-11-18').get('q').custo,.04);
let acesso={ok:true,acesso:{lojaId:'loja-a',usuarioId:'dono',mexeNoEstoque:true}};
let item={id:'q',franchiseeId:'loja-a',tipo:'INSUMO',unitCost:.03,active:true},logs=[],writes=[],conflito=false;
const tx={stockItem:{findFirst:async({where})=> item&&item.franchiseeId===where.franchiseeId?item:null,updateMany:async q=>{writes.push(q);return{count:conflito?0:1}}},stockTransaction:{create:async q=>{logs.push(q);return q.data}}};
const mocks={'next/server':{NextResponse:{json:(data,init)=>new Response(JSON.stringify(data),init)}},'@/lib/cmv/acesso':{exigirDadosSensiveis:async()=>acesso},'@/lib/prisma':{prisma:{$transaction:async f=>f(tx)}}};
const {PATCH}=load('src/app/api/store/estoque/custo/route.ts',mocks);
const call=body=>PATCH(new Request('http://localhost/api/store/estoque/custo',{method:'PATCH',body:JSON.stringify(body)}));
(async()=>{
 const ajustes=[{stockItemId:'q',type:'CUSTO',unitCost:.05,createdAt:new Date('2026-11-17T12:00:00Z'),stockInvoiceId:null,notes:JSON.stringify({custoAnterior:.03})}];
 let consulta;
 const {entradasComCusto}=load('src/lib/cmv/contagem-no-banco.ts',{
  '@/lib/prisma':{prisma:{stockTransaction:{findMany:async q=>{consulta=q;return ajustes}},stockInvoice:{findMany:async()=>{throw Error('Ajuste não consulta compra inexistente')}}}},
  '@/lib/relatorios/base':{naLoja:()=>({dia:'2026-11-17'})},
  '@/lib/pausa-pelo-estoque-no-banco':{},
 });
 const historico=await entradasComCusto('loja-a','America/Sao_Paulo');
 assert.equal(consulta.where.franchiseeId,'loja-a');assert(consulta.where.OR.some(q=>q.type==='CUSTO'));
 assert.equal(historico.length,1);assert.equal(historico[0].custoAnterior,.03);
 assert.equal(custosNoDia(ins,historico,'2026-11-16').get('q').custo,.03);
 assert.equal(custosNoDia(ins,historico,'2026-11-17').get('q').custo,.05);
 assert.equal((await call({id:'q',custo:.05})).status,200);assert.equal(logs[0].data.quantity,0);assert.equal(logs[0].data.type,'CUSTO');assert.equal(JSON.parse(logs[0].data.notes).custoAnterior,.03);assert.deepEqual(writes[0].data,{unitCost:.05});assert.equal(writes[0].where.franchiseeId,'loja-a');
 logs=[];writes=[];item={...item,franchiseeId:'outra-loja'};assert.equal((await call({id:'q',custo:.05})).status,404);assert.equal(writes.length,0);
 item={...item,franchiseeId:'loja-a',tipo:'PREPARO'};assert.equal((await call({id:'q',custo:.05})).status,400);
 item={...item,tipo:'INSUMO'};conflito=true;assert.equal((await call({id:'q',custo:.05})).status,409);assert.equal(logs.length,0);conflito=false;
 for(const custo of [0,-1,'0,05',null,1000001])assert.equal((await call({id:'q',custo})).status,400);
 acesso={ok:false,resposta:new Response('',{status:401})};assert.equal((await call({id:'q',custo:.05})).status,401);
 acesso={ok:false,resposta:new Response('',{status:403})};assert.equal((await call({id:'q',custo:.05})).status,403);
 acesso={ok:true,acesso:{lojaId:'loja-a',usuarioId:'staff',mexeNoEstoque:false}};assert.equal((await call({id:'q',custo:.05})).status,403);
 console.log('PASS: prévia de custo/CMV, busca, histórico antes/depois, compra posterior, autenticação, permissões, isolamento, preparo, validação, concorrência e saldo preservado.');
})().catch(e=>{console.error(e);process.exitCode=1});
