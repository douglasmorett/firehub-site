/**
 * BILL NA EQUIPE — "quem está de motoboy hoje?", "cadastra o Jefinho de
 * motoboy, 22 99999-0000", "desativa o Carlos", "quanto tenho que pagar aos
 * motoboys hoje?".
 *
 *   motoboys           → o cadastro da tela Motoboys (api/motoboys e
 *                        api/motoboys/[id]): criar com senha sorteada (volta
 *                        UMA vez para o dono passar ao entregador) e o
 *                        `active` do botão pausar. Entregas e a receber do dia
 *                        saem do acerto (abaixo).
 *   funcionarios       → o fiado de funcionários (/store/funcionarios,
 *                        StoreEmployee) e os garçons (/store/garcons, Waiter):
 *                        só o `active`. Permissão e senha ficam no painel.
 *   acerto_do_motoboy  → o relatório "Acerto de entregadores"
 *                        (montarRelatorioDosEntregadores + acertoDaEquipe), a
 *                        mesma conta da tela Motoboys e do app do entregador.
 */
import { Type } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { SENHA_PADRAO, hashDeSenha } from "@/lib/motoboy-senha";
import { gerarSenhaDeNumeros } from "@/lib/senha-gerada";
import { ehAMesmaPessoa, tirarDoFiado } from "@/lib/fiado-do-motoboy";
import { montarRelatorioDosEntregadores } from "@/lib/relatorio-do-entregador";
import { acertoDaEquipe, type MotoboyDoAcerto, type ResultadoDoAcerto } from "@/lib/relatorios/acerto-de-entregadores";
import { janelaDoPeriodo } from "@/lib/relatorios/janela";
import { hojeNaLoja } from "@/lib/relatorios/base";
import type { ContextoDoAssessor } from "../ferramentas";
import { PARAMETRO_CONFIRMADO, pedirConfirmacao, reais, registrarNoBill, semAcento, type ModuloDoBill, type Resultado } from "../modulo";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Acha um item pelo nome que o dono falou: igual (sem acento/maiúscula) vence;
 * senão, todas as palavras dentro do nome ("coca lata" acha "Coca-Cola lata
 * 350ml"). Mais de um = pergunta qual.
 */
export function escolherPeloNome<T extends { nome: string }>(lista: T[], texto: string): { um: T } | { varios: T[] } | { nenhum: true } {
  const alvo = semAcento(String(texto || "")).trim();
  if (!alvo) return { nenhum: true };
  const iguais = lista.filter((x) => semAcento(x.nome).trim() === alvo);
  if (iguais.length === 1) return { um: iguais[0] };
  const palavras = alvo.split(/[\s\-/]+/).filter((p) => p.length > 1).map((p) => p.replace(/s$/, ""));
  const achados = lista.filter((x) => {
    const nome = semAcento(x.nome);
    return palavras.length > 0 && palavras.every((p) => nome.includes(p));
  });
  if (achados.length === 1) return { um: achados[0] };
  if (achados.length > 1) return { varios: achados };
  return { nenhum: true };
}

/** O fuso da loja: o WhatsApp não manda no contexto. */
export async function fusoDaLoja(ctx: ContextoDoAssessor): Promise<string> {
  if (ctx.timezone) return ctx.timezone;
  const u = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { storeTimezone: true } });
  return u?.storeTimezone || "America/Sao_Paulo";
}

/** O acerto do período, pela conta do relatório (a janela fecha no último instante, como na rota). */
async function acertoDoPeriodo(ctx: ContextoDoAssessor, de: string, ate: string): Promise<ResultadoDoAcerto> {
  const tz = await fusoDaLoja(ctx);
  const { inicio, fim } = janelaDoPeriodo(de, ate, tz);
  const { report } = await montarRelatorioDosEntregadores({ lojaId: ctx.franchiseeId, fromDate: inicio, toDate: new Date(fim.getTime() - 1), tz });
  return acertoDaEquipe([{ loja: "Loja", report: report as unknown as MotoboyDoAcerto[] }], tz);
}

/** "a loja paga R$ 40" / "ele devolve R$ 12" — o saldo do acerto em palavras. */
export function saldoEmPalavras(saldo: number): string {
  if (Math.abs(saldo) < 0.005) return "acertado (saldo zero)";
  return saldo > 0 ? `a loja paga ${reais(saldo)}` : `ele devolve ${reais(-saldo)}`;
}

