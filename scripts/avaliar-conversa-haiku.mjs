/** Rodada manual limitada: cinco continuações sintéticas, antes/depois, sem gravar pedidos.
 * Usa as regras e o adapter reais; não é uma reprodução integral do contexto de uma loja.
 * Sem --executar apenas prepara prompts. Máximo 10 chamadas, zero retries, sem fallback.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

const base = process.cwd();
// A comparação continua reproduzível depois de criar o commit do candidato.
const baselineCommit = 'a7f877839e5763cb99323114e8a4040dfad027f6';
const source = (file, before=false) => before ? execFileSync('git',['show',`${baselineCommit}:${file}`],{cwd:base,encoding:'utf8'}) : readFileSync(file,'utf8');
const parse = (text) => ts.createSourceFile('source.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const find = (text,predicate) => { let result; const ast=parse(text); const visit=n=>{if(!result&&predicate(n,ast))result=n;ts.forEachChild(n,visit)};visit(ast);if(!result)throw new Error('Declaração não encontrada');return result.getText(ast); };
const compile = text => ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const evaluate = text => {const e={};new Function('exports',compile(text))(e);return e;};
const model = evaluate(find(source('src/lib/robo-no-claude.ts'),n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText()==='MODELO_CLAUDE'))).MODELO_CLAUDE;
const adapter = find(source('src/lib/robo-no-claude.ts'),n=>ts.isFunctionDeclaration(n)&&n.name?.text==='respostaDoClaude');
const ctx = {
  storeLink:'https://example.test/cardapio',cardapioArquivoUrl:null,temCupomParaCitar:false,
  regraDoPrazo:'Prazo não informado: não invente.',diaDeHoje:'Segunda-feira',codigoDoDia:'SEG',diaDeAmanha:'Terça-feira',
  lojaFisica:true,enderecoDaLoja:'Rua da Loja, 1',fazReservaDeMesa:false,modoDaArea:'BAIRRO',ehRota:false,
  regraDoPix:'Não há chave Pix cadastrada: não invente chave.',anotaPedido:true,notaFiscal:null,
  regraDoMinimo:'A) PEDIDO MÍNIMO: não há mínimo.',lembreteDoMinimo:''
};
const catalogue = `DADOS DA LOJA SINTÉTICA: Lanche Teste. Aberta hoje. Aceita entrega e retirada; Pix, cartão e dinheiro.
CARDÁPIO CADASTRADO: X-Salada (R$ 20,00); X-Bacon (R$ 25,00); X-Frango (R$ 28,00). Todos disponíveis. Categoria: Hambúrgueres. Sem escolhas obrigatórias.
PROMOÇÕES DE HOJE: nenhuma. CUPONS: nenhum. ÁREA DE ENTREGA: Centro, taxa R$ 3,00. Não há outras áreas cadastradas.
Nenhum prazo de entrega cadastrado. Não há pedido final já gravado nesta conversa.`;
const user = text=>({role:'user',parts:[{text}]});
const bot = text=>({role:'model',parts:[{text}]});
const cart = [{name:'X-Salada',quantity:1,notes:''},{name:'X-Bacon',quantity:1,notes:'sem cebola'}];
const common = [user('quero dois hambúrgueres'),bot('Temos X-Salada por R$ 20 e X-Bacon por R$ 25. Quais você quer?')];
const chosen = [...common,user('um X-Salada'),user('e um X-Bacon, o segundo sem cebola'),bot('Vai ser entrega ou retirada?')];
const address = [...chosen,user('entrega, Rua A 20, Centro'),bot('Vai pagar por Pix, cartão ou dinheiro?')];
const cases = [
  {id:'quantidade-categoria-fragmentada',name:'',history:[bot('Oi! O que você gostaria de pedir?')],current:['quero dois','hambúrgueres'],stage:'escolher',memory:'Intenção parcial: quantidade 2, categoria hambúrgueres; nenhum produto escolhido.'},
  {id:'escolhas-parciais-observacao',name:'',history:common,current:['um X-Salada','e um X-Bacon, o segundo sem cebola'],stage:'entrega',memory:'Intenção anterior: dois hambúrgueres. Ainda sem endereço, pagamento ou nome.'},
  {id:'somente-pagamento-faltante',name:'Ana',history:chosen,current:['entrega, Rua A 20, Centro'],stage:'pagamento',memory:`Rascunho canônico ainda não finalizado: ${JSON.stringify({items:cart,customerName:'Ana',address:'Rua A 20',neighborhood:'Centro',deliveryType:'ENTREGA',deliveryFee:3,totalAmount:48})}`},
  {id:'confirmacao-com-marca-final',name:'Ana',history:[...address,user('Pix'),bot('1 X-Salada R$ 20; 1 X-Bacon sem cebola R$ 25. Entrega Rua A 20, Centro, taxa R$ 3. Total R$ 48, no Pix. Confirma?')],current:['pode fechar'],stage:'final',memory:`Rascunho canônico aguardando confirmação: ${JSON.stringify({items:cart,customerName:'Ana',address:'Rua A 20',neighborhood:'Centro',deliveryType:'ENTREGA',paymentMethod:'PIX',deliveryFee:3,totalAmount:48})}`},
  {id:'um-de-cada-ambiguo-dois-tres',name:'',history:[user('quero dois hambúrgueres'),bot('Temos X-Salada por R$ 20, X-Bacon por R$ 25 e X-Frango por R$ 28. Quais você quer?')],current:['um de cada'],stage:'quantidade',memory:'Quantidade solicitada anteriormente: 2. Três opções foram oferecidas; ainda sem itens escolhidos.'}
];
const variants = ['antes','depois'].map(label=>{
  const before=label==='antes';
  const robotSource=source('src/lib/regras-do-robo.ts',before);
  const robot=evaluate(robotSource).regrasDoRobo;
  const claude=evaluate(source('src/lib/regras-do-claude.ts',before)).REGRAS_DO_CLAUDE;
  const ai=source('src/lib/chatbot-ai.ts',before);
  const personality=find(ai,n=>ts.isVariableDeclaration(n)&&n.name.getText()==='personalityMap');
  const personalityNode=parse('const '+personality+';');
  const init=personalityNode.statements[0].declarationList.declarations[0].initializer.getText(personalityNode);
  const personalities=new Function(`return (${init})`)();
  const nameRule=find(ai,n=>ts.isConditionalExpression(n)&&n.condition.getText()==='customerFirstName');
  const nameText=new Function('customerFirstName',`return (${nameRule});`);
  return {label,claude,system:`Você responde pelo WhatsApp da Lanche Teste.\n${robot({...ctx,personalidade:personalities.SIMPATICO})}\n${catalogue}`,nameText,sourceHash:createHash('sha256').update(robotSource+claude+ai).digest('hex')};
});
const {enxugarResposta}=evaluate(source('src/lib/resposta-enxuta.ts'));
const makeContents=(c,v)=>[user(`CONTEXTO DESTA CONVERSA (montado pelo sistema):\n${v.nameText(c.name)}\n${c.memory}`),bot('Entendido.'),...c.history,...c.current.map(user)];
const compact=process.argv.includes('--revalidar-compactacao');
const selectedCases=compact?cases.filter(c=>['escolhas-parciais-observacao','somente-pagamento-faltante'].includes(c.id)):cases;
const maxCalls=compact?4:10;
const output=process.env.HAIKU_EVAL_OUTPUT||path.resolve(base,compact?'work/avaliacao-haiku-compacto-2026-11-09.json':'work/avaliacao-haiku-conversa-2026-11-09.json');
mkdirSync(path.dirname(output),{recursive:true});
const report={createdAt:new Date().toISOString(),baseCommit:baselineCommit,model,settings:'adapter real, max_tokens=8000, cache ephemeral, sem temperature/effort override, maxRetries=0',limits:`Máximo ${maxCalls} chamadas; uma rodada, sem repetição, dados sintéticos, sem gravação/backend. Mede continuações com histórico fixo, não uma conversa integral em produção.`,status:'preparado',calls:0,results:[],prompts:variants.map(v=>({variant:v.label,sourceHash:v.sourceHash,system:v.system+'\n\n'+v.claude}))};
function assess(c,raw) {
  const marker=raw.match(/\[\[\s*PEDIDO_IA\s*:\s*([\s\S]*?)\]\]/i); let order=null,invalidJson=false;
  if(marker)try{order=JSON.parse(marker[1])}catch{invalidJson=true}
  const visible=raw.replace(/\[\[[\s\S]*?\]\]/g,'').trim();
  const items=order?.items||[];
  const qty=items.reduce((n,i)=>n+Number(i.quantity||0),0);
  const functional={invalidJson,finalized:Boolean(order?.finalized),itemQuantity:qty,canonicalNames:items.every(i=>['X-Salada','X-Bacon','X-Frango'].includes(i.name)),hasNote:items.some(i=>i.name==='X-Bacon'&&/sem cebola/i.test(i.notes||'')),tag:!!marker};
  const checks={};
  if(c.stage==='escolher'){checks.offersRealOptions=/X-Salada|X-Bacon|X-Frango/i.test(visible);checks.noPrematureAddress=!/endere[cç]o|bairro|forma de pagamento|como vai pagar/i.test(visible);checks.noSelectedItems=items.length===0;}
  if(c.stage==='entrega'){checks.twoSelectedItems=qty===2;checks.notePreserved=functional.hasNote;checks.notFinalized=!order?.finalized;}
  if(c.stage==='pagamento'){checks.asksPayment=/pix|pagamento|pagar|cart[aã]o|dinheiro/i.test(visible);checks.noRepeatedAddressOrName=!/(?:qual|me passa|mande|informe)[^?\n]*(?:endere[cç]o|bairro|nome)/i.test(visible);checks.notFinalized=!order?.finalized;}
  if(c.stage==='final'){checks.finalTag=!!order?.finalized;checks.twoSelectedItems=qty===2;checks.notePreserved=functional.hasNote;checks.totalCorrect=Number(order?.totalAmount)===48;}
  if(c.stage==='quantidade'){checks.clarifiesQuantity=/\?/.test(visible)&&/dois|tr[eê]s|\b2\b|\b3\b|quantidade/i.test(visible);checks.noSilentQuantityChange=items.length===0;}
  return {visible,order,functional,checks,style:{faceGestureCount:(visible.match(/[👋😊🥰👏😅😉😕😖😍😋🙏👍🙌🤗]/gu)||[]).length,pictographicCodepoints:(visible.match(/\p{Extended_Pictographic}/gu)||[]).length,repeatedGreeting:/^(?:oi|ol[aá]|bom dia|boa tarde|boa noite)[!. ,]/iu.test(visible),questionMarks:(visible.match(/\?/g)||[]).length,characters:visible.length}};
}
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');save();
if(!process.argv.includes('--executar')){console.log(JSON.stringify({status:report.status,model,calls:0,output}));process.exit(0)}
dotenv.config({path:'C:/Users/Micro/Documents/firehub-site/.env',quiet:true});
dotenv.config({path:'C:/Users/Micro/Documents/firehub-site/.env.local',quiet:true,override:true});
let key=process.env.ANTHROPIC_API_KEY;
if(!key){
  const {PrismaClient}=await import('@prisma/client'); const prisma=new PrismaClient();
  try{const matrix=await prisma.user.findFirst({where:{isFireHubSystem:true},select:{chatbotConfig:true}});key=matrix?.chatbotConfig?.anthropicApiKey;}finally{await prisma.$disconnect()}
}
if(!key){report.status='bloqueado-sem-chave';save();console.log(JSON.stringify({status:report.status,calls:0,output}));process.exit(2)}
const sdk=new Anthropic({apiKey:key,maxRetries:0});
report.status='executando';save();
outer:for(const c of selectedCases)for(const v of variants){
  if(report.calls>=maxCalls)throw new Error('Limite de chamadas');
  const apiExports={};
  new Function('exports','MODELO_CLAUDE','REGRAS_DO_CLAUDE','claude','transcrever',compile(adapter))(apiExports,model,v.claude,()=>sdk,()=>{throw new Error('Áudio fora do escopo')});
  report.calls++;save();const start=Date.now();
  try{
    const response=await apiExports.respostaDoClaude({contents:makeContents(c,v),systemInstruction:v.system,signal:AbortSignal.timeout(45000),chave:key,geminiApiKey:''});
    const evaluation=assess(c,response.text);
    const filtered=enxugarResposta(evaluation.visible,{historico:c.history.map(m=>({sender:m.role==='model'?'bot':'user',text:m.parts.map(p=>p.text).join('\n')})),mensagemDoCliente:c.current.join('\n'),tomNatural:v.label==='depois'});
    report.results.push({scenario:c.id,variant:v.label,milliseconds:Date.now()-start,current:c.current,history:c.history,raw:response.text,usage:response.usageMetadata,emptyReason:response.motivoSemTexto||null,...evaluation,afterExistingPipeline:filtered});save();
    console.log(JSON.stringify({completed:report.calls,scenario:c.id,variant:v.label,checks:evaluation.checks,milliseconds:Date.now()-start}));
  }catch(error){report.status='interrompido-sem-retry';report.error={name:error?.name,status:error?.status||null,call:report.calls};save();console.log(JSON.stringify({status:report.status,...report.error,output}));break outer;}
}
if(report.status==='executando')report.status='concluido';report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,calls:report.calls,output}));
