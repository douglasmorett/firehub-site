/** Replay offline: bloco real do webhook e limpeza real, sem API/banco. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const carregar = async file => import('data:text/javascript,'+encodeURIComponent(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText));
const { enxugarResposta } = await carregar('src/lib/resposta-enxuta.ts');
const source=readFileSync('src/app/api/webhook/whatsapp/route.ts','utf8');
const ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let block;
const visit=n=>{if(ts.isIfStatement(n)&&n.expression.getText(ast)==='!falhaDaIa && !donoNaQueda && !callHuman && !ehODono')block=n;ts.forEachChild(n,visit)};visit(ast);assert.ok(block,'bloco real do webhook');
const compiled=ts.transpileModule(block.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const run=new Function('d',`let {replyText,history,transcription,textMessage,chatbotConfig,falhaDaIa,donoNaQueda,callHuman,ehODono,temAnexo,enxugarResposta,remoteJid,console}=d;${compiled};return replyText;`);
const cli=text=>({sender:'user',text}),bot=text=>({sender:'bot',text});
function reply(text,history=[],current='',o={}) {
  return run({replyText:text,history,transcription:'',textMessage:current,chatbotConfig:{modeloDoRobo:'claude-haiku-5-5'},falhaDaIa:false,donoNaQueda:false,callHuman:false,ehODono:false,temAnexo:false,enxugarResposta,remoteJid:'teste',console:{log(){}},...o});
}
// Mesmo texto/histórico, antes (política antiga) e depois (Haiku configurado).
const history=[cli('quero dois hambúrgueres'),bot('Quais você quer?'),cli('um X-Salada e um X-Bacon, o segundo sem cebola')];
const raw='Olá! 😊 Tudo bem? Me passa o endereço com bairro? 👏🏽';
const baseline=enxugarResposta(raw,{historico:history,mensagemDoCliente:'é entrega'}).texto;
const after=reply(raw,history,'é entrega');
assert.match(baseline,/Olá|😊|👏/u);assert.equal(after,'Me passa o endereço com bairro?');
assert.equal(reply('Oi!',[bot('Qual o pedido?')],'oi'),'Oi!','cumprimento sozinho não fica vazio');
assert.equal(reply('Olá, Ana! O endereço continua o mesmo?',[bot('Oi, Bia!')],'sim'),'Olá, Ana! O endereço continua o mesmo?','não adivinha/remove nomes');
assert.equal(reply('👋🏽 Olá! Qual hambúrguer você prefere?'),'Olá! Qual hambúrguer você prefere?','primeira saudação permanece');
assert.equal(reply('Pode mandar 😊',[],'responda com um emoji'),'Pode mandar 😊','pedido explícito de emoji respeitado');
assert.equal(reply('Pode mandar 😊',[],'não use emojis'),'Pode mandar','negação não libera emoji');
assert.equal(reply('Pode mandar 😊',[],'quero sem emoji'),'Pode mandar','quero sem emoji também é recusa');

const tag='[[PEDIDO_IA: {"items":[{"name":"🍔 X-Bacon","quantity":2,"notes":"sem cebola 👩🏽‍🍳"}],"finalized":false}]]';
const url='https://example.test/cardapio/😊?item=👋🏽&q=2';
const facts=`Opções: 🍔 X-Bacon, 🔥 X-Salada, 👩🏽‍🍳 Especial e 1️⃣ Combo\n2x 🍔 X-Bacon: R$ 50,00\n✅ Total: R$ 53,00\n${url}\n${tag}`;
assert.equal(reply(facts,history,'quanto fica?'),facts,'JSON/tags/URLs/valores/listas/Unicode compostos intactos');
assert.equal(reply('A opção "👋🏽 Feliz" continua disponível. 😊'), 'A opção "👋🏽 Feliz" continua disponível.','nome entre aspas preservado');
assert.equal(reply('Temos o 😊 Feliz.'),'Temos o 😊 Feliz.','emoji dentro de nome em prosa não é removido');
assert.equal(reply('Acabou o X-Salada. 😊 Feliz continua disponível.'),'Acabou o X-Salada. 😊 Feliz continua disponível.','emoji após pontuação no meio da prosa também pode ser nome');
assert.equal(reply('Você escolheu 👩🏽‍🍳 Especial. 😊'),'Você escolheu 👩🏽‍🍳 Especial.','ZWJ informativo não é fatiado');
assert.equal(reply('👍'), '👍','ack sozinho não é transformado em silêncio');

// Continua o mesmo pedido, com informação parcial; pagamento/troco já dados
// saem da pergunta, mas a única escolha que falta continua.
const partial=[...history,bot('É entrega ou retirada?'),cli('entrega, Rua A 20, Centro'),bot('Pix, cartão ou dinheiro?')];
const r=reply('Olá! 😊 Vai precisar de troco? Qual ponto de referência?',partial,'dinheiro certo, sem troco');
assert.equal(r,'Qual ponto de referência?');
assert.equal(reply('Qual o bairro?',history,'perto do mercado'),'Qual o bairro?','informação faltante não é apagada por palpite');
assert.equal(reply('Pix, cartão ou dinheiro?',[bot('Como vai pagar?')],'Pix'),'Certo.','fallback real não afirma ação anotada nem acrescenta emoji');

for(const guard of ['falhaDaIa','donoNaQueda','callHuman','ehODono'])assert.equal(reply(raw,history,'é entrega',{[guard]:true}),raw,`guarda ${guard} preservada`);
assert.equal(reply(raw,history,'é entrega',{chatbotConfig:{}}),baseline,'outros modelos mantêm a limpeza antiga');

// A limpeza acontece no webhook DEPOIS da resposta/sync, não no JSON original.
const ai=readFileSync('src/lib/chatbot-ai.ts','utf8');
assert.ok(ai.indexOf('const textoOriginalDoModelo = generatedText')<ai.indexOf('JSON.parse(rawJsonPayload)'));
assert.ok(source.indexOf('const aiResponse = await processChatbotAI')<source.indexOf(block.getText(ast)) || source.indexOf('await processChatbotAI')<source.indexOf(block.getText(ast)));
assert.ok(ai.includes('[[CHAMAR_ATENDENTE]]')&&ai.includes('payloadQueriaFinalizar'));
console.log(JSON.stringify({ok:true,antes:baseline,depois:after,checagens:'webhook real; conversa parcial, pagamento/troco, foco em um próximo dado, guardas, nomes, JSON/tags/URLs e Unicode compostos'}));
