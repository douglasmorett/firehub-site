/**
 * Prova do detector de "quero falar com uma pessoa" (lib/pedido-de-atendente.ts).
 *
 *   node scripts/teste-pedido-de-atendente.mjs
 *
 * O caso que o originou: Hakim, 18/09/2026 — cliente de retirada pediu uma
 * pessoa, a regex antiga não casou e o robô respondeu status de entrega.
 *
 * O bloco 3 é o que mais importa: casar cala o robô por 12 horas e alerta o
 * dono. As frases vieram de uma revisão adversarial com 180 mensagens reais de
 * cliente de lanchonete; a primeira versão do detector errava 40 delas.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/pedido-de-atendente.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { detectarPedidoDeAtendente } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
let total = 0;
const conferir = (frase, esperado) => {
  total++;
  const r = detectarPedidoDeAtendente(frase);
  if (r.pediu === esperado) {
    if (process.argv.includes("-v")) console.log(`  ok    ${esperado ? "PEDE" : "nao "} "${frase.slice(0, 80)}"${r.gatilho ? "  <- " + r.gatilho : ""}`);
    return;
  }
  falhas++;
  console.log(`  FALHA "${frase.slice(0, 100)}" — obtido ${r.pediu}${r.gatilho ? " (" + r.gatilho + ")" : ""}, esperado ${esperado}`);
};

console.log("\n1) O que a regex antiga já pegava — não pode regredir");
for (const f of [
  "quero falar com atendente", "Atendente", "atendimento humano por favor", "HUMANO",
  "quero falar com pessoa", "falar com gente", "suporte", "falar com atendente", "atendimento humano",
]) conferir(f, true);

console.log("\n2) Pedido de pessoa que passava direto para a IA");
for (const f of [
  "quero falar com alguém", "Quero falar com alguem da loja", "posso falar com uma pessoa?",
  "preciso falar com o responsável", "quero falar com o gerente", "me chama o dono", "chama alguém pra mim",
  "chama uma pessoa aí", "passa pra um atendente", "transfere para uma pessoa", "quero uma pessoa de verdade",
  "tem como falar com gente de verdade?", "não quero falar com robô", "nao quero conversar com maquina",
  "chega de robô", "quero falar com um ser humano", "preciso falar com o motoboy", "quero falar c/ alguem",
  "queria falar com alguém sobre meu pedido", "prefiro falar com uma pessoa",
  // erros de digitação reais — o relato do dono dizia "falar com humado"
  "quero falar com humado", "umano", "quero um atendete", "antendente por favor", "atendenti", "atendemte", "atemdente",
  "kero falar com um umano",
  // escrita de WhatsApp
  "qro falar c alguem", "falar c alguem", "quero falar com algm", "quero falar cm alguem",
  "tem como uma pessoa me atender?", "quero ser atendido por uma pessoa", "quero ser atendida por gente",
  "quero falar com a moça", "quero falar com o rapaz do balcão", "me passa pra alguém", "me passa para alguém da loja",
  "isso é robô? me passa pra alguém", "tem alguem real ai?", "preciso falar com alguem urgente", "quero conversar com o dono",
  "cade o gerente", "cadê o responsável?", "quero o gerente", "quero o responsável", "chama o gerente",
  "me chama o responsável agora", "nao quero robo", "odeio robo", "sai robô, quero gente", "quero falar com humano",
  "falar com alguém da equipe", "quero falar com uma atendente", "quero reclamar com o gerente", "quero resolver isso com alguém",
  "pode me transferir pra um atendente?", "me transfere", "transfere pra alguem", "posso falar com alguém que não seja robô?",
  "quero falar com a pessoa responsável", "fala serio, chama alguem ai", "bot burro, chama alguem",
  "eu queria falar com alguém aí da loja por favor", "então eu queria era falar com uma pessoa mesmo sabe não com o robô",
  "para de mandar mensagem automática, quero gente", "quero uma pessoa",
  // a bronca NÃO desliga o detector (a exceção de "brincadeira" fazia isso)
  "que brincadeira é essa, 2 horas esperando, me chama o gerente",
  "vocês estão de brincadeira comigo? quero falar com um atendente",
  "isso só pode ser brincadeira. quero falar com o dono",
  // elogio à atendente não anula o pedido que vem depois
  "a atendente foi ótima ontem mas hoje quero falar com o gerente",
]) conferir(f, true);

console.log("\n3) Tem as palavras, NÃO tem a intenção — o robô continua atendendo");
for (const f of [
  // saudação e atendimento que o robô faz
  "tem alguém aí?", "alguém pode me ajudar?", "oi, alguém?", "alguém?", "oi tem gente?", "boa noite gente", "obrigado pessoal",
  "qual o horário de atendimento?", "vocês atendem até que horas?", "atende no centro?", "quero pedir", "boa noite", "",
  "cadê meu pedido?", "vocês entregam no centro?", "eu quero é comer kkk", "tem ia ai? kk",
  // pedido
  "pizza para 4 pessoas", "é pra 3 pessoas", "serve quantas pessoas?", "umas 3 pessoas", "quero uma pizza grande",
  "a gente quer 2 pizzas grandes", "coloca pra gente 2 cocas", "bota pra gente mais um guaraná", "passa pra gente o cardápio",
  "passa pra gente a chave pix", "manda pra gente o cardapio", "quero um x-tudo sem cebola", "pizza do chefe tem?",
  "quero a pizza do chefe", "hamburguer da casa", "coloca uma pessoa a mais no pedido, vai ser 5 marmitas",
  "quero 2 x-bacon e uma coca 2l", "bota bastante molho", "passa o cartão na entrega", "calabresa defumada tem?", "bacon defumado",
  "uma das pizzas veio fria", "um amado meu indicou vocês",
  // instrução de entrega — o falso positivo mais caro
  "fala pro entregador tocar o interfone", "fala com o entregador pra tocar o interfone", "fala com o motoboy que o portão é azul",
  "passa pro motoboy que é casa 2 fundos", "passa pro entregador que o troco é pra 50", "avisa o motoboy que a campainha ta quebrada",
  "quando chegar chama a gente no portão", "pede pro motoboy chamar alguém na portaria", "o motoboy pode chamar alguem na portaria",
  "chama a dona Maria na recepção", "pede pro entregador chamar a dona Lurdes", "pode falar com o dono da casa, seu Zé",
  "é só falar com o funcionário da portaria", "chama o funcionario da portaria que ele recebe", "falar com a gente na guarita",
  "tem alguém em casa pra receber", "pode entregar, tem alguém na portaria", "tem uma pessoa esperando no portão",
  "minha filha vai receber, é a pessoa de blusa vermelha", "entrega pro gerente do posto ipiranga", "pode deixar com o chefe da obra",
  "deixa com alguém na portaria", "se eu não atender chama alguém do bloco B", "o entregador já saiu?", "cade o motoboy?",
  "o motoboy ta vindo?", "motoboy chegou, obrigado", "manda o motoboy trazer troco pra 100",
  "fala com a gente quando sair pra entrega", "pode conversar com a pessoa que atender o interfone", "paga com a pessoa que receber",
  "transfere pro motoboy o valor? não né kk", "me chama quando sair", "me chama quando o pedido ficar pronto",
  "chama eu quando sair pra entrega", "chama no zap", "preciso de alguem pra receber la embaixo",
  "preciso de alguém aqui embaixo pra abrir o portão não, pode subir",
  // endereço
  "rua dos humanos 120", "Rua Humaitá 45 apto 12", "avenida direitos humanos 300",
  // pagamento
  "vou pagar em dinheiro, não quero a máquina", "não quero maquina, vou pagar no pix", "nao quero a maquina de cartao",
  "leva a maquininha", "passa o pix", "para de maquina, vou no dinheiro", "precisa de troco pra 50",
  "não quero ia dar trabalho", "nao quero a ia... digo, a pizza de atum",
  // palavras soltas em outro sentido
  "vocês tem suporte pra levar 4 copos?", "veio sem o suporte dos copos", "to sem suporte de celular aqui kk pera",
  "a atendente disse que entregava em 40 min", "falei com a atendente agora pouco e ela confirmou",
  "sou atendente da farmacia aqui do lado, queria 3 marmitas", "o atendente foi ótimo ontem",
  "vocês estão contratando atendente?", "quero trabalhar ai, precisa de atendente?",
  "gente que demora", "a gente ta esperando faz 1 hora", "quero gente boa igual vcs kkk", "minha dona mandou pedir",
  "sou o dono da barbearia aqui da frente", "vou falar com meu chefe e ja peço", "vou conversar com a gente aqui e ja te falo",
  "deixa eu falar com o pessoal aqui", "vou falar com a pessoa que vai pagar e ja volto", "deixa eu conversar com a pessoa aqui do lado",
  "to resolvendo com o motoboy aqui, ele ja chegou", "pode resolver com o entregador o troco",
  "manda pra uma pessoa que mora comigo", "quero uma pessoa que entregue rápido", "o supervisor da minha empresa vai pagar",
  "passa a gente na frente ai pfv kkk", "bota a gente na frente", "coloca a gente na fila", "queria alguem que soubesse explicar kkk deixa",
  // brincadeira declarada
  "pode chamar o motoboy de volta? brincadeira, quero uma coca",
  // o texto-marcador que o webhook põe no lugar do áudio
  "O cliente enviou a mensagem de áudio em anexo. Por favor escute o áudio com atenção, entenda o pedido ou dúvida do cliente e responda no mesmo tom carinhoso e prestativo do cardápio.",
]) conferir(f, false);

console.log(`\n${total} frases.`);
console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
