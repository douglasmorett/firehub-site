/**
 * Trava as regras do Modo Contingência que não dependem de banco:
 * a volta linha a linha (lib/contingencia/mescla.ts), o catálogo da cópia,
 * o bilhete e o gatilho gerado para a nuvem.
 *
 *   npx tsx scripts/teste-contingencia.ts
 */
import { decidir, iguais, type LinhaDaSaida } from "../src/lib/contingencia/mescla";
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

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