// ── motoboys ──────────────────────────────────────────────────────────────

async function motoboysDaLoja(ctx: ContextoDoAssessor) {
  return prisma.motoboy.findMany({
    where: { franchiseeId: ctx.franchiseeId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, phone: true, active: true, franchiseeId: true },
  });
}

async function acharMotoboy(args: any, ctx: ContextoDoAssessor): Promise<{ motoboy: Awaited<ReturnType<typeof motoboysDaLoja>>[number] } | { erro: Resultado }> {
  const todos = await motoboysDaLoja(ctx);
  const porId = args?.motoboyId ? todos.find((m) => m.id === String(args.motoboyId)) : null;
  if (porId) return { motoboy: porId };
  const r = escolherPeloNome(todos.map((m) => ({ ...m, nome: m.name })), String(args?.nome || ""));
  if ("um" in r) return { motoboy: r.um };
  if ("varios" in r) return { erro: { ok: false, erro: "Mais de um motoboy com esse nome: pergunte qual.", opcoes: r.varios.map((m) => ({ id: m.id, nome: m.name, ativo: m.active })) } };
  return { erro: { ok: false, erro: "Motoboy não encontrado nesta loja.", cadastrados: todos.map((m) => m.name) } };
}

async function motoboys(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const acao = String(args?.acao || "LISTAR").toUpperCase();

  if (acao === "LISTAR") {
    const hoje = hojeNaLoja(await fusoDaLoja(ctx));
    const [todos, acerto] = await Promise.all([motoboysDaLoja(ctx), acertoDoPeriodo(ctx, hoje, hoje)]);
    const doDia = new Map(acerto.linhas.map((l) => [l.id, l]));
    const lista = todos.map((m) => {
      const l = doDia.get(m.id);
      return { id: m.id, nome: m.name, telefone: m.phone || undefined, ativo: m.active, entregasHoje: l?.entregas ?? 0, naRuaAgora: l?.naRua || undefined, aReceberHoje: l ? reais(l.aPagar) : undefined };
    });
    const ativos = lista.filter((m) => m.ativo).length;
    return { ok: true, resumo: `${ativos} motoboy(s) ativo(s) de ${lista.length}; ${acerto.total.entregas} entrega(s) hoje.`, motoboys: lista };
  }

  if (acao === "CADASTRAR") {
    const nome = String(args?.nome || "").trim().slice(0, 80);
    if (!nome) return { ok: false, erro: "Diga o nome do motoboy." };
    const telefone = String(args?.telefone || "").trim().slice(0, 30) || null;
    const jaTem = (await motoboysDaLoja(ctx)).find((m) => ehAMesmaPessoa({ franchiseeId: ctx.franchiseeId, name: nome, phone: telefone }, m));
    if (jaTem) return { ok: false, erro: `Já existe o motoboy "${jaTem.name}" (${jaTem.active ? "ativo" : "desativado"}). Para voltar com ele, use ATIVAR.` };
    // Como a tela sem senha digitada: sorteia uma e ela volta só agora.
    const senhaGerada = gerarSenhaDeNumeros();
    const m = await prisma.motoboy.create({
      data: { franchiseeId: ctx.franchiseeId, name: nome, phone: telefone, password: await hashDeSenha(senhaGerada), paymentType: "PER_DELIVERY" },
      select: { id: true, name: true },
    });
    await registrarNoBill(ctx, "EQUIPE_MOTOBOY_NOVO", `Motoboy cadastrado: ${m.name}`, { motoboyId: m.id });
    return {
      ok: true,
      resumo: `Motoboy ${m.name} cadastrado.`,
      senhaDoApp: senhaGerada,
      observacao: `Passe ao dono a senha do App do Motoboy (${senhaGerada}${senhaGerada === SENHA_PADRAO ? ", a padrão" : ""}): ela não aparece de novo. Como ele recebe (por entrega, diária, km) o dono ajusta na tela Motoboys.`,
    };
  }

  if (acao === "ATIVAR" || acao === "DESATIVAR") {
    const achado = await acharMotoboy(args, ctx);
    if ("erro" in achado) return achado.erro;
    const m = achado.motoboy;
    const ativo = acao === "ATIVAR";
    if (m.active === ativo) return { ok: true, resumo: `${m.name} já estava ${ativo ? "ativo" : "desativado"}.` };
    if (!ativo) {
      const pergunta = pedirConfirmacao(args, `Vou desativar o motoboy ${m.name}: ele sai da lista de despacho e não entra mais no app.`);
      if (pergunta) return pergunta;
    }
    // O mesmo `active` do PUT api/motoboys/[id]. Pausar não tira do fiado.
    await prisma.motoboy.update({ where: { id: m.id, franchiseeId: ctx.franchiseeId }, data: { active: ativo } });
    const resumo = `Motoboy ${m.name} ${ativo ? "ativado" : "desativado"}`;
    await registrarNoBill(ctx, "EQUIPE_MOTOBOY_ATIVO", resumo, { motoboyId: m.id, anterior: m.active });
    return { ok: true, resumo };
  }

  return { ok: false, erro: "Ação inválida: use LISTAR, CADASTRAR, ATIVAR ou DESATIVAR." };
}

