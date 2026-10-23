/**
 * Trava as regras do Modo Contingência que não dependem de banco:
 * a volta linha a linha (lib/contingencia/mescla.ts), o catálogo da cópia,
 * o bilhete e o gatilho gerado para a nuvem. A subida com SAVEPOINT por
 * linha (lib/contingencia/subida-linha-a-linha.ts) roda num Postgres em
 * memória (PGlite) quando ele está instalado; sem ele, essa parte é pulada.
 *
 *   npx tsx scripts/teste-contingencia.ts
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { comColunaVazia, decidir, erroDoBanco, iguais, oQueFazerComOErro, type LinhaDaSaida } from "../src/lib/contingencia/mescla";
import { aplicarLote, type BancoDaSubida } from "../src/lib/contingencia/subida-linha-a-linha";
import { FALHAS_DA_SUBIDA_ATE_DESISTIR, passoDaVolta } from "../contingencia/supervisor/regras";
import { TABELAS_DA_COPIA, colunasQueNaoDescem, idDoRegistro, tabelaDaCopia } from "../src/lib/contingencia/catalogo";
import { assinarBilhete, lerBilhete, VALIDADE_DO_BILHETE_MS } from "../src/lib/contingencia/chave";
import { conteudoDoAtalho, origensDaNuvem } from "../contingencia/supervisor/atalho";
import { sqlDaFuncao, tabelasComGatilho } from "../src/lib/contingencia/estrutura-no-banco";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QUEDA_ANTES_DE_PULAR_MS, computadorRecebeTelas, destinoDaTroca, type SituacaoDaTroca } from "../src/lib/contingencia/troca";
import { alertaDeRede, anotarTela } from "../src/lib/contingencia/rede-da-loja";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};

const pedido = tabelaDaCopia("CustomerOrder")!;
const estoque = tabelaDaCopia("StockItem")!;
const contador = tabelaDaCopia("DailyOrderCounter")!;
const usuario = tabelaDaCopia("User")!;
const nada = new Set<string>();

const saida = (o: Partial<LinhaDaSaida>): LinhaDaSaida => ({ seq: "1", tabela: "CustomerOrder", registro: "p1", operacao: "UPDATE", antes: null, depois: null, ...o });

console.log("— A volta, linha a linha —");
{
  const d = decidir(pedido, saida({ operacao: "INSERT", depois: { id: "p9", franchiseeId: "L", status: "NOVO" } }), null, nada);
  confere("pedido novo da loja entra", d.tipo === "inserir" && (d as any).linha.id === "p9", d);
}
{
  const d = decidir(
    pedido,
    saida({ antes: { id: "p1", status: "NOVO", total: 10 }, depois: { id: "p1", status: "PRONTO", total: 10 } }),
    { id: "p1", status: "NOVO", total: 10 },
    nada,
  );
  confere("só a loja mudou: vai como a loja deixou, sem conflito", d.tipo === "atualizar" && (d as any).mudar.status === "PRONTO" && !(d as any).conflitos.length, d);
}
{
  const d = decidir(
    pedido,
    saida({ antes: { id: "p1", status: "NOVO" }, depois: { id: "p1", status: "PRONTO" } }),
    { id: "p1", status: "CANCELADO" },
    nada,
  );
  confere("os dois mudaram: vale a loja e o conflito fica anotado", d.tipo === "atualizar" && (d as any).mudar.status === "PRONTO" && (d as any).conflitos.length === 1, d);
}
{
  const d = decidir(
    pedido,
    saida({ antes: { id: "p1", status: "NOVO" }, depois: { id: "p1", status: "PRONTO" } }),
    { id: "p1", status: "PRONTO" },
    nada,
  );
  confere("os dois chegaram ao mesmo: nada a fazer", d.tipo === "nada", d);
}
{
  const d = decidir(
    estoque,
    saida({ tabela: "StockItem", antes: { id: "e1", quantity: 10 }, depois: { id: "e1", quantity: 7 } }),
    { id: "e1", quantity: 9 },
    nada,
  );
  confere("estoque soma: loja baixou 3, nuvem baixou 1 → 6", d.tipo === "atualizar" && (d as any).mudar.quantity === 6, d);
}
{
  const d = decidir(
    contador,
    saida({ tabela: "DailyOrderCounter", antes: { franchiseeId: "L", dateKey: "k", lastNumber: 142 }, depois: { franchiseeId: "L", dateKey: "k", lastNumber: 150 } }),
    { franchiseeId: "L", dateKey: "k", lastNumber: 144 },
    nada,
  );
  confere("contador do número do pedido fica com o maior", d.tipo === "atualizar" && (d as any).mudar.lastNumber === 150 && !(d as any).conflitos.length, d);
}
{
  const proibidas = new Set(colunasQueNaoDescem(usuario, ["id", "password", "cashOpen", "ifoodAccessToken"]));
  const d = decidir(
    usuario,
    saida({ tabela: "User", antes: { id: "L", cashOpen: true, password: "" }, depois: { id: "L", cashOpen: false, password: "" } }),
    { id: "L", cashOpen: true, password: "$2b$hash" },
    proibidas,
  );
  confere("senha nunca sobe; fechar o caixa sobe", d.tipo === "atualizar" && (d as any).mudar.cashOpen === false && !("password" in (d as any).mudar), d);
  const nova = decidir(usuario, saida({ tabela: "User", operacao: "INSERT", depois: { id: "X" } }), null, proibidas);
  confere("a contingência não cria conta", nova.tipo === "recusar", nova);
}
{
  const d = decidir(pedido, saida({ operacao: "DELETE", antes: { id: "p1", status: "NOVO" } }), { id: "p1", status: "NOVO" }, nada);
  confere("apagado na loja, igual na nuvem: apaga sem conflito", d.tipo === "apagar" && !(d as any).conflitos.length, d);
  const d2 = decidir(pedido, saida({ operacao: "DELETE", antes: { id: "p1", status: "NOVO" } }), { id: "p1", status: "ACEITO" }, nada);
  confere("apagado na loja, mudado na nuvem: apaga e anota", d2.tipo === "apagar" && (d2 as any).conflitos.length === 1, d2);
  const d3 = decidir(pedido, saida({ operacao: "DELETE", antes: { id: "p1" } }), null, nada);
  confere("apagado nos dois: nada", d3.tipo === "nada", d3);
}
{
  const d = decidir(
    pedido,
    saida({ antes: { id: "p1", status: "NOVO", updatedAt: "a" }, depois: { id: "p1", status: "NOVO", updatedAt: "b" } }),
    { id: "p1", status: "NOVO", updatedAt: "c" },
    nada,
  );
  confere("updatedAt nunca é conflito", d.tipo === "atualizar" && !(d as any).conflitos.length, d);
}
{
  // A cada consulta da fila no computador da loja, o User ganha a hora da
  // consulta: na volta isso não sobe nem vira conflito.
  const pulso = decidir(
    usuario,
    saida({
      tabela: "User",
      antes: { id: "L", cashOpen: true, printQueuePolledAt: "10:00:00", updatedAt: "10:00:00" },
      depois: { id: "L", cashOpen: true, printQueuePolledAt: "10:00:03", updatedAt: "10:00:03" },
    }),
    { id: "L", cashOpen: true, printQueuePolledAt: "09:58:00", updatedAt: "09:58:00" },
    nada,
  );
  confere("só o pulso do Assistente mudou: nada sobe", pulso.tipo === "nada", pulso);
  const junto = decidir(
    usuario,
    saida({
      tabela: "User",
      antes: { id: "L", cashOpen: true, printQueuePolledAt: "10:00:00", updatedAt: "10:00:00" },
      depois: { id: "L", cashOpen: false, printQueuePolledAt: "10:00:03", updatedAt: "10:00:03" },
    }),
    { id: "L", cashOpen: true, printQueuePolledAt: "09:58:00", updatedAt: "09:58:00" },
    nada,
  );
  confere(
    "caixa fechado junto com o pulso: sobe o caixa, sem o pulso e sem conflito",
    junto.tipo === "atualizar" && (junto as any).mudar.cashOpen === false && !("printQueuePolledAt" in (junto as any).mudar) && !(junto as any).conflitos.length,
    junto,
  );
}
confere("JSON com chaves em outra ordem é igual", iguais({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }));

console.log("\n— Para onde a tela vai quando a nuvem some —");
{
  const ips = ["http://192.168.0.10:7890"];
  const caiu = QUEDA_ANTES_DE_PULAR_MS; // queda de 45 s seguidos
  const tv = (o: Partial<SituacaoDaTroca> = {}): SituacaoDaTroca => ({
    contingenciaAqui: false, enderecoNoAssistente: null, pcVivo: true, enderecos: ips, quedaHaMs: caiu, ...o,
  });
  const caixa = (o: Partial<SituacaoDaTroca> = {}): SituacaoDaTroca => ({
    contingenciaAqui: true, enderecoNoAssistente: "http://127.0.0.1:7890", pcVivo: true, enderecos: ips, quedaHaMs: 5_000, souOPc: true, modoNoAssistente: "contingencia", ...o,
  });
  confere("a queda que a tela espera é de 45 s (decisão do Douglas, 14/10)", QUEDA_ANTES_DE_PULAR_MS === 45_000, QUEDA_ANTES_DE_PULAR_MS);
  confere("TV com o computador da loja vivo e 45 s de queda: vai para ele", destinoDaTroca(tv()) === ips[0]);
  confere("TV com 44 s de queda: ainda fica (um 502 de deploy ou do Cloudflare não tira a tela)", destinoDaTroca(tv({ quedaHaMs: caiu - 1_000 })) === null);
  confere("TV com a nuvem respondendo agora: fica", destinoDaTroca(tv({ quedaHaMs: 0 })) === null);
  confere(
    "TV com o computador da loja desligado: fica (nada de página de erro presa)",
    destinoDaTroca(tv({ pcVivo: false })) === null,
  );
  confere("TV sem rede (navigator.onLine=false): fica — o PC também não estaria lá", destinoDaTroca(tv({ online: false })) === null);
  confere("TV com rede (onLine=true): vai", destinoDaTroca(tv({ online: true })) === ips[0]);
  confere("TV que acabou de voltar do computador da loja: espera antes de pular de novo", destinoDaTroca(tv({ esperaDaVoltaMs: 30_000 })) === null);
  confere("bilhete sem endereço: fica", destinoDaTroca(tv({ enderecos: [] })) === null);
  confere(
    "outro PC com Assistente, contingência em outro computador: vai pelo IP da rede depois de 45 s",
    destinoDaTroca(tv({ contingenciaAqui: false, souOPc: false })) === ips[0],
  );

  // O computador do caixa: vale o que o Assistente diz.
  confere("PC do caixa com o FireHub local pronto e a queda declarada: vai para o 127.0.0.1", destinoDaTroca(caixa()) === "http://127.0.0.1:7890");
  confere("PC do caixa: não espera os 45 s quando o supervisor já declarou", destinoDaTroca(caixa({ quedaHaMs: 1 })) === "http://127.0.0.1:7890");
  confere(
    "PC do caixa ainda subindo o FireHub local: espera (não vai para o IP da rede)",
    destinoDaTroca(caixa({ enderecoNoAssistente: null })) === null,
  );
  confere("PC do caixa com a nuvem respondendo a ele: fica", destinoDaTroca(caixa({ quedaHaMs: 0 })) === null);
  confere(
    "PC do caixa com o supervisor em modo normal e 10 s de falha: fica (soluço só do navegador)",
    destinoDaTroca(caixa({ modoNoAssistente: "normal", quedaHaMs: 10_000 })) === null,
  );
  confere(
    "PC do caixa com o supervisor normal e 45 s sem a nuvem só no navegador: vai",
    destinoDaTroca(caixa({ modoNoAssistente: "normal", quedaHaMs: caiu })) === "http://127.0.0.1:7890",
  );
  confere("PC do caixa no \"Testar agora\": vai sem esperar", destinoDaTroca(caixa({ modoNoAssistente: "normal", quedaHaMs: 0, testando: true })) === "http://127.0.0.1:7890");
  confere("PC do caixa sem Wi-Fi: o 127.0.0.1 não depende da rede, vai", destinoDaTroca(caixa({ online: false })) === "http://127.0.0.1:7890");
  confere(
    "PC do caixa com o Assistente sem resposta (souOPc): fica e confere de novo — nunca o IP da rede",
    destinoDaTroca(tv({ souOPc: true, contingenciaAqui: false, enderecoNoAssistente: null })) === null,
  );
}

console.log("\n— O computador da loja recebe telas? (sinal da nuvem) —");
{
  const agora = Date.now();
  confere("relatou há 30 s com a cópia pronta: recebe", computadorRecebeTelas(agora - 30_000, { copiaPronta: true, modo: "normal" }, agora));
  confere("modo normal com pronta=false mas copiaPronta=true: recebe (pronta é sempre false em modo normal)", computadorRecebeTelas(agora - 30_000, { copiaPronta: true, modo: "normal", pronta: false } as any, agora));
  confere("cópia ainda não pronta: não recebe", !computadorRecebeTelas(agora - 30_000, { copiaPronta: false }, agora));
  confere("copiaPronta lida do banco como texto \"false\": não recebe", !computadorRecebeTelas(agora - 30_000, { copiaPronta: "false" }, agora));
  confere("supervisor avisou que está parando: não recebe", !computadorRecebeTelas(agora - 30_000, { copiaPronta: true, modo: "parando" }, agora));
  confere("supervisor com parando=true: não recebe", !computadorRecebeTelas(agora - 30_000, { copiaPronta: true, parando: true }, agora));
  confere("supervisor antigo (sem copiaPronta): recebe como antes", computadorRecebeTelas(agora - 30_000, { modo: "normal" }, agora));
  confere("sem notícia há 90 s: não recebe", !computadorRecebeTelas(agora - 90_000, { copiaPronta: true }, agora));
  confere("nunca relatou: não recebe", !computadorRecebeTelas(null, null, agora));
}

console.log("\n— O computador da contingência está na internet da loja? —");
{
  const agora = Date.now();
  const em = (ms: number) => new Date(agora - ms).toISOString();
  const telas = { "189.1.2.3": { em: em(60_000), n: 40 }, "2804:14c:1:2:aaaa::1": { em: em(60_000), n: 30 } };
  confere("computador na mesma internet das telas: sem alerta", alertaDeRede("189.1.2.3", telas, null, agora) === null);
  const longe = alertaDeRede("177.9.9.9", telas, null, agora);
  confere("computador em outra internet (o PC de casa): alerta com o IP das telas", !!longe && longe.outras.length === 1 && longe.outras[0].ip === "189.1.2.3", longe);
  confere("IPv6 compara pelo /64 (endereço temporário muda no fim)", alertaDeRede("2804:14c:1:2:bbbb::9", telas, null, agora) === null);
  confere("IPv6 de outro /64: alerta", !!alertaDeRede("2804:14c:9:9::1", telas, null, agora));
  confere("computador só em IPv4 e telas só em IPv6: não dá para comparar, sem alerta", alertaDeRede("177.9.9.9", { "2804:14c:1:2::1": { em: em(1000), n: 3 } }, null, agora) === null);
  confere("tela vista há 3 h não conta", alertaDeRede("177.9.9.9", { "189.1.2.3": { em: em(3 * 60 * 60_000), n: 3 } }, null, agora) === null);
  confere("sem IP do computador (supervisor antigo): sem alerta", alertaDeRede(undefined, telas, null, agora) === null);
  const meu = alertaDeRede("177.9.9.9", telas, "189.1.2.3", agora);
  confere("marca qual IP é o do aparelho de quem olha (o dono em casa entende)", !!meu && meu.outras[0].esteAparelho === true, meu);
  const primeira = anotarTela(null, "189.1.2.3", agora);
  confere("primeira tela anota o IP", !!primeira && primeira["189.1.2.3"]?.n === 1, primeira);
  confere("mesmo IP em menos de 5 min: nada a gravar", anotarTela(primeira, "189.1.2.3", agora + 60_000) === null);
  const depois = anotarTela(primeira, "189.1.2.3", agora + 6 * 60_000);
  confere("mesmo IP depois de 5 min: conta de novo", depois?.["189.1.2.3"]?.n === 2, depois);
  confere("IP inválido não entra", anotarTela(null, "unknown", agora) === null);
  let muitas: any = null;
  for (let i = 0; i < 20; i++) muitas = anotarTela(muitas, `10.0.0.${i}`, agora + i * 1000) || muitas;
  confere("guarda só os 8 IPs mais recentes", Object.keys(muitas).length === 8 && !!muitas["10.0.0.19"] && !muitas["10.0.0.0"], Object.keys(muitas));
}

console.log("\n— A rede de segurança (service worker) usa a mesma queda —");
{
  const sw = readFileSync(join(__dirname, "..", "public", "sw-contingencia.js"), "utf8");
  confere(`public/sw-contingencia.js: QUEDA_MS = ${QUEDA_ANTES_DE_PULAR_MS}`, sw.includes(`const QUEDA_MS = ${QUEDA_ANTES_DE_PULAR_MS};`));
  confere("a página de troca não tem barra invertida (a string entre crases engole)", !sw.slice(sw.indexOf("const PAGINA"), sw.indexOf("</script>")).includes("\\"));
  confere("a página de troca respeita a volta recente e o PC do caixa", sw.includes("firehub_contingencia_voltou") && sw.includes("firehub_contingencia_sou_o_pc"));
}

console.log("\n— Catálogo e bilhete —");
confere("toda tabela tem chave", TABELAS_DA_COPIA.every((t) => t.chave.length > 0));
confere("pai/avô sempre com recorte de foto", TABELAS_DA_COPIA.every((t) => (t.loja.tipo === "pai" || t.loja.tipo === "avo") ? !!t.foto : true));
confere("senha do garçom desce, a do painel não", colunasQueNaoDescem(tabelaDaCopia("Waiter")!, ["passwordHash"]).length === 0 && colunasQueNaoDescem(usuario, ["password"]).includes("password"));
confere("token de fora não desce por regra geral", colunasQueNaoDescem(tabelaDaCopia("Motoboy")!, ["id", "pushToken"]).includes("pushToken"));
confere("registro de chave composta", idDoRegistro(contador, { franchiseeId: "L", dateKey: "k" }) === '["L","k"]');

const segredo = "segredo-de-teste";
const b = assinarBilhete({ v: 1, loja: "L", tipo: "painel", email: "a@b.c", exp: Date.now() + 60_000 }, segredo);
confere("bilhete bom abre", lerBilhete(b, segredo, "L")?.email === "a@b.c");
confere("bilhete de outra loja não abre", lerBilhete(b, segredo, "OUTRA") === null);
confere("bilhete com outro segredo não abre", lerBilhete(b, "outro", "L") === null);
confere("bilhete adulterado não abre", lerBilhete(b.replace(/^./, (c) => (c === "e" ? "f" : "e")), segredo, "L") === null);
const vencido = assinarBilhete({ v: 1, loja: "L", tipo: "painel", email: "a@b.c", exp: Date.now() - 1 }, segredo);
confere("bilhete vencido não abre", lerBilhete(vencido, segredo, "L") === null);
// Dias sem internet (pedido do Douglas, 14/10/2026): o bilhete que a tela guardou
// na última vez com internet continua abrindo a loja.
const DIA = 24 * 60 * 60 * 1000;
const guardado = assinarBilhete({ v: 1, loja: "L", tipo: "painel", email: "a@b.c", exp: Date.now() + VALIDADE_DO_BILHETE_MS }, segredo);
confere("bilhete guardado abre depois de 3 dias sem internet", lerBilhete(guardado, segredo, "L", Date.now() + 3 * DIA)?.email === "a@b.c");
confere("bilhete guardado abre depois de 300 dias sem internet", lerBilhete(guardado, segredo, "L", Date.now() + 300 * DIA)?.email === "a@b.c");
confere("bilhete guardado vence depois de 1 ano sem internet", lerBilhete(guardado, segredo, "L", Date.now() + 366 * DIA) === null);

console.log("\n— Atalho da área de trabalho —");
const icone = String.raw`C:\Users\Loja\AppData\Roaming\FireHub\contingencia\FireHub.ico`;
const atalho = conteudoDoAtalho("https://firehubfood.com.br/store", icone);
confere("atalho abre o FireHub de sempre (a nuvem), não o endereço local", atalho.includes("URL=https://firehubfood.com.br/store") && !atalho.includes("7890"));
confere("atalho com o ícone do FireHub", atalho.includes(`IconFile=${icone}`));
confere("atalho marcado como do FireHub (só ele é atualizado)", atalho.includes("[FireHub]") && atalho.startsWith("[InternetShortcut]\r\n"));
confere("atalho aceita o endereço com e sem www", JSON.stringify(origensDaNuvem("https://firehubfood.com.br")) === JSON.stringify(["https://firehubfood.com.br", "https://www.firehubfood.com.br"]), origensDaNuvem("https://firehubfood.com.br"));
confere("atalho não aceita endereço de fora", !origensDaNuvem("https://firehubfood.com.br").includes("https://firehubfood.com.br.evil.com"));

console.log("\n— Gatilho da nuvem —");
for (const t of tabelasComGatilho()) {
  const sql = sqlDaFuncao(t);
  const ok = sql.includes("EXCEPTION WHEN OTHERS") && sql.includes(`'${t.nome}'`) && sql.includes(`NOT EXISTS (SELECT 1 FROM "Contingencia" LIMIT 1)`);
  if (!ok) confere(`gatilho de ${t.nome} protegido e com atalho`, false, sql.slice(0, 200));
}
confere(`${tabelasComGatilho().length} gatilhos protegidos (erro engolido, saída rápida sem loja ativada)`, true);
confere("User só anota mudança fora do printQueuePolledAt", sqlDaFuncao(usuario).includes("printQueuePolledAt"));

console.log("\n— A linha que a nuvem não aceita (volta-1) —");
{
  // Como o Prisma devolve o erro do $executeRawUnsafe (P2010).
  const erroDoPrisma = (codigo: string, msg: string) =>
    Object.assign(new Error(`Invalid \`prisma.$executeRawUnsafe()\` invocation:\n\n\nRaw query failed. Code: \`${codigo}\`. Message: \`ERROR: ${msg}\``), {
      code: "P2010",
      meta: { code: codigo, message: `ERROR: ${msg}` },
    });
  const fkDaRota = erroDoPrisma("23503", 'insert or update on table "CustomerOrder" violates foreign key constraint "CustomerOrder_routeId_fkey"');
  const e1 = erroDoBanco(fkDaRota);
  confere("erro do Prisma: código e mensagem do Postgres", e1.codigo === "23503" && e1.mensagem.startsWith("insert or update on table"), e1);
  const e2 = erroDoBanco(Object.assign(new Error('null value in column "status"'), { code: "23502" }));
  confere("erro do pg: código direto", e2.codigo === "23502", e2);
  const e3 = erroDoBanco(Object.assign(new Error("Raw query failed. Code: `23505`. Message: `duplicate key`"), { code: "P2010" }));
  confere("P2010 sem meta: o código vem da mensagem, não do Prisma", e3.codigo === "23505", e3);
  // O Prisma junta o DETAIL do Postgres, que traz os valores da linha: não pode ir para o log.
  const comDetalhe = erroDoPrisma(
    "23502",
    'null value in column "status" of relation "CustomerOrder" violates not-null constraint\nDETAIL: Failing row contains (p2, L, Maria da Silva, 11987654321, Rua das Flores 10).',
  );
  const e4 = erroDoBanco(comDetalhe);
  confere(
    "a mensagem do erro não leva os valores da linha (nome, telefone, endereço)",
    e4.codigo === "23502" && e4.mensagem.includes("not-null") && !/Maria|11987654321|Flores|DETAIL/.test(e4.mensagem),
    e4.mensagem,
  );
  // O Prisma de verdade (P2010) manda SÓ o DETAIL: em inglês no Neon, no idioma do Windows no Postgres local (visto em 15/10).
  const soDetalhe = (msg: string) =>
    Object.assign(new Error(`\nInvalid \`prisma.$executeRawUnsafe()\` invocation:\n\n\nRaw query failed. Code: \`23502\`. Message: \`${msg}\``), {
      code: "P2010",
      meta: { code: "23502", message: msg },
    });
  const e4en = erroDoBanco(soDetalhe("Failing row contains (p2, L, Maria da Silva, 11987654321)."));
  confere("Prisma real, só o DETAIL em inglês: sem o dado e com o motivo pelo código", e4en.mensagem === "campo obrigatório vazio" && e4en.codigo === "23502", e4en.mensagem);
  const e4pt = erroDoBanco(soDetalhe("Registro que falhou contém (p2, L, Maria da Silva, 11987654321)."));
  confere("Prisma real, só o DETAIL em português: o dado do cliente não vaza", e4pt.mensagem === "campo obrigatório vazio", e4pt.mensagem);
  const e4det = erroDoBanco(erroDoPrisma("23502", 'o valor nulo na coluna "status" viola a restrição de não-nulo\nDETALHE: Registro que falhou contém (p2, Maria).'));
  confere("DETALHE em português também sai", !/Maria|DETALHE/.test(e4det.mensagem) && e4det.mensagem.includes("não-nulo"), e4det.mensagem);
  const e5 = erroDoBanco(erroDoPrisma("23505", 'duplicate key value violates unique constraint "X_phone_key" Key (phone)=(11987654321) already exists.'));
  confere("valor da chave no texto do erro sai como (…)", !e5.mensagem.includes("11987654321") && e5.mensagem.includes("(phone)=(…)"), e5.mensagem);
  const fkComDetalhe = erroDoPrisma(
    "23503",
    'insert or update on table "CustomerOrder" violates foreign key constraint "X"\nDETAIL: Key (routeId)=(r-sumiu) is not present in table "RouteSchedule".',
  );
  confere(
    "sem o valor na mensagem, a coluna da FK ainda é achada pelo DETAIL",
    oQueFazerComOErro(pedido, saida({ operacao: "INSERT", depois: { id: "p1", routeId: "r-sumiu" } }), fkComDetalhe).tipo === "anular",
  );
  const p2003 = Object.assign(new Error("Foreign key constraint violated"), { code: "P2003", meta: { field_name: "CustomerOrder_routeId_fkey (index)" } });
  confere("P2003 (chave estrangeira traduzida pelo Prisma) também esvazia a coluna", oQueFazerComOErro(pedido, saida({ operacao: "INSERT", depois: { id: "p1", routeId: "r" } }), p2003).tipo === "anular");

  const comRota = saida({ operacao: "UPDATE", antes: { id: "p1", routeId: null }, depois: { id: "p1", routeId: "r-sumiu" } });
  const o1 = oQueFazerComOErro(pedido, comRota, fkDaRota);
  confere("FK da rota que não subiu: tenta de novo com routeId vazio", o1.tipo === "anular" && o1.coluna === "routeId", o1);
  const o2 = oQueFazerComOErro(pedido, comRota, fkDaRota, ["routeId"]);
  confere("FK de novo na coluna já esvaziada: recusa", o2.tipo === "recusar", o2);
  const o3 = oQueFazerComOErro(pedido, comRota, erroDoPrisma("23502", 'null value in column "status" violates not-null constraint'));
  confere("NOT NULL: recusa com o erro", o3.tipo === "recusar" && o3.motivo.includes("23502"), o3);
  const o4 = oQueFazerComOErro(pedido, comRota, erroDoPrisma("23503", 'insert or update on table "CustomerOrder" violates foreign key constraint "CustomerOrder_franchiseeId_fkey"'));
  confere("FK numa coluna que não pode ficar vazia (a loja): recusa", o4.tipo === "recusar", o4);
  const o5 = oQueFazerComOErro(pedido, saida({ operacao: "DELETE", antes: { id: "p1" } }), fkDaRota);
  confere("DELETE não esvazia coluna: recusa", o5.tipo === "recusar", o5);
  const o6 = oQueFazerComOErro(undefined, comRota, fkDaRota);
  confere("tabela fora da cópia: recusa", o6.tipo === "recusar", o6);
  const o7 = oQueFazerComOErro(pedido, saida({ operacao: "INSERT", depois: { id: "p1", motoboyId: "m1" } }), { code: "23503", detail: 'Key (motoboyId)=(m1) is not present in table "Motoboy".' });
  confere("FK pelo detalhe do Postgres (Key (coluna)=): esvazia essa coluna", o7.tipo === "anular" && o7.coluna === "motoboyId", o7);
  const vazia = comColunaVazia(comRota, "routeId");
  confere(
    "a coluna sai da linha (não vira null) e a original não muda",
    !!vazia.depois && !("routeId" in vazia.depois) && comRota.depois!.routeId === "r-sumiu",
  );
}

console.log("\n— O supervisor no modo voltando —");
confere("tudo subiu: normal", passoDaVolta({ subiu: true, falhasSeguidas: 0, pendentes: 0 }) === "normal");
confere("subiu um lote, falta mais: segue voltando", passoDaVolta({ subiu: true, falhasSeguidas: 0, pendentes: 300 }) === "seguir-voltando");
confere("falhou poucas vezes: segue voltando", passoDaVolta({ subiu: false, falhasSeguidas: FALHAS_DA_SUBIDA_ATE_DESISTIR - 1, pendentes: 3 }) === "seguir-voltando");
confere(
  `falhou ${FALHAS_DA_SUBIDA_ATE_DESISTIR} vezes seguidas: normal com a saída guardada`,
  passoDaVolta({ subiu: false, falhasSeguidas: FALHAS_DA_SUBIDA_ATE_DESISTIR, pendentes: 3 }) === "normal-com-pendentes",
);

console.log("\n— Catálogo novo —");
{
  const rota = tabelaDaCopia("RouteSchedule");
  confere("a rota do motoboy está na cópia (o pedido com routeId não trava a volta)", !!rota && !rota.soPorFoto && rota.loja.tipo === "coluna");
  const receita = tabelaDaCopia("ProductRecipe");
  confere(
    "a ficha técnica está na cópia (a venda da queda baixa estoque)",
    !!receita && receita.loja.tipo === "pai" && receita.loja.tabela === "MenuProduct" && !!receita.foto && !!receita.semLinhaNova,
  );
  confere(
    "ficha técnica e rota ganham gatilho na nuvem",
    tabelasComGatilho().some((t) => t.nome === "ProductRecipe") && tabelasComGatilho().some((t) => t.nome === "RouteSchedule"),
  );
  const fora = colunasQueNaoDescem(usuario, ["id", "password", "painelDeSenhas", "mpAccessToken"]);
  confere(
    "o Painel de senhas desce (a TV do salão acha a loja na cópia); a senha não",
    !fora.includes("painelDeSenhas") && fora.includes("password") && fora.includes("mpAccessToken"),
    fora,
  );
  confere(
    "coluna que pode ficar vazia nunca é chave nem a coluna da loja",
    TABELAS_DA_COPIA.every((t) => (t.paiQuePodeFaltar || []).every((c) => !t.chave.includes(c) && !(t.loja.tipo === "coluna" && t.loja.coluna === c))),
  );
  confere("o routeId do pedido pode ficar vazio", (pedido.paiQuePodeFaltar || []).includes("routeId"));
}

// ── A subida linha a linha, num Postgres de verdade (PGlite) ────────────────
async function abrirPGlite(): Promise<any | null> {
  const candidatos = [process.env.PGLITE, "C:/Users/Micro/crm-teste/node_modules/@electric-sql/pglite/dist/index.js"].filter(Boolean) as string[];
  for (const c of candidatos) {
    if (!existsSync(c)) continue;
    const { PGlite } = await import(pathToFileURL(c).href);
    return new PGlite();
  }
  try { const { PGlite } = await import("@electric-sql/" + "pglite"); return new PGlite(); } catch { return null; }
}

async function subidaNoPostgres(): Promise<void> {
  const pg = await abrirPGlite();
  if (!pg) {
    console.log("\n⚠️  PGlite não encontrado: a subida linha a linha no Postgres foi PULADA (rode com PGLITE=<dist/index.js>).");
    return;
  }
  console.log("\n— A subida linha a linha, num Postgres em memória (PGlite) —");
  await pg.exec(`
    CREATE TABLE "Contingencia" ("lojaId" TEXT PRIMARY KEY, "ultimaSubida" BIGINT NOT NULL DEFAULT 0, "subidaBanco" TEXT);
    CREATE TABLE "ContingenciaConflito" ("id" TEXT PRIMARY KEY, "lojaId" TEXT NOT NULL, "episodioId" TEXT, "tabela" TEXT NOT NULL,
      "registro" TEXT NOT NULL, "coluna" TEXT, "valorDaLoja" JSONB, "valorDaNuvem" JSONB, "decisao" TEXT NOT NULL,
      "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE "ContingenciaEpisodio" ("id" TEXT PRIMARY KEY, "lojaId" TEXT NOT NULL, "inicio" TIMESTAMP(3), "fim" TIMESTAMP(3),
      "subiuEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "linhas" INTEGER NOT NULL DEFAULT 0, "pedidos" INTEGER NOT NULL DEFAULT 0,
      "conflitos" INTEGER NOT NULL DEFAULT 0, "resumo" JSONB);
    CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "ownerId" TEXT);
    CREATE TABLE "CashSession" ("id" TEXT PRIMARY KEY, "franchiseeId" TEXT NOT NULL, "status" TEXT NOT NULL, "closedAt" TIMESTAMP(3));
    CREATE TABLE "RouteSchedule" ("id" TEXT PRIMARY KEY, "franchiseeId" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RouteSchedule_franchiseeId_fkey" FOREIGN KEY ("franchiseeId") REFERENCES "User"("id"));
    CREATE TABLE "CustomerOrder" ("id" TEXT PRIMARY KEY, "franchiseeId" TEXT NOT NULL, "status" TEXT NOT NULL,
      "routeId" TEXT, "dailyOrderNumber" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CustomerOrder_franchiseeId_fkey" FOREIGN KEY ("franchiseeId") REFERENCES "User"("id"),
      CONSTRAINT "CustomerOrder_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "RouteSchedule"("id") ON DELETE SET NULL);
    INSERT INTO "User" VALUES ('L', NULL);
    INSERT INTO "Contingencia" ("lojaId") VALUES ('L');
    INSERT INTO "CustomerOrder" VALUES ('p3', 'L', 'PRONTO', NULL, 150, '2026-10-14 21:00:00');
    INSERT INTO "CustomerOrder" VALUES ('p-ifood', 'L', 'ACEITO', NULL, 151, '2026-10-14 21:10:00');
  `);

  const banco = (q: any): BancoDaSubida => ({
    consultar: async <T,>(sql: string, ...valores: unknown[]) => (await q.query(sql, valores)).rows as T[],
    executar: (sql: string, ...valores: unknown[]) => q.query(sql, valores),
    colunas: async (tabela: string) =>
      (
        (await q.query(
          `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          [tabela],
        )).rows as { c: string }[]
      ).map((r) => r.c),
  });
  const linha = (seq: number, o: Partial<LinhaDaSaida>): LinhaDaSaida => ({
    seq: String(seq), tabela: "CustomerOrder", registro: "", operacao: "INSERT", antes: null, depois: null, ...o,
  });
  const lote: LinhaDaSaida[] = [
    // O pedido que aponta para a rota que nunca subiu (o caso do achado).
    linha(1, { registro: "p1", depois: { id: "p1", franchiseeId: "L", status: "ACEITO", routeId: "r-sumiu", dailyOrderNumber: 152, createdAt: "2026-10-14T21:20:00" } }),
    // Uma linha que o banco recusa por outro motivo: só ela fica de fora.
    linha(2, { registro: "p2", depois: { id: "p2", franchiseeId: "L", status: null, dailyOrderNumber: 153, createdAt: "2026-10-14T21:21:00" } }),
    // A rota criada na queda sobe antes do pedido que aponta para ela (ordem da saída).
    linha(3, { tabela: "RouteSchedule", registro: "r1", depois: { id: "r1", franchiseeId: "L", status: "DISPATCHED", createdAt: "2026-10-14T21:22:00" } }),
    linha(4, {
      operacao: "UPDATE", registro: "p3",
      antes: { id: "p3", franchiseeId: "L", status: "PRONTO", routeId: null },
      depois: { id: "p3", franchiseeId: "L", status: "PRONTO", routeId: "r1" },
    }),
    // O balcão numerou #151 na queda e a nuvem também deu #151 a um pedido do iFood.
    linha(5, { registro: "p4", depois: { id: "p4", franchiseeId: "L", status: "ACEITO", dailyOrderNumber: 151, createdAt: "2026-10-14T21:15:00" } }),
  ];
  const episodio = { inicio: "2026-10-14T21:00:00.000Z", fim: "2026-10-14T21:30:00.000Z" };
  const r = await pg.transaction((tx: any) => aplicarLote(banco(tx), "L", "banco-1", lote, episodio, true));
  confere("o lote não trava: o cursor anda até o fim", r.aplicadoAte === "5", r);
  confere(
    "só a linha ruim fica de fora",
    r.recusadas.length === 1 && r.recusadas[0].registro === "p2" && r.recusadas[0].motivo.includes("23502"),
    r.recusadas,
  );
  confere("as outras subiram", r.aplicadas === 4, r);
  const pedidos = (await pg.query(`SELECT id, "routeId" FROM "CustomerOrder" ORDER BY id`)).rows as { id: string; routeId: string | null }[];
  const p = (id: string) => pedidos.find((x) => x.id === id);
  confere("o pedido da rota que sumiu subiu com a rota vazia", !!p("p1") && p("p1")!.routeId === null, pedidos);
  confere("o pedido da linha recusada não entrou", !p("p2"), pedidos);
  confere("o pedido ganhou a rota que subiu na mesma volta", p("p3")?.routeId === "r1", pedidos);
  const conflitos = (await pg.query(`SELECT registro, coluna, decisao FROM "ContingenciaConflito" ORDER BY registro`)).rows as {
    registro: string; coluna: string | null; decisao: string;
  }[];
  const c = (registro: string) => conflitos.find((x) => x.registro === registro);
  confere("a rota vazia fica anotada no painel", c("p1")?.coluna === "routeId", conflitos);
  confere('a linha recusada vira conflito "recusada" com o erro', !!c("p2")?.decisao.startsWith("recusada") && c("p2")!.decisao.includes("23502"), conflitos);
  confere("o número repetido fica anotado (não renumera)", c("p4")?.coluna === "dailyOrderNumber" && !!c("p4")?.decisao.startsWith("número repetido"), conflitos);
  confere("conflitos contados na resposta", r.conflitos === 3, r);
  const cursor = (await pg.query(`SELECT "ultimaSubida"::text AS u FROM "Contingencia"`)).rows[0] as { u: string };
  confere("o cursor da nuvem anda até a última linha", cursor.u === "5", cursor);
  const ep = (await pg.query(`SELECT linhas, pedidos, conflitos, resumo FROM "ContingenciaEpisodio"`)).rows[0] as any;
  confere(
    "o episódio conta as linhas, os pedidos e a recusada",
    ep?.linhas === 4 && ep?.pedidos === 2 && ep?.conflitos === 3 && ep?.resumo?.recusadas?.length === 1,
    ep,
  );
  const deNovo = await pg.transaction((tx: any) => aplicarLote(banco(tx), "L", "banco-1", lote, episodio, true));
  confere("o mesmo lote de novo não aplica nada (idempotente)", deNovo.aplicadas === 0 && deNovo.recusadas.length === 0 && deNovo.aplicadoAte === "5", deNovo);
  // Mesmo número depois de um fechamento de caixa: a contagem recomeçou, não é repetido.
  await pg.exec(`INSERT INTO "CashSession" VALUES ('cx', 'L', 'CLOSED', '2026-10-15 03:00:00')`);
  const outroTurno = [linha(6, { registro: "p5", depois: { id: "p5", franchiseeId: "L", status: "ACEITO", dailyOrderNumber: 151, createdAt: "2026-10-15T04:00:00" } })];
  const r2 = await pg.transaction((tx: any) => aplicarLote(banco(tx), "L", "banco-1", outroTurno, null, true));
  confere("mesmo número depois do fechamento do caixa: não é repetido", r2.aplicadas === 1 && r2.conflitos === 0, r2);
  // O UPDATE que só punha a rota que não subiu: nada a gravar, mas fica anotado.
  const soARota = [linha(7, {
    operacao: "UPDATE", registro: "p-ifood",
    antes: { id: "p-ifood", franchiseeId: "L", status: "ACEITO", routeId: null },
    depois: { id: "p-ifood", franchiseeId: "L", status: "ACEITO", routeId: "r-sumiu-2" },
  })];
  const r3 = await pg.transaction((tx: any) => aplicarLote(banco(tx), "L", "banco-1", soARota, null, true));
  const anotado = (await pg.query(`SELECT coluna FROM "ContingenciaConflito" WHERE registro = 'p-ifood'`)).rows as { coluna: string }[];
  confere(
    "a mudança que só punha a rota que sumiu fica anotada, sem gravar nada",
    r3.aplicadas === 0 && r3.conflitos === 1 && r3.aplicadoAte === "7" && anotado.length === 1 && anotado[0].coluna === "routeId",
    { r3, anotado },
  );
  // O pedido que estava na rota r1 (boa, na nuvem) e a loja passou para uma
  // rota que não subiu, mudando também o status: o status sobe, a rota boa fica.
  const trocouDeRota = [linha(8, {
    operacao: "UPDATE", registro: "p3",
    antes: { id: "p3", franchiseeId: "L", status: "PRONTO", routeId: "r1" },
    depois: { id: "p3", franchiseeId: "L", status: "SAIU", routeId: "r-sumiu-3" },
  })];
  const r4 = await pg.transaction((tx: any) => aplicarLote(banco(tx), "L", "banco-1", trocouDeRota, null, true));
  const p3 = (await pg.query(`SELECT status, "routeId" FROM "CustomerOrder" WHERE id = 'p3'`)).rows[0] as { status: string; routeId: string | null };
  confere(
    "a troca para a rota que não subiu não apaga a rota boa da nuvem (o resto da mudança sobe)",
    r4.aplicadas === 1 && r4.conflitos === 1 && p3?.status === "SAIU" && p3?.routeId === "r1",
    { r4, p3 },
  );
  // Subida forjada com a chave da contingência: papel e grupo não sobem, o
  // que é da operação (loja aberta) sobe.
  await pg.exec(`ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'FRANCHISEE', ADD COLUMN "accountGroupId" TEXT, ADD COLUMN "storeOpen" BOOLEAN NOT NULL DEFAULT false`);
  const viraAdmin = [linha(9, {
    tabela: "User", operacao: "UPDATE", registro: "L",
    antes: null,
    depois: { id: "L", role: "ADMIN", accountGroupId: "outra-loja", storeOpen: true },
  })];
  const r5 = await pg.transaction((tx: any) => aplicarLote(banco(tx), "L", "banco-1", viraAdmin, null, true));
  const dono = (await pg.query(`SELECT role, "accountGroupId", "storeOpen" FROM "User" WHERE id = 'L'`)).rows[0] as { role: string; accountGroupId: string | null; storeOpen: boolean };
  confere(
    "a subida não grava role nem accountGroupId na linha da loja (o storeOpen sobe)",
    dono?.role === "FRANCHISEE" && dono?.accountGroupId === null && dono?.storeOpen === true,
    { r5, dono },
  );
  await pg.close();
}

subidaNoPostgres()
  .catch((e) => {
    falhas++;
    console.log(`❌ subida no Postgres — ${e?.stack || e}`);
  })
  .then(() => {
    console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
    if (falhas) process.exit(1);
  });
