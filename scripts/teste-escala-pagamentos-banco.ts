/**
 * O controle de pagamento da Escala da equipe NO BANCO (lib/escala-da-equipe/banco.ts):
 * Pix gravado e trocado pelo link, marcar pago, pagar tudo dividido, desfazer,
 * não tirar do turno (nem apagar o turno) quem já foi pago, e o motoboy com o
 * dia pago no acerto. Cria e apaga os próprios dados (função "Teste …").
 *
 * Só no banco local descartável dos tutoriais (PGlite) — recusa qualquer outro:
 *   eval "$(node tutoriais/ambiente/ambiente.mjs variaveis 60)" && npx tsx scripts/teste-escala-pagamentos-banco.ts
 * (precisa da loja demo da semente: node tutoriais/ambiente/semente.mjs)
 */
import { prisma } from "@/lib/prisma";
import {
  ErroDaEscala, aparelhoDaPessoa, apagarTurno, criarTurnos, desfazerPagamento, editarTurno, escalaDosMotoboys, gravarPixPeloLink, inscrever,
  itensDePagamento, marcarPago, pessoasDaLoja, salvarComplemento, salvarFreelancer, tirarInscricao, turnosDoPeriodo,
} from "@/lib/escala-da-equipe/banco";
import { registrarAcertoPago } from "@/lib/acerto-pago";
import { agoraDaLoja, resumoDosPagamentos, somarDias } from "@/lib/escala-da-equipe/regras";

