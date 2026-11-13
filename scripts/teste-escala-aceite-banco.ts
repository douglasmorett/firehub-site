/**
 * O que o Lucas (Frangoso) pediu em 13/11/2026, NO BANCO (lib/escala-da-equipe):
 * a última vaga continua travada, o valor da diária por função e por dia, o
 * aceite pelo WhatsApp (gravado UMA vez, com telefone/IP/aparelho, e desfeito
 * quando o turno muda), a mensagem que sai — ou não — e os dados do PDF.
 * Cria e apaga os próprios dados (função "Aceite …").
 *
 * Só no banco local descartável dos tutoriais (PGlite) — recusa qualquer outro:
 *   eval "$(node tutoriais/ambiente/ambiente.mjs variaveis 60)" && npx tsx scripts/teste-escala-aceite-banco.ts
 * (precisa da loja demo da semente: node tutoriais/ambiente/semente.mjs)
 * Nenhuma mensagem sai de verdade: o teste apaga a chave do gateway antes.
 */
import { prisma } from "@/lib/prisma";
import {
  ErroDaEscala, aceitarTurnos, configDaLoja, criarTurnos, editarTurno, escalaDaPessoa, inscrever, itensDePagamento, pessoasDaLoja, salvarFreelancer,
  salvarValor, turnosDoPeriodo, valoresDaLoja,
} from "@/lib/escala-da-equipe/banco";
import { avisarPessoa, caminhoDoLinkPessoal, pessoaDoToken } from "@/lib/escala-da-equipe/aviso";
import { agoraDaLoja, resumoDaEscalaPessoal, somarDias } from "@/lib/escala-da-equipe/regras";

if (!/@(localhost|127\.0\.0\.1):/.test(process.env.DATABASE_URL || "")) throw new Error("Só no banco local.");
// Nenhum WhatsApp de verdade: sem a chave, o envio falha antes de sair (e o teste confere o "falhou").
delete process.env.EVOLUTION_API_KEY;
process.env.NEXTAUTH_SECRET ||= "teste-local";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const codigoDoErro = async (f: () => Promise<unknown>) => {
  try { await f(); return "ok"; } catch (e) { return e instanceof ErroDaEscala ? e.codigo || `${e.status}:${e.message}` : `?? ${(e as Error).message}`; }
};