// ── funcionarios ──────────────────────────────────────────────────────────

type Pessoa = { id: string; nome: string; funcao: string; ativo: boolean; tabela: "FUNCIONARIO" | "GARCOM" };

async function funcionariosDaLoja(ctx: ContextoDoAssessor): Promise<Pessoa[]> {
  const [cadastros, garcons, motoboys] = await Promise.all([
    prisma.storeEmployee.findMany({ where: { franchiseeId: ctx.franchiseeId }, orderBy: { name: "asc" }, select: { id: true, franchiseeId: true, name: true, phone: true, role: true, active: true } }),
    prisma.waiter.findMany({ where: { franchiseeId: ctx.franchiseeId }, orderBy: { name: "asc" }, select: { id: true, franchiseeId: true, name: true, phone: true, active: true } }),
    prisma.motoboy.findMany({ where: { franchiseeId: ctx.franchiseeId }, select: { franchiseeId: true, name: true, phone: true } }),
  ]);
  // O fiado espelha motoboys e garçons (lib/fiado-do-motoboy.ts): o espelho
  // não entra aqui — a pessoa aparece uma vez só, na tabela de onde vem.
  const equipe = [...motoboys, ...garcons];
  return [
    ...cadastros.filter((c) => !equipe.some((m) => ehAMesmaPessoa(m, c))).map((c): Pessoa => ({ id: c.id, nome: c.name, funcao: c.role || "Funcionário", ativo: c.active, tabela: "FUNCIONARIO" })),
    ...garcons.map((g): Pessoa => ({ id: g.id, nome: g.name, funcao: "Garçom", ativo: g.active, tabela: "GARCOM" })),
  ];
}

async function mudarAtivo(p: Pessoa, ativo: boolean, ctx: ContextoDoAssessor) {
  // StoreEmployee: o `active` do PATCH/DELETE de api/store/employees/[id];
  // Waiter: o `active` do PUT de api/store/waiters.
  if (p.tabela === "GARCOM") await prisma.waiter.update({ where: { id: p.id, franchiseeId: ctx.franchiseeId }, data: { active: ativo } });
  else await prisma.storeEmployee.update({ where: { id: p.id, franchiseeId: ctx.franchiseeId }, data: { active: ativo } });
}

async function funcionarios(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const acao = String(args?.acao || "LISTAR").toUpperCase();
  const todos = await funcionariosDaLoja(ctx);

  if (acao === "LISTAR") {
    return {
      ok: true,
      resumo: `${todos.filter((p) => p.ativo).length} ativo(s) de ${todos.length}.`,
      equipe: todos.map((p) => ({ id: p.id, nome: p.nome, funcao: p.funcao, ativo: p.ativo })),
      observacao: "Motoboys estão em 'motoboys'. Acesso ao painel, permissões e senhas o dono muda no painel (Equipe).",
    };
  }

  if (acao === "ATIVAR" || acao === "DESATIVAR") {
    const porId = args?.id ? todos.find((p) => p.id === String(args.id)) : null;
    const r = porId ? { um: porId } : escolherPeloNome(todos, String(args?.nome || ""));
    if ("varios" in r) return { ok: false, erro: "Mais de uma pessoa com esse nome: pergunte qual.", opcoes: r.varios.map((p) => ({ id: p.id, nome: p.nome, funcao: p.funcao })) };
    if (!("um" in r)) return { ok: false, erro: "Não achei essa pessoa na equipe (se for motoboy, use 'motoboys').", equipe: todos.map((p) => p.nome) };
    const p = r.um;
    const ativo = acao === "ATIVAR";
    if (p.ativo === ativo) return { ok: true, resumo: `${p.nome} já estava ${ativo ? "ativo" : "desativado"}.` };
    if (!ativo) {
      const pergunta = pedirConfirmacao(args, `Vou desativar ${p.nome} (${p.funcao})${p.tabela === "GARCOM" ? ": ele não entra mais no app do garçom" : ": sai da lista do fiado, o histórico fica"}.`);
      if (pergunta) return pergunta;
    }
    await mudarAtivo(p, ativo, ctx);
    const resumo = `${p.funcao} ${p.nome} ${ativo ? "ativado" : "desativado"}`;
    await registrarNoBill(ctx, "EQUIPE_FUNCIONARIO_ATIVO", resumo, { id: p.id, tabela: p.tabela, anterior: p.ativo });
    return { ok: true, resumo };
  }

  return { ok: false, erro: "Ação inválida: use LISTAR, ATIVAR ou DESATIVAR." };
}

