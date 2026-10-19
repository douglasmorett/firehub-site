/**
 * scripts/teste-meu-aplicativo.ts — as regras da tela Meu aplicativo
 * (lib/app-da-loja/regras-do-push.ts), sem banco e sem rede.
 *
 *   DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-meu-aplicativo.ts
 */
import {
  ATIVO_AGORA_MS,
  AVISAR_A_PARTIR_DE,
  caminhoDoAviso,
  conferirAgendamento,
  conferirComposicao,
  contarBase,
  emLotesDe,
  enviosNoDia,
  juntarBase,
  lerRecibos,
  lerTickets,
  tokensDoPublico,
  type AparelhoDaAbertura,
  type AparelhoDePedido,
} from "../src/lib/app-da-loja/regras-do-push";
import { caminhoValido } from "../apps/loja/src/lib/abrir-no-cardapio";

let falhas = 0;
let total = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`);
};

const agora = new Date("2026-10-17T22:00:00Z");
const min = (n: number) => new Date(agora.getTime() - n * 60_000);
const dias = (n: number) => new Date(agora.getTime() - n * 86_400_000);
const T = (n: number) => `ExponentPushToken[aaaaaaaaaaaaaaaaaaaa${n}]`;

const aberturas: AparelhoDaAbertura[] = [
  // aberto agora (batida de 4 min atrás), aceitou promoção, com token
  { instalacaoId: "inst-1", pushToken: T(1), primeiroAcesso: dias(40), ultimoAcesso: min(4), promocoes: true, removidoEm: null },
  // abriu há 6 min: não está "agora"; aceitou mas SEM token (negou a permissão do sistema)
  { instalacaoId: "inst-2", pushToken: null, primeiroAcesso: dias(2), ultimoAcesso: min(6), promocoes: true, removidoEm: null },
  // abriu há 20 dias, recusou promoção
  { instalacaoId: "inst-3", pushToken: T(3), primeiroAcesso: dias(20), ultimoAcesso: dias(20), promocoes: false, removidoEm: null },
  // desinstalou (Expo disse DeviceNotRegistered) — o token dele também estava num pedido
  { instalacaoId: "inst-4", pushToken: T(4), primeiroAcesso: dias(10), ultimoAcesso: dias(9), promocoes: true, removidoEm: dias(1) },
  // abriu há 45 dias, aceitou promoção
  { instalacaoId: "inst-5", pushToken: T(5), primeiroAcesso: dias(60), ultimoAcesso: dias(45), promocoes: true, removidoEm: null },
];
const pedidos: AparelhoDePedido[] = [
  // o mesmo celular da inst-1: não pode virar dois; o primeiro pedido é mais antigo que a instalação nova
  { pushToken: T(1), primeiroPedido: dias(90), ultimoPedido: dias(3) },
  // só por pedido (versão velha do app): pediu há 3 dias, primeiro pedido neste mês
  { pushToken: T(6), primeiroPedido: dias(3), ultimoPedido: dias(3) },
  // o token do desinstalado não volta pela porta de PedidoAparelho
  { pushToken: T(4), primeiroPedido: dias(9), ultimoPedido: dias(9) },
];

// ── A base sem repetir ──────────────────────────────────────────────────────
const base = juntarBase(aberturas, pedidos);
confere("base: 4 instalações + 1 só de pedido, sem o desinstalado e sem repetir o token", base.length, 5);
confere("token em pedido e em instalação = um aparelho, com a data mais antiga", base.find((b) => b.chave === "i:inst-1")?.primeiro.toISOString(), dias(90).toISOString());
confere("só de pedido não recebe promoção (não respondeu a pergunta)", base.find((b) => b.chave === `t:${T(6)}`)?.promocoes, false);
confere("aceitou promoção mas sem token: não conta como alcançável", base.find((b) => b.chave === "i:inst-2")?.promocoes, false);

// ── Contagem ────────────────────────────────────────────────────────────────
const marcos = { agora, inicio7: dias(7), inicio30: dias(30), inicioDoMes: new Date("2026-10-01T08:00:00Z") };
const c = contarBase(base, marcos);
confere("ativos agora: só quem avisou abertura nos últimos 5 min (4 min sim, 6 min não)", c.ativosAgora, 1);
confere("ativos agora no limite exato de 5 min conta", contarBase([{ ...base[0], ultimaAbertura: new Date(agora.getTime() - ATIVO_AGORA_MS), ultimo: agora }], marcos).ativosAgora, 1);
confere("aparelho só de pedido nunca é 'ativo agora'", contarBase([{ ...base.find((b) => !b.abriuApp)!, ultimo: agora }], marcos).ativosAgora, 0);
confere("ativos 7 dias: inst-1, inst-2 e o do pedido de 3 dias", c.ativos7, 3);
confere("ativos 30 dias: + inst-3 (20 dias)", c.ativos30, 4);
confere("novos no mês: inst-2 e o do pedido de 3 dias", c.novosNoMes, 2);
confere("recebem notificação: inst-1 e inst-5 (token + termo aceito)", c.recebemNotificacao, 2);
confere("não permitiram no celular: inst-2 (abriu, sem token)", c.semPermissao, 1);
confere("com token mas ainda sem o termo: inst-3", c.aguardandoTermo, 1);
confere("versão antiga (só pedido): fica de fora da promoção", c.versaoAntiga, 1);
const desligou = contarBase(juntarBase([{ ...aberturas[2], promocoesRespondidoEm: dias(1) }], []), marcos);
confere("token, promoção desligada e respondeu: desligaram as promoções", [desligou.desligaramPromocoes, desligou.aguardandoTermo], [1, 0]);

// ── Público ─────────────────────────────────────────────────────────────────
confere("público todos = quem aceitou e tem token", tokensDoPublico(base, "todos", marcos.inicio30).sort(), [T(1), T(5)]);
confere("público ativos 30 dias tira quem não abre há 45 dias", tokensDoPublico(base, "ativos30", marcos.inicio30), [T(1)]);
const repetido = juntarBase([...aberturas, { ...aberturas[0], instalacaoId: "inst-1b" }], []);
confere("o mesmo token duas vezes sai uma vez só no envio", tokensDoPublico(repetido, "todos", marcos.inicio30).filter((t) => t === T(1)).length, 1);

// ── Envios no dia (sem limite; aviso a partir do 3º) ─────────────────────────
confere("aviso a partir do 3º envio do dia", AVISAR_A_PARTIR_DE, 3);
confere("conta os do dia, sem cancelado nem falho", enviosNoDia([
  { dia: "2026-10-17", status: "ENVIADO" }, { dia: "2026-10-17", status: "AGENDADO" },
  { dia: "2026-10-17", status: "CANCELADO" }, { dia: "2026-10-17", status: "FALHOU" }, { dia: "2026-10-18", status: "ENVIADO" },
], "2026-10-17"), 2);

// ── Lotes de 100 ────────────────────────────────────────────────────────────
confere("250 tokens = lotes de 100, 100 e 50", emLotesDe(Array.from({ length: 250 }, (_, i) => i)).map((l) => l.length), [100, 100, 50]);
confere("100 tokens = um lote", emLotesDe(Array.from({ length: 100 }, (_, i) => i)).length, 1);
confere("nenhum token = nenhum lote", emLotesDe([]).length, 0);

// ── Resposta do Expo e token inválido ──────────────────────────────────────
const lote = [T(1), T(2), T(3)];
const r = lerTickets(lote, { data: [
  { status: "ok", id: "tk-1" },
  { status: "error", message: "x", details: { error: "DeviceNotRegistered" } },
  { status: "error", message: "y", details: { error: "MessageRateExceeded" } },
] }, true);
confere("ticket ok vira aceito com o id", r.aceitos, [{ token: T(1), ticketId: "tk-1" }]);
confere("DeviceNotRegistered sai da base; outro erro não", r.mortos, [T(2)]);
confere("erros contados", r.erros, 2);
confere("lote recusado (HTTP 500): tudo erro, ninguém removido", lerTickets(lote, { errors: [{ code: "x" }] }, false), { aceitos: [], erros: 3, mortos: [] });
const rec = lerRecibos(
  [{ ticketId: "a", token: T(1) }, { ticketId: "b", token: T(2) }, { ticketId: "c", token: T(3) }],
  { data: { a: { status: "ok" }, b: { status: "error", details: { error: "DeviceNotRegistered" } } } },
);
confere("recibo: 1 entregue, 1 erro, o desinstalado sai", [rec.entregues, rec.erros, rec.mortos], [1, 1, [T(2)]]);
confere("recibo que ainda não saiu fica para a próxima rodada", rec.respondidos, ["a", "b"]);

// ── Texto e link ────────────────────────────────────────────────────────────
confere("título vazio recusa", conferirComposicao({ titulo: "  ", mensagem: "oi" }), { ok: false, erro: "Escreva o título." });
confere("título de 51 letras recusa", conferirComposicao({ titulo: "a".repeat(51), mensagem: "oi" }).ok, false);
confere("emoji conta como uma letra (50 com emoji passa)", conferirComposicao({ titulo: "🍕" + "a".repeat(49), mensagem: "oi" }).ok, true);
confere("espaços e quebra no título são limpos", conferirComposicao({ titulo: "  Pizza \n hoje  ", mensagem: " Só hoje " }), { ok: true, texto: { titulo: "Pizza hoje", mensagem: "Só hoje" } });
confere("link do cardápio", caminhoDoAviso("hakim-contato"), "/loja/hakim-contato");
confere("link do produto", caminhoDoAviso("hakim-contato", "cmg1abc_23"), "/loja/hakim-contato?produto=cmg1abc_23");
confere("slug estranho não vira link", caminhoDoAviso("../x"), null);
confere("o app aceita o link do cardápio", caminhoValido(caminhoDoAviso("hakim-contato")), true);
confere("o app aceita o link do produto", caminhoValido(caminhoDoAviso("hakim-contato", "cmg1abc_23")), true);
confere("o app recusa link para fora", caminhoValido("https://golpe.com/loja/x"), false);
confere("o app recusa caminho que não é da loja", caminhoValido("/store/financeiro"), false);

// ── Agenda ──────────────────────────────────────────────────────────────────
confere("agendar no passado recusa", conferirAgendamento(min(10), agora) !== null, true);
confere("agendar daqui a 1 h passa", conferirAgendamento(new Date(agora.getTime() + 3600_000), agora), null);
confere("agendar daqui a 8 dias recusa", conferirAgendamento(new Date(agora.getTime() + 8 * 86_400_000), agora) !== null, true);

console.log(`\n${total - falhas}/${total} conferências passaram.`);
if (falhas) process.exit(1);
