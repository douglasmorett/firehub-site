/**
 * Prova do classificador de falha da IA (lib/falha-da-ia.ts).
 *
 *   node scripts/teste-falha-da-ia.mjs
 *
 * As mensagens são as que a API do Gemini devolveu de verdade: o 429 de crédito
 * esgotado de 29/08 e de 13–18/09/2026 (medido contra a chave de produção em
 * 18/09), e o 404 de modelo aposentado de 23/08.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/falha-da-ia.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = await import("data:text/javascript," + encodeURIComponent(js));
const { classificarFalhaDaIa, falhaQueManda, mensagemDeIaForaDoAr, alertaDeIaForaDoArParaALoja, alertaDeIaForaDoArParaOAdmin, podeAlertarAgora } = m;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};
const tipo = (e) => classificarFalhaDaIa(e).tipo;
const igual = (nome, obtido, esperado) => conferir(nome, obtido === esperado, `obtido ${obtido}, esperado ${esperado}`);

console.log("\n1) O que a produção respondeu");
const SEM_CREDITO = '{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}';
igual("429 de crédito esgotado (13–18/09)", tipo(SEM_CREDITO), "sem_credito");
conferir("crédito esgotado exige ação e é do sistema", classificarFalhaDaIa(SEM_CREDITO).exigeAcao && classificarFalhaDaIa(SEM_CREDITO).doSistema);
igual("429 de cota comum NÃO é crédito", tipo('{"error":{"code":429,"message":"Quota exceeded for quota metric generate_content requests per minute","status":"RESOURCE_EXHAUSTED"}}'), "limite_de_uso");
conferir("cota comum não exige ação (volta sozinha)", classificarFalhaDaIa("429 Too Many Requests").exigeAcao === false);
// A mensagem REAL do 429 de limite por minuto fala em "billing" — e era lida como crédito esgotado.
const COTA_REAL = '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. Please retry in 34s.","status":"RESOURCE_EXHAUSTED"}}';
igual("429 de cota REAL ('check your plan and billing details') é limite de uso", tipo(COTA_REAL), "limite_de_uso");
conferir("e não é incidente na primeira", classificarFalhaDaIa(COTA_REAL).exigeAcao === false);
igual("faturamento DESLIGADO é sem crédito", tipo("Billing account is disabled for this project"), "sem_credito");
// ApiError do SDK @google/genai: .status numérico e .message com o JSON do Google.
igual("ApiError do SDK com status 429 e JSON de crédito", tipo(Object.assign(new Error(SEM_CREDITO), { name: "ApiError", status: 429 })), "sem_credito");
igual("modelo aposentado (23/08)", tipo('{"error":{"code":404,"message":"models/gemini-1.5-flash is not found for API version v1beta, or is not supported for generateContent","status":"NOT_FOUND"}}'), "modelo_indisponivel");
igual("'no longer available'", tipo("This model is no longer available"), "modelo_indisponivel");
igual("chave inválida", tipo('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'), "chave_invalida");
igual("chave vazada e bloqueada", tipo("Your API key was reported as leaked. Please use another API key."), "chave_invalida");
igual("403 sem permissão", tipo('{"error":{"code":403,"status":"PERMISSION_DENIED"}}'), "chave_invalida");
igual("AbortError do timeout do robô", tipo(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })), "timeout");
igual("503 sobrecarregado", tipo('{"error":{"code":503,"message":"The model is overloaded. Please try again later.","status":"UNAVAILABLE"}}'), "instavel");
igual("rede", tipo(new Error("fetch failed")), "instavel");
igual("sem chave cadastrada", tipo("sem_chave"), "sem_chave");
igual("bloqueio de segurança", tipo("finish_reason SAFETY"), "resposta_vazia");
igual("erro vazio", tipo(null), "desconhecida");
igual("erro que ninguém conhece", tipo(new Error("algo muito estranho")), "desconhecida");

console.log("\n2) Qual falha manda quando cada modelo falha de um jeito");
const manda = falhaQueManda([classificarFalhaDaIa(new Error("aborted")), classificarFalhaDaIa(SEM_CREDITO)]);
igual("timeout + sem crédito = sem crédito", manda.tipo, "sem_credito");
igual("só passageiras = a primeira", falhaQueManda([classificarFalhaDaIa("503"), classificarFalhaDaIa("aborted")]).tipo, "instavel");
igual("lista vazia = null", falhaQueManda([]), null);
const M404 = classificarFalhaDaIa('{"error":{"code":404,"status":"NOT_FOUND","message":"models/x is not found"}}');
igual("modelo aposentado + timeout no modelo bom = soluço, não incidente", falhaQueManda([M404, classificarFalhaDaIa(new Error("aborted"))]).tipo, "timeout");
igual("TODOS aposentados = modelo indisponível", falhaQueManda([M404, M404]).tipo, "modelo_indisponivel");
igual("modelo aposentado + sem crédito = sem crédito", falhaQueManda([M404, classificarFalhaDaIa(SEM_CREDITO)]).tipo, "sem_credito");

console.log("\n3) O que cada um lê");
const cliente = mensagemDeIaForaDoAr({ primeiroNome: "Bianca", linkDoCardapio: "https://firehubfood.com.br/loja/hakim" });
conferir("cliente: diz que uma pessoa vai responder", /uma pessoa vai te responder/i.test(cliente), cliente);
conferir("cliente: NÃO fala de status de pedido nem de motoboy", !/pedido .*(saiu|prepara|entreg)|motoboy/i.test(cliente), cliente);
conferir("cliente: não vaza detalhe técnico", !/gemini|cr[eé]dito|429|chave|api/i.test(cliente), cliente);
conferir("cliente: sem link não inventa link", !/card[aá]pio/i.test(mensagemDeIaForaDoAr({})));
const f = classificarFalhaDaIa(SEM_CREDITO);
const loja = alertaDeIaForaDoArParaALoja({ falha: f, nomeDoCliente: "Bianca", telefone: "21999997320", mensagemDoCliente: "quero falar com alguém" });
conferir("loja: avisa que não volta sozinho", /N[ÃA]O volta sozinho/.test(loja), loja);
conferir("loja: traz a mensagem do cliente", /quero falar com algu/.test(loja), loja);
const lojaSemTransferir = alertaDeIaForaDoArParaALoja({ falha: f, nomeDoCliente: "Bianca", telefone: "21999997320", mensagemDoCliente: "cadê meu pedido?", transferido: false });
conferir("loja: quem só recebeu status NÃO é citado como 'esperando uma pessoa'", !/Bianca/.test(lojaSemTransferir) && !/esperando uma pessoa/.test(lojaSemTransferir), lojaSemTransferir);
const dono = m.mensagemDeIaForaDoArParaODono(f);
conferir("dono: não lê 'já avisei a equipe' (a equipe é ele)", !/avisei/i.test(dono) && /fora do ar/i.test(dono), dono);
const admin = alertaDeIaForaDoArParaOAdmin({ falha: f, loja: "Hakim Centro", quando: "18/09 18:30" });
conferir("admin: manda recarregar no AI Studio", /ai\.studio\/projects/.test(admin), admin);
conferir("admin: diz que são TODAS as lojas", /TODAS as lojas/.test(admin), admin);
conferir("nenhum texto contém chave de API", ![cliente, loja, admin].some((t) => /AIza[0-9A-Za-z_-]{20,}/.test(t)));

console.log("\n4) Freio de alerta");
const estado = new Map();
conferir("primeiro alerta passa", podeAlertarAgora(estado, "admin", 1_000_000, 3_600_000) === true);
conferir("segundo, 10 min depois, não passa", podeAlertarAgora(estado, "admin", 1_000_000 + 600_000, 3_600_000) === false);
conferir("outra chave passa", podeAlertarAgora(estado, "loja:1", 1_000_000 + 600_000, 3_600_000) === true);
conferir("depois da janela passa de novo", podeAlertarAgora(estado, "admin", 1_000_000 + 3_600_001, 3_600_000) === true);

console.log("\n5) Soluço não é incidente; repetição é");
const { virouIncidente, mensagemDeInstabilidadePassageira } = m;
const porLoja = new Map();
const passageira = classificarFalhaDaIa(new Error("aborted"));
conferir("1º timeout da loja: não é incidente", virouIncidente(porLoja, "loja1", passageira, 0) === false);
conferir("2º timeout, 1 min depois: ainda não", virouIncidente(porLoja, "loja1", passageira, 60_000) === false);
conferir("3º timeout em 10 min: incidente", virouIncidente(porLoja, "loja1", passageira, 120_000) === true);
conferir("outra loja começa do zero", virouIncidente(porLoja, "loja2", passageira, 120_000) === false);
conferir("falhas antigas saem da janela", virouIncidente(new Map([["l", [0, 1000]]]), "l", passageira, 20 * 60_000) === false);
conferir("crédito esgotado é incidente na PRIMEIRA", virouIncidente(new Map(), "loja3", f, 0) === true);
const soluco = mensagemDeInstabilidadePassageira({ primeiroNome: "Ana", linkDoCardapio: "https://x/loja/y" });
conferir("soluço: pede para repetir, não promete pessoa", /mandar de novo/i.test(soluco) && !/uma pessoa vai/i.test(soluco), soluco);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