// ── acerto_do_motoboy ─────────────────────────────────────────────────────

async function acertoDoMotoboy(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const hoje = hojeNaLoja(await fusoDaLoja(ctx));
  const de = DIA_RE.test(String(args?.de || "")) ? String(args.de) : hoje;
  const ate = DIA_RE.test(String(args?.ate || "")) ? String(args.ate) : de;
  if (de > hoje) return { ok: false, erro: `O período começa no futuro (${de}); hoje é ${hoje}.` };
  if (ate < de) return { ok: false, erro: "O fim do período é antes do começo." };

  const acerto = await acertoDoPeriodo(ctx, de, ate);
  let linhas = acerto.linhas;
  if (String(args?.motoboy || "").trim()) {
    const r = escolherPeloNome(linhas, String(args.motoboy));
    if ("varios" in r) return { ok: false, erro: "Mais de um motoboy com esse nome: pergunte qual.", opcoes: r.varios.map((l) => l.nome) };
    if (!("um" in r)) return { ok: true, resumo: `${args.motoboy} não fez entrega no período.`, periodo: { de, ate } };
    linhas = [r.um];
  }
  const t = acerto.total;
  return {
    ok: true,
    resumo: linhas.length === 1
      ? `${linhas[0].nome}: ${linhas[0].entregas} entrega(s), a receber ${reais(linhas[0].aPagar)}; ${saldoEmPalavras(linhas[0].saldo)}.`
      : `${t.entregas} entrega(s); a equipe tem ${reais(t.aPagar)} a receber; ${saldoEmPalavras(t.saldo)} no total.`,
    periodo: { de, ate },
    porMotoboy: linhas.map((l) => ({
      nome: l.nome, entregas: l.entregas, aReceber: reais(l.aPagar), diaria: l.diaria ? reais(l.diaria) : undefined, porEntrega: l.porEntrega ? reais(l.porEntrega) : undefined,
      pendencias: l.pendencias ? reais(l.pendencias) : undefined, dinheiroComEle: l.dinheiroComEle ? reais(l.dinheiroComEle) : undefined, saldo: saldoEmPalavras(l.saldo),
    })),
    semEntrega: acerto.semEntrega.length ? acerto.semEntrega.filter((s) => s.ativo).map((s) => s.nome) : undefined,
    avisos: acerto.avisos.length ? acerto.avisos.map((a) => a.texto) : undefined,
    observacao: "A receber = diária + entregas − lanche acima do combinado − pendências. Saldo = a receber − dinheiro que ficou com ele. Mesma conta do relatório Acerto de entregadores.",
  };
}

// ── O módulo ──────────────────────────────────────────────────────────────