async function main() {
  const loja = await prisma.user.findFirst({ where: { email: "demo@tutorial.local" }, select: { id: true, storeTimezone: true } });
  if (!loja) throw new Error("Sem a loja demo — rode a semente.");
  const L = loja.id;
  const hoje = agoraDaLoja(loja.storeTimezone).data;
  const d1 = somarDias(hoje, 1), d2 = somarDias(hoje, 2), d3 = somarDias(hoje, 3);
  const FUNCAO = `Aceite ${Date.now().toString(36)}`;
  await criarTurnos(L, [
    { data: d1, inicio: "18:00", fim: "23:00", funcao: FUNCAO, vagas: 1, obs: "a última vaga" },
    { data: d2, inicio: "18:00", fim: "23:00", funcao: FUNCAO, vagas: 3, obs: null },
    { data: d3, inicio: "11:00", fim: "15:00", funcao: FUNCAO, vagas: 3, obs: null },
  ], "teste");
  const turnos = (await turnosDoPeriodo(L, d1, d3)).filter((t) => t.funcao === FUNCAO);
  const turnoDe = (d: string) => turnos.find((t) => t.data === d)!;
  const ana = await salvarFreelancer(L, { nome: "Ana Aceite", telefone: "22 99222-0001", funcao: FUNCAO }, { podeVerDiaria: true });
  const bia = await salvarFreelancer(L, { nome: "Bia Aceite", telefone: "22 99222-0002", funcao: FUNCAO }, { podeVerDiaria: true });
  const caio = await salvarFreelancer(L, { nome: "Caio Sem Zap", funcao: FUNCAO }, { podeVerDiaria: true });
  const P = (id: string, nome: string) => ({ tipo: "freelancer" as const, id, nome });

  console.log("— A última vaga continua travada —");
  const [r1, r2] = await Promise.allSettled([
    inscrever(L, turnoDe(d1).id, P(ana, "Ana Aceite"), { origem: "link", comChave: true }),
    inscrever(L, turnoDe(d1).id, P(bia, "Bia Aceite"), { origem: "link", comChave: true }),
  ]);
  const entrou = [r1, r2].filter((r) => r.status === "fulfilled").length;
  const recusa = [r1, r2].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  confere("duas na última vaga ao mesmo tempo: só uma entra", entrou, 1);
  confere("…a outra ouve 'as vagas acabaram'", recusa?.reason instanceof ErroDaEscala ? recusa.reason.codigo : "?", "CHEIO");
  const quemEntrou = r1.status === "fulfilled" ? ana : bia;
  const quemSobrou = quemEntrou === ana ? bia : ana;
  const nomeDe = (id: string) => (id === ana ? "Ana Aceite" : id === bia ? "Bia Aceite" : "Caio Sem Zap");

  // Os outros turnos: quem sobrou vai no d2 e no d3; Caio (sem WhatsApp) no d2.
  const insD2 = await inscrever(L, turnoDe(d2).id, P(quemSobrou, nomeDe(quemSobrou)), { origem: "painel" });
  const insD3 = await inscrever(L, turnoDe(d3).id, P(quemSobrou, nomeDe(quemSobrou)), { origem: "painel" });
  await inscrever(L, turnoDe(d2).id, P(caio, "Caio Sem Zap"), { origem: "painel" });

  console.log("— Valor da diária por função e por dia —");
  await salvarValor(L, { funcao: FUNCAO, valor: "60,00" }, "Dono");
  await salvarValor(L, { funcao: FUNCAO, valor: "65" }, "Dono"); // trocar não duplica
  await salvarValor(L, { funcao: FUNCAO, data: d2, valor: "100" }, "Dono");
  const daFuncao = (await valoresDaLoja(L)).filter((v) => v.funcao === FUNCAO);
  confere("um valor normal e um do dia (trocar o valor não duplica)", daFuncao.map((v) => [v.data, v.valor]), [[null, 65], [d2, 100]]);
  let minha = await escalaDaPessoa(L, { tipo: "freelancer", id: quemSobrou }, d1, d3);
  confere("a escala da pessoa: d2 vale o do dia (100), d3 o da função (65)", minha.map((t) => [t.data, t.valor]), [[d2, 100], [d3, 65]]);
  await salvarFreelancer(L, { nome: nomeDe(quemSobrou), telefone: quemSobrou === ana ? "22 99222-0001" : "22 99222-0002", funcao: FUNCAO, diaria: "70" }, { id: quemSobrou, podeVerDiaria: true });
  minha = await escalaDaPessoa(L, { tipo: "freelancer", id: quemSobrou }, d1, d3);
  confere("com diária própria (70): o dia continua 100, o resto passa a 70", minha.map((t) => t.valor), [100, 70]);
  const pessoas = await pessoasDaLoja(L, { inativos: true });
  const itens = await itensDePagamento(L, (await turnosDoPeriodo(L, d1, d3)).filter((t) => t.funcao === FUNCAO), pessoas);
  confere("o 'a pagar' usa a mesma diária do turno", itens.filter((i) => i.pessoaId === quemSobrou).map((i) => i.diaria), [100, 70]);
  confere("Caio sem diária própria: vale o valor do dia da função (100)", itens.find((i) => i.pessoaId === caio)?.diaria, 100);
  await salvarValor(L, { funcao: FUNCAO, data: d2, valor: "" }, "Dono");
  confere("valor vazio apaga o do dia", (await valoresDaLoja(L)).filter((v) => v.funcao === FUNCAO).length, 1);
  confere("função vazia é recusada", await codigoDoErro(() => salvarValor(L, { funcao: "", valor: "10" }, "Dono")), "400:Escolha a função.");

  console.log("— O aviso pelo WhatsApp da loja —");
  confere("Caio sem WhatsApp: não manda e marca 'sem-whatsapp'", (await avisarPessoa(L, { tipo: "freelancer", id: caio }, "painel")).status, "sem-whatsapp");
  confere("sem o gateway (teste), o envio falha e fica 'falhou' — nada sai", (await avisarPessoa(L, { tipo: "freelancer", id: quemSobrou }, "painel")).status, "falhou");
  let doTurno = (await turnosDoPeriodo(L, d2, d2)).find((t) => t.funcao === FUNCAO)!;
  confere("a tela vê o status de cada um", doTurno.inscritos.map((i) => [i.nome, i.avisoStatus]).sort(), [["Caio Sem Zap", "sem-whatsapp"], [nomeDe(quemSobrou), "falhou"]].sort());
  // Uma mensagem que SAIU agora há pouco (como se o gateway tivesse mandado):
  await prisma.$executeRaw`UPDATE "EscalaInscricao" SET "avisoStatus" = 'enviado', "avisoEm" = (now() AT TIME ZONE 'UTC') WHERE "id" = ${insD2.id}`;
  confere("recebeu há instantes: a próxima vai 'junto' (sem outra mensagem)", (await avisarPessoa(L, { tipo: "freelancer", id: quemSobrou }, "painel")).status, "junto");
  confere("o 'pedir aceite' do gerente no mesmo minuto espera", (await avisarPessoa(L, { tipo: "freelancer", id: quemSobrou }, "manual")).status, "espera");

  console.log("— O aceite: uma vez só, com a prova —");
  const prova = { telefone: "22 99222-0001", ip: "203.0.113.7", agente: "Mozilla/5.0 (Linux; Android 14) Teste" };
  confere("aceitar os 2 turnos", await aceitarTurnos(L, { ...P(quemSobrou, nomeDe(quemSobrou)), diaria: 70 }, [insD2.id, insD3.id], prova), 2);
  confere("aceitar de novo não grava outra vez", await aceitarTurnos(L, { ...P(quemSobrou, nomeDe(quemSobrou)), diaria: 70 }, [insD2.id, insD3.id], prova), 0);
  confere("ninguém aceita pelo colega (inscrição de outra pessoa)", await aceitarTurnos(L, { tipo: "freelancer", id: caio, nome: "Caio Sem Zap", diaria: null }, [insD2.id], prova), 0);
  const provas = await prisma.$queryRaw<{ telefone: string; ip: string; agente: string; termos: string; valor: number }[]>`
    SELECT "telefone", "ip", "agente", "termos", "valor" FROM "EscalaAceite" WHERE "inscricaoId" = ANY(${[insD2.id, insD3.id]}) ORDER BY "data"`;
  confere("2 provas gravadas (não 4)", provas.length, 2);
  confere("a prova tem telefone, IP e aparelho", [provas[0].telefone, provas[0].ip, provas[0].agente], [prova.telefone, prova.ip, prova.agente]);
  confere("…e o turno por extenso com o valor daquele dia", [provas[0].termos.endsWith(`18:00 às 23:00 · ${FUNCAO}`), provas[0].valor], [true, 70]);
  doTurno = (await turnosDoPeriodo(L, d2, d2)).find((t) => t.funcao === FUNCAO)!;
  confere("a tela vê 'aceito' com a hora", typeof doTurno.inscritos.find((i) => i.id === insD2.id)?.aceitoEm, "string");
  confere("aceitou: a próxima mensagem já pode sair (nada pendente = 'nada')", (await avisarPessoa(L, { tipo: "freelancer", id: quemSobrou }, "painel")).status, "nada");

  console.log("— Mudou o turno: o aceite volta a 'aguardando' —");
  const t3 = turnoDe(d3);
  await editarTurno(L, t3.id, { data: t3.data, inicio: t3.inicio, fim: t3.fim, funcao: t3.funcao, vagas: 5, obs: "só mais vagas" });
  confere("mudar só as vagas/observação não mexe no aceite", typeof (await escalaDaPessoa(L, { tipo: "freelancer", id: quemSobrou }, d3, d3))[0].aceitoEm, "string");
  await editarTurno(L, t3.id, { data: t3.data, inicio: "12:00", fim: t3.fim, funcao: t3.funcao, vagas: 5, obs: null });
  confere("mudar o horário: volta a aguardando", (await escalaDaPessoa(L, { tipo: "freelancer", id: quemSobrou }, d3, d3))[0].aceitoEm, null);
  const [ainda] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "EscalaAceite" WHERE "inscricaoId" = ${insD3.id}`;
  confere("…mas a prova do aceite antigo continua guardada", ainda.n, 1);

  console.log("— O PDF da pessoa —");
  const doMes = await escalaDaPessoa(L, { tipo: "freelancer", id: quemSobrou }, d1, d3);
  confere("os números do PDF: 2 turnos, 1 aceito, 1 aguardando, previsto 140", resumoDaEscalaPessoal(doMes), { turnos: 2, total: 140, semValor: 0, aceitos: 1, aguardando: 1 });

  console.log("— O link pessoal —");
  const { codigo } = await configDaLoja(L);
  const caminho = caminhoDoLinkPessoal(codigo, { tipo: "freelancer", id: quemSobrou });
  confere("o link é /escala/<código>/minha/<token>", caminho.startsWith(`/escala/${codigo}/minha/f`), true);
  confere("o token volta para a mesma pessoa", pessoaDoToken(codigo, caminho.split("/").pop()!), { tipo: "freelancer", id: quemSobrou });

  // Limpeza: o que este teste criou.
  const ids = turnos.map((t) => t.id);
  await prisma.$executeRaw`DELETE FROM "EscalaAceite" WHERE "lojaId" = ${L} AND "turnoId" = ANY(${ids})`;
  await prisma.$executeRaw`DELETE FROM "EscalaTurno" WHERE "id" = ANY(${ids})`;
  await prisma.$executeRaw`DELETE FROM "EscalaValor" WHERE "lojaId" = ${L} AND "funcao" = ${FUNCAO}`;
  await prisma.$executeRaw`DELETE FROM "EscalaPessoa" WHERE "lojaId" = ${L} AND "id" = ANY(${[ana, bia, caio]})`;

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