if (!/@(localhost|127\.0\.0\.1):/.test(process.env.DATABASE_URL || "")) throw new Error("Só no banco local.");

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
  const ontem = somarDias(hoje, -1), anteontem = somarDias(hoje, -2), amanha = somarDias(hoje, 1);
  // Uma função só deste teste, para achar os turnos dele e limpar no fim.
  const FUNCAO = `Teste ${Date.now().toString(36)}`;
  await criarTurnos(L, [anteontem, ontem, hoje, amanha].map((data) => ({ data, inicio: "18:00", fim: "23:00", funcao: FUNCAO, vagas: 5, obs: null })), "teste");
  const turnos = (await turnosDoPeriodo(L, anteontem, amanha)).filter((t) => t.funcao === FUNCAO);
  const turnoDe = (d: string) => turnos.find((t) => t.data === d)!;

  console.log("— Pix no cadastro —");
  confere("Pix inválido no freelancer é recusado", await codigoDoErro(() => salvarFreelancer(L, { nome: "Zé Teste", telefone: "22 99111-0001", pix: "123" }, { podeVerDiaria: true })), "PIX_INVALIDO");
  const ze = await salvarFreelancer(L, { nome: "Zé Teste", telefone: "22 99111-0001", pix: "529.982.247-25", diaria: "80,00" }, { podeVerDiaria: true });
  let pessoas = await pessoasDaLoja(L, { inativos: true });
  const pZe = pessoas.find((p) => p.id === ze)!;
  confere("Pix gravado limpo, com o tipo, origem painel", [pZe.pix, pZe.pixTipo, pZe.pixOrigem], ["52998224725", "cpf", "painel"]);

  // Motoboy para o acerto.
  const mb = await prisma.motoboy.create({ data: { franchiseeId: L, name: "Moto Teste", phone: "22 99111-0002", paymentType: "DAILY_RATE", dailyRate: 60 }, select: { id: true } });
  await salvarComplemento(L, "motoboy", mb.id, { telefone: "22 99111-0002", funcao: "Motoboy", pix: "moto@teste.com", diaria: "" }, { podeVerDiaria: true });
  pessoas = await pessoasDaLoja(L, { inativos: true });
  confere("Pix no complemento do motoboy", pessoas.find((p) => p.id === mb.id)?.pix, "moto@teste.com");

  console.log("— Pix pelo link: troca só do aparelho —");
  const insZe = await inscrever(L, turnoDe(anteontem).id, { tipo: "freelancer", id: ze, nome: "Zé Teste" }, { origem: "link", comChave: true });
  confere("aparelho com a chave da inscrição é o dele", await aparelhoDaPessoa(L, { tipo: "freelancer", id: ze }, [insZe.chave]), true);
  confere("chave inventada não prova nada", await aparelhoDaPessoa(L, { tipo: "freelancer", id: ze }, ["chave-inventada-123"]), false);
  await gravarPixPeloLink(L, { tipo: "freelancer", id: ze, nome: "Zé Teste" }, "+5522991110001", "telefone", true);
  pessoas = await pessoasDaLoja(L, { inativos: true });
  confere("troca pelo link fica marcada para o dono conferir", pessoas.find((p) => p.id === ze)?.pixOrigem, "troca-link");
  await salvarFreelancer(L, { nome: "Zé Teste", telefone: "22 99111-0001", pix: "(22) 99111-0001", pixTipo: "telefone", diaria: "80", pixConferido: true }, { id: ze, podeVerDiaria: true });
  pessoas = await pessoasDaLoja(L, { inativos: true });
  confere("o dono marca 'conferi': o aviso some, a chave fica", [pessoas.find((p) => p.id === ze)?.pixOrigem, pessoas.find((p) => p.id === ze)?.pix], ["painel", "+5522991110001"]);

  console.log("— Marcar pago, desfazer, bloquear tirar —");
  const insZeOntem = await inscrever(L, turnoDe(ontem).id, { tipo: "freelancer", id: ze, nome: "Zé Teste" }, { origem: "painel" });
  const insZeHoje = await inscrever(L, turnoDe(hoje).id, { tipo: "freelancer", id: ze, nome: "Zé Teste" }, { origem: "painel" });
  const insZeAmanha = await inscrever(L, turnoDe(amanha).id, { tipo: "freelancer", id: ze, nome: "Zé Teste" }, { origem: "painel" });
  confere("turno de amanhã não se paga", await codigoDoErro(() => marcarPago(L, { inscricaoIds: [insZeAmanha.id], valor: null, forma: null, obs: null }, "Dono", hoje)), "FUTURO");
  confere("paga anteontem pela diária (sem digitar valor)", await marcarPago(L, { inscricaoIds: [insZe.id], valor: null, forma: "pix", obs: null }, "Dono", hoje), 1);
  confere("pagar de novo o mesmo turno é recusado", await codigoDoErro(() => marcarPago(L, { inscricaoIds: [insZe.id], valor: 80, forma: null, obs: null }, "Dono", hoje)), "JA_PAGO");
  confere("tirar do turno quem já foi pago é recusado", await codigoDoErro(() => tirarInscricao(L, insZe.id)), "PAGO");
  confere("apagar o turno com gente paga é recusado, mesmo confirmando", await codigoDoErro(() => apagarTurno(L, turnoDe(anteontem).id, true)), "PAGO");
  const t0 = turnoDe(anteontem);
  confere("mudar o dia do turno com gente paga é recusado", await codigoDoErro(() => editarTurno(L, t0.id, { data: hoje, inicio: t0.inicio, fim: t0.fim, funcao: t0.funcao, vagas: t0.vagas, obs: "x" })), "TEM_PAGAMENTO");
  confere("…mas mudar o horário no mesmo dia pode", await codigoDoErro(() => editarTurno(L, t0.id, { data: t0.data, inicio: "18:30", fim: t0.fim, funcao: t0.funcao, vagas: t0.vagas, obs: null })), "ok");

  let itens = await itensDePagamento(L, (await turnosDoPeriodo(L, anteontem, amanha)).filter((t) => t.funcao === FUNCAO), pessoas);
  let r = resumoDosPagamentos(itens.filter((i) => i.pessoaId === ze), hoje);
  confere("Zé: 3 turnos trabalhados, pago 80, pendente 160", [r.turnos, r.pago, r.pendente], [3, 80, 160]);

  console.log("— Pagar tudo com outro valor —");
  confere("pagar tudo (ontem + hoje) por R$ 150", await marcarPago(L, { inscricaoIds: [insZeOntem.id, insZeHoje.id], valor: 150, forma: "dinheiro", obs: "junto" }, "Dono", hoje), 2);
  itens = await itensDePagamento(L, (await turnosDoPeriodo(L, anteontem, amanha)).filter((t) => t.funcao === FUNCAO), pessoas);
  confere("o total foi dividido pela diária (75 + 75)", itens.filter((i) => i.pessoaId === ze && i.pagamento && i.data !== anteontem).map((i) => i.pagamento!.valor), [75, 75]);
  r = resumoDosPagamentos(itens.filter((i) => i.pessoaId === ze), hoje);
  confere("Zé: tudo pago, nada pendente", [r.pago, r.pendente], [230, 0]);

  console.log("— Desfazer —");
  const pg = itens.find((i) => i.inscricaoId === insZe.id)!.pagamento!;
  await desfazerPagamento(L, pg.id, "Dono");
  confere("desfazer de novo diz que não existe", await codigoDoErro(() => desfazerPagamento(L, pg.id, "Dono")), "404:Esse pagamento não existe ou já foi desfeito.");
  confere("depois de desfazer, tirar do turno pode", await codigoDoErro(() => tirarInscricao(L, insZe.id)), "ok");
  const [hist] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "EscalaPagamento" WHERE "id" = ${pg.id} AND "desfeitoEm" IS NOT NULL AND "desfeitoPor" = 'Dono'`;
  confere("o pagamento desfeito fica no histórico", hist.n, 1);

  console.log("— Motoboy: dia pago no acerto —");
  const insMbAnte = await inscrever(L, turnoDe(anteontem).id, { tipo: "motoboy", id: mb.id, nome: "Moto Teste" }, { origem: "painel" });
  const insMbOntem = await inscrever(L, turnoDe(ontem).id, { tipo: "motoboy", id: mb.id, nome: "Moto Teste" }, { origem: "painel" });
  await registrarAcertoPago({ lojaId: L, motoboyId: mb.id, de: anteontem, ate: anteontem, dias: [anteontem], valorDoAcerto: 60, quem: "Dono" });
  confere("dia já pago no acerto não se marca de novo na escala", await codigoDoErro(() => marcarPago(L, { inscricaoIds: [insMbAnte.id], valor: 60, forma: null, obs: null }, "Dono", hoje)), "NO_ACERTO");
  confere("dia fora do acerto: a escala paga (motoboy de diária)", await marcarPago(L, { inscricaoIds: [insMbOntem.id], valor: null, forma: "pix", obs: null }, "Dono", hoje), 1);
  itens = await itensDePagamento(L, (await turnosDoPeriodo(L, anteontem, amanha)).filter((t) => t.funcao === FUNCAO), pessoas);
  const doMb = itens.filter((i) => i.pessoaId === mb.id);
  confere("o turno do acerto aparece como 'pago no acerto' (com o dia)", doMb.find((i) => i.inscricaoId === insMbAnte.id)?.acerto?.dia, anteontem);
  const e = (await escalaDosMotoboys(L, anteontem, ontem))[mb.id];
  confere("na tela do acerto: o Pix e o que a escala já pagou no período", [e?.pix, e?.pago, e?.dias], ["moto@teste.com", 60, [ontem]]);

  // Limpeza: o que este teste criou.
  await prisma.$executeRaw`DELETE FROM "EscalaPagamento" WHERE "lojaId" = ${L} AND "turnoId" = ANY(${turnos.map((t) => t.id)})`;
  await prisma.$executeRaw`DELETE FROM "EscalaTurno" WHERE "id" = ANY(${turnos.map((t) => t.id)})`;
  await prisma.$executeRaw`DELETE FROM "EscalaPessoa" WHERE "lojaId" = ${L} AND ("id" = ${ze} OR "refId" = ${mb.id})`;
  await prisma.$executeRaw`DELETE FROM "MotoboyAcertoPago" WHERE "motoboyId" = ${mb.id}`;
  await prisma.motoboy.delete({ where: { id: mb.id } });

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