async function desfazer(tipo: string, refs: any, ctx: ContextoDoAssessor): Promise<Resultado | null> {
  if (tipo === "EQUIPE_MOTOBOY_ATIVO") {
    const r = await prisma.motoboy.updateMany({ where: { id: String(refs.motoboyId), franchiseeId: ctx.franchiseeId }, data: { active: Boolean(refs.anterior) } });
    return r.count ? { ok: true } : { ok: false, erro: "Esse motoboy não existe mais." };
  }
  if (tipo === "EQUIPE_MOTOBOY_NOVO") {
    const m = await prisma.motoboy.findFirst({ where: { id: String(refs.motoboyId), franchiseeId: ctx.franchiseeId }, select: { id: true, franchiseeId: true, name: true, phone: true } });
    if (!m) return { ok: true };
    // Com entrega no nome dele, apagar levaria o histórico do acerto.
    const entregas = await prisma.customerOrder.count({ where: { motoboyId: m.id } });
    if (entregas > 0) return { ok: false, erro: `${m.name} já tem entrega registrada: em vez de apagar, desative.` };
    // O mesmo do Excluir da tela (DELETE api/motoboys/[id]).
    await prisma.motoboy.delete({ where: { id: m.id } });
    await tirarDoFiado(m);
    return { ok: true };
  }
  if (tipo === "EQUIPE_FUNCIONARIO_ATIVO") {
    const onde = { where: { id: String(refs.id), franchiseeId: ctx.franchiseeId }, data: { active: Boolean(refs.anterior) } };
    const r = refs.tabela === "GARCOM" ? await prisma.waiter.updateMany(onde) : await prisma.storeEmployee.updateMany(onde);
    return r.count ? { ok: true } : { ok: false, erro: "Esse cadastro não existe mais." };
  }
  return null;
}

export const MODULO_EQUIPE: ModuloDoBill = {
  nome: "equipe",
  declaracoes: [
    {
      name: "motoboys",
      description: "Motoboys da loja: LISTAR (ativos, entregas e quanto cada um tem a receber hoje), CADASTRAR um novo (nome e telefone), ATIVAR ou DESATIVAR um (desativar pede confirmação).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          acao: { type: Type.STRING, enum: ["LISTAR", "CADASTRAR", "ATIVAR", "DESATIVAR"] },
          nome: { type: Type.STRING, description: "nome do motoboy como o dono disse" },
          telefone: { type: Type.STRING, description: "só no CADASTRAR, se ele disse" },
          motoboyId: { type: Type.STRING, description: "id vindo do LISTAR, quando houver mais de um com o mesmo nome" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["acao"],
      },
    },
    {
      name: "funcionarios",
      description: "Funcionários (fiado) e garçons da loja: LISTAR (nome, função, ativo), ATIVAR ou DESATIVAR (desativar pede confirmação). Não mexe em acesso, permissão nem senha.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          acao: { type: Type.STRING, enum: ["LISTAR", "ATIVAR", "DESATIVAR"] },
          nome: { type: Type.STRING },
          id: { type: Type.STRING, description: "id vindo do LISTAR, quando houver mais de um com o mesmo nome" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["acao"],
      },
    },
    {
      name: "acerto_do_motoboy",
      description: "Quanto cada motoboy tem a receber (diária + entregas − pendências) e o saldo com o dinheiro que ficou com ele, de hoje ou de um período. Mesma conta do relatório Acerto de entregadores.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          de: { type: Type.STRING, description: "AAAA-MM-DD; vazio = hoje (o dia vira às 5h)" },
          ate: { type: Type.STRING, description: "AAAA-MM-DD; vazio = o mesmo de 'de'" },
          motoboy: { type: Type.STRING, description: "nome, para só um; vazio = a equipe toda" },
        },
      },
    },
  ],
  gravam: ["motoboys", "funcionarios"],
  regras: [
    "Equipe: 'motoboys' lista, cadastra e ativa/desativa entregador; 'funcionarios' faz o mesmo com funcionário do fiado e garçom (só ativo/desativado).",
    "Desativar pede confirmação: pergunte ao dono e só chame de novo com confirmado=true depois do sim.",
    "Cadastrou motoboy: passe a senhaDoApp ao dono na resposta (ela não volta). Forma de pagamento dele, permissões e senhas de acesso: no painel.",
    "'Quanto pago aos motoboys?' / 'acerto do Fulano' = acerto_do_motoboy (período com de/ate). Saldo positivo a loja paga; negativo ele devolve.",
  ].join("\n"),
  executar: async (nome, args, ctx) => {
    if (nome === "motoboys") return motoboys(args, ctx);
    if (nome === "funcionarios") return funcionarios(args, ctx);
    if (nome === "acerto_do_motoboy") return acertoDoMotoboy(args, ctx);
    return null;
  },
  tipos: ["EQUIPE_MOTOBOY_NOVO", "EQUIPE_MOTOBOY_ATIVO", "EQUIPE_FUNCIONARIO_ATIVO"],
  desfazer,
};
