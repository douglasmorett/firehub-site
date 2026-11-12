/**
 * ESCALA DA EQUIPE — as regras puras (sem banco), para a tela, as rotas e o
 * teste (scripts/teste-escala-da-equipe.ts) usarem a MESMA conta.
 *
 * O caso que pediu o módulo (Lucas, Frangoso, 11/2026): equipe sem carteira e
 * motoboy freelancer, turno combinado "de boca" com um e com outro — e na
 * segunda à noite sobrava motoboy, na sexta faltava. A loja abre as vagas por
 * dia e turno, o pessoal se inscreve sozinho pelo link do grupo e o dono vê
 * (e imprime) quem vem.
 *
 * ── Datas ───────────────────────────────────────────────────────────────────
 * O turno mora na data do CALENDÁRIO em que começa ("2026-11-16", 18:00–02:00).
 * Não usa a virada das 5h dos relatórios: quem olha a escala pensa "segunda à
 * noite", não "expediente de segunda". O turno que vira a meia-noite continua
 * sendo da segunda — só termina na terça.
 *
 * As contas de data são feitas em UTC sobre "YYYY-MM-DD" (meio-dia não muda de
 * dia em fuso nenhum), e "agora" é o relógio da LOJA (agoraDaLoja), nunca o do
 * servidor, que roda em UTC.
 */
import { dataDaLoja, relogioDaLoja, FUSO_PADRAO } from "@/lib/fuso";
import { mesmoTelefone, telefoneCanonico } from "@/lib/telefone";

// ── Funções e tipos ──────────────────────────────────────────────────────────

/** As funções da lista (a tela ainda aceita "Outro" com texto livre). */
export const FUNCOES = ["Motoboy", "Atendente", "Cozinha", "Chapeiro", "Caixa", "Garçom", "Auxiliar"] as const;

export type TipoDePessoa = "equipe" | "motoboy" | "freelancer";
export type OrigemDaInscricao = "link" | "painel";
export type Visao = "dia" | "semana" | "mes";

export const TIPOS_DE_PESSOA: readonly TipoDePessoa[] = ["equipe", "motoboy", "freelancer"];
export const ehTipoDePessoa = (t: unknown): t is TipoDePessoa => TIPOS_DE_PESSOA.includes(t as TipoDePessoa);

/** Limites de bom senso: um clique errado não pode criar mil turnos. */
export const MAX_VAGAS = 50;
export const MAX_TURNOS_DE_UMA_VEZ = 200;
export const MAX_DIAS_DA_REPETICAO = 92;
/** Quantos dias à frente o link público mostra (~3 semanas). */
export const DIAS_NO_LINK = 21;
/** Prazos em horas: no máximo uma semana. */
export const MAX_PRAZO_HORAS = 168;

/** "Garçom" e "garcom " são a mesma função (filtro do link, cópia da semana). */
export function chaveDaFuncao(f: string | null | undefined): string {
  return String(f || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** A função como vai para o banco: a grafia da lista quando é da lista; senão o texto limpo. */
export function normalizarFuncao(f: string | null | undefined): string {
  const limpa = String(f || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const daLista = FUNCOES.find((x) => chaveDaFuncao(x) === chaveDaFuncao(limpa));
  return daLista || limpa;
}

// ── Datas do calendário ─────────────────────────────────────────────────────

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dataValida(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = RE_DATA.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const meioDia = (data: string) => {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d, 12));
};
const paraTexto = (d: Date) => d.toISOString().slice(0, 10);

/** Dias desde 1970 — para comparar e subtrair datas sem fuso. */
export function numeroDoDia(data: string): number {
  return Math.round((meioDia(data).getTime() - Date.UTC(1970, 0, 1, 12)) / 86_400_000);
}

export function somarDias(data: string, dias: number): string {
  const d = meioDia(data);
  d.setUTCDate(d.getUTCDate() + dias);
  return paraTexto(d);
}

/** 0 = domingo … 6 = sábado (o Date do JavaScript). */
export function diaDaSemana(data: string): number {
  return meioDia(data).getUTCDay();
}

/** A segunda-feira da semana da data (a semana da escala vai de segunda a domingo). */
export function inicioDaSemana(data: string): string {
  const dow = diaDaSemana(data);
  return somarDias(data, dow === 0 ? -6 : 1 - dow);
}

export function diasDaSemanaDe(data: string): string[] {
  const seg = inicioDaSemana(data);
  return Array.from({ length: 7 }, (_, i) => somarDias(seg, i));
}

export function inicioDoMes(data: string): string {
  return `${data.slice(0, 7)}-01`;
}

export function fimDoMes(data: string): string {
  const d = meioDia(inicioDoMes(data));
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return paraTexto(d);
}

/** O período que cada visão mostra. */
export function periodoDaVisao(visao: Visao, data: string): { de: string; ate: string } {
  if (visao === "dia") return { de: data, ate: data };
  if (visao === "semana") {
    const de = inicioDaSemana(data);
    return { de, ate: somarDias(de, 6) };
  }
  return { de: inicioDoMes(data), ate: fimDoMes(data) };
}

/** A grade do mês: semanas inteiras (segunda a domingo) que cobrem o mês. */
export function semanasDoMes(data: string): string[][] {
  const primeiro = inicioDaSemana(inicioDoMes(data));
  const ultimo = fimDoMes(data);
  const semanas: string[][] = [];
  for (let seg = primeiro; numeroDoDia(seg) <= numeroDoDia(ultimo); seg = somarDias(seg, 7)) {
    semanas.push(Array.from({ length: 7 }, (_, i) => somarDias(seg, i)));
  }
  return semanas;
}

/** Anterior/próximo: um dia, uma semana ou um mês (do dia 1, para 31/01 + 1 mês não pular março). */
export function navegar(visao: Visao, data: string, passo: number): string {
  if (visao === "dia") return somarDias(data, passo);
  if (visao === "semana") return somarDias(inicioDaSemana(data), 7 * passo);
  const d = meioDia(inicioDoMes(data));
  d.setUTCMonth(d.getUTCMonth() + passo);
  return paraTexto(d);
}

export const NOMES_DOS_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const NOMES_CURTOS_DOS_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "16/11" */
export const diaEMes = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;
/** "segunda, 16/11" */
export const diaPorExtenso = (data: string) => `${NOMES_DOS_DIAS[diaDaSemana(data)]}, ${diaEMes(data)}`;
/** "novembro de 2026" */
export const mesPorExtenso = (data: string) => `${MESES[Number(data.slice(5, 7)) - 1]} de ${data.slice(0, 4)}`;

/** O título do período: "segunda, 16/11", "16/11 a 22/11", "novembro de 2026". */
export function tituloDoPeriodo(visao: Visao, data: string): string {
  const { de, ate } = periodoDaVisao(visao, data);
  if (visao === "dia") return diaPorExtenso(de);
  if (visao === "semana") return `${diaEMes(de)} a ${diaEMes(ate)}`;
  return mesPorExtenso(de);
}

// ── Horas ───────────────────────────────────────────────────────────────────

/** "18:00" → 1080. "24:00" não existe: meia-noite é "00:00". Inválido → null. */
export function lerHora(h: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(h ?? "").trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

export const horaTexto = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** O turno termina no dia seguinte? 18:00–02:00 sim; 11:00–15:00 não. */
export function viraAMeiaNoite(inicio: string, fim: string): boolean {
  const i = lerHora(inicio), f = lerHora(fim);
  return i != null && f != null && f <= i;
}

/** Duração em minutos, contando a virada da meia-noite. */
export function duracaoEmMinutos(inicio: string, fim: string): number {
  const i = lerHora(inicio), f = lerHora(fim);
  if (i == null || f == null) return 0;
  return f > i ? f - i : f + 1440 - i;
}

/** "18:00 às 02:00 (+1)" — o "+1" avisa que termina no outro dia. */
export function horarioDoTurno(inicio: string, fim: string): string {
  return `${inicio} às ${fim}${viraAMeiaNoite(inicio, fim) ? " (+1)" : ""}`;
}

// ── O turno ─────────────────────────────────────────────────────────────────

export type DadosDoTurno = { data: string; inicio: string; fim: string; funcao: string; vagas: number; obs: string | null };

/** O que veio da tela vira turno válido — ou a frase do que está errado. */
export function validarTurno(e: Record<string, unknown>): { ok: true; turno: DadosDoTurno } | { ok: false; erro: string } {
  if (!dataValida(e.data)) return { ok: false, erro: "Escolha a data do turno." };
  const i = lerHora(e.inicio), f = lerHora(e.fim);
  if (i == null) return { ok: false, erro: "Hora de início inválida (use 18:00)." };
  if (f == null) return { ok: false, erro: "Hora de fim inválida (use 23:30)." };
  if (i === f) return { ok: false, erro: "O início e o fim do turno são a mesma hora." };
  const funcao = normalizarFuncao(String(e.funcao ?? ""));
  if (!funcao) return { ok: false, erro: "Escolha a função (Motoboy, Atendente…)." };
  const vagas = Math.floor(Number(e.vagas));
  if (!Number.isFinite(vagas) || vagas < 1) return { ok: false, erro: "O turno precisa de pelo menos 1 vaga." };
  if (vagas > MAX_VAGAS) return { ok: false, erro: `No máximo ${MAX_VAGAS} vagas por turno.` };
  const obs = String(e.obs ?? "").trim().slice(0, 300) || null;
  return { ok: true, turno: { data: e.data, inicio: horaTexto(i), fim: horaTexto(f), funcao, vagas, obs } };
}

/**
 * As datas de um turno que se repete: de `de` até `ate`, só nos dias da
 * semana marcados (0 = domingo … 6 = sábado). Sem dia marcado = todo dia.
 * Recusa período maior que três meses — é engano, não escala.
 */
export function datasDaRepeticao(de: string, ate: string, dias: number[]): { ok: true; datas: string[] } | { ok: false; erro: string } {
  if (!dataValida(de) || !dataValida(ate)) return { ok: false, erro: "Escolha até quando o turno se repete." };
  const n = numeroDoDia(ate) - numeroDoDia(de);
  if (n < 0) return { ok: false, erro: "O \"repetir até\" é antes da data do turno." };
  if (n > MAX_DIAS_DA_REPETICAO) return { ok: false, erro: `Repita por no máximo ${MAX_DIAS_DA_REPETICAO} dias de uma vez.` };
  const marcados = new Set(dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  const datas: string[] = [];
  for (let k = 0; k <= n; k++) {
    const d = somarDias(de, k);
    if (marcados.size === 0 || marcados.has(diaDaSemana(d))) datas.push(d);
  }
  if (datas.length === 0) return { ok: false, erro: "Nenhum dia do período cai nos dias da semana marcados." };
  if (datas.length > MAX_TURNOS_DE_UMA_VEZ) return { ok: false, erro: `São ${datas.length} turnos — crie no máximo ${MAX_TURNOS_DE_UMA_VEZ} de uma vez.` };
  return { ok: true, datas };
}

type TurnoParaCopiar = { data: string; inicio: string; fim: string; funcao: string; vagas: number; obs?: string | null };

/** O mesmo turno (data, horário e função) — para a cópia não duplicar o que já existe. */
const assinaturaDoTurno = (t: { data: string; inicio: string; fim: string; funcao: string }) =>
  `${t.data}|${t.inicio}|${t.fim}|${chaveDaFuncao(t.funcao)}`;

/**
 * "Copiar a semana anterior": cada turno da semana de origem vai para o
 * mesmo dia da semana de destino (sem as pessoas — cada semana tem as suas
 * inscrições). O que já existe igual no destino não é criado de novo, então
 * clicar duas vezes não dobra a escala.
 */
export function copiarSemana<T extends TurnoParaCopiar>(origem: T[], semanaDeOrigem: string, semanaDeDestino: string, jaNoDestino: TurnoParaCopiar[]): DadosDoTurno[] {
  const de = inicioDaSemana(semanaDeOrigem);
  const para = inicioDaSemana(semanaDeDestino);
  const desloca = numeroDoDia(para) - numeroDoDia(de);
  const existe = new Set(jaNoDestino.map(assinaturaDoTurno));
  const novos: DadosDoTurno[] = [];
  for (const t of origem) {
    const k = numeroDoDia(t.data) - numeroDoDia(de);
    if (k < 0 || k > 6) continue; // fora da semana de origem
    const novo: DadosDoTurno = { data: somarDias(t.data, desloca), inicio: t.inicio, fim: t.fim, funcao: t.funcao, vagas: t.vagas, obs: t.obs ?? null };
    const a = assinaturaDoTurno(novo);
    if (existe.has(a)) continue;
    existe.add(a);
    novos.push(novo);
  }
  return novos;
}

export function ordenarTurnos<T extends { data: string; inicio: string; funcao: string }>(turnos: T[]): T[] {
  return [...turnos].sort((a, b) => a.data.localeCompare(b.data) || a.inicio.localeCompare(b.inicio) || a.funcao.localeCompare(b.funcao));
}

/** Dois turnos se cruzam no tempo (contando o que vira a meia-noite)? Encostar (23:00 e 23:00) não é cruzar. */
export function turnosSeSobrepoem(a: { data: string; inicio: string; fim: string }, b: { data: string; inicio: string; fim: string }): boolean {
  const comeco = (t: typeof a) => numeroDoDia(t.data) * 1440 + (lerHora(t.inicio) ?? 0);
  const ia = comeco(a), ib = comeco(b);
  const fa = ia + duracaoEmMinutos(a.inicio, a.fim), fb = ib + duracaoEmMinutos(b.inicio, b.fim);
  return ia < fb && ib < fa;
}

// ── Vagas ───────────────────────────────────────────────────────────────────

export type SituacaoDasVagas = { preenchidas: number; vagas: number; faltam: number; sobram: number; estado: "vazio" | "falta" | "completo" | "excedido" };

/** Como o turno está: a cor do cartão sai daqui (falta gente = âmbar/vermelho). */
export function situacaoDasVagas(preenchidas: number, vagas: number): SituacaoDasVagas {
  const p = Math.max(0, preenchidas), v = Math.max(0, vagas);
  const estado = p === 0 ? "vazio" : p < v ? "falta" : p === v ? "completo" : "excedido";
  return { preenchidas: p, vagas: v, faltam: Math.max(0, v - p), sobram: Math.max(0, p - v), estado };
}

// ── Prazos (no relógio da loja) ─────────────────────────────────────────────

export type AgoraDaLoja = { data: string; minutos: number };

/** "Agora" no fuso da loja: a data do calendário e os minutos desde 00:00. */
export function agoraDaLoja(fuso: string | null | undefined, agora: Date = new Date()): AgoraDaLoja {
  const tz = fuso || FUSO_PADRAO;
  return { data: dataDaLoja(tz, agora), minutos: relogioDaLoja(tz, agora).minutos };
}

/** Quantos minutos faltam para o turno começar (negativo = já começou). */
export function minutosAteOTurno(turno: { data: string; inicio: string }, agora: AgoraDaLoja): number {
  return (numeroDoDia(turno.data) - numeroDoDia(agora.data)) * 1440 + (lerHora(turno.inicio) ?? 0) - agora.minutos;
}

/** O turno já terminou? (o que vira a meia-noite termina no dia seguinte) */
export function turnoJaTerminou(turno: { data: string; inicio: string; fim: string }, agora: AgoraDaLoja): boolean {
  return minutosAteOTurno(turno, agora) + duracaoEmMinutos(turno.inicio, turno.fim) <= 0;
}

export type ConfigDaEscala = {
  /** Até quantas horas antes do início o link aceita inscrição (0 = até a hora de começar). */
  prazoInscricaoHoras: number;
  /** A pessoa pode desistir pelo link? */
  permiteDesistir: boolean;
  /** Até quantas horas antes do início pode desistir. */
  prazoDesistenciaHoras: number;
  /** As funções que aparecem no link; vazio = todas. */
  funcoesNoLink: string[];
  /** Link desligado: a página mostra "inscrições fechadas". */
  linkAtivo: boolean;
};

export const CONFIG_PADRAO: ConfigDaEscala = { prazoInscricaoHoras: 2, permiteDesistir: true, prazoDesistenciaHoras: 24, funcoesNoLink: [], linkAtivo: true };

const horas = (v: unknown, padrao: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_PRAZO_HORAS, Math.max(0, n)) : padrao;
};

/** A configuração como veio (banco ou tela), já dentro dos limites. */
export function lerConfigDaEscala(raw: Partial<Record<keyof ConfigDaEscala, unknown>> | null | undefined): ConfigDaEscala {
  const r = raw || {};
  const funcoes = Array.isArray(r.funcoesNoLink) ? r.funcoesNoLink : [];
  const vistas = new Set<string>();
  const funcoesNoLink: string[] = [];
  for (const f of funcoes) {
    const n = normalizarFuncao(String(f ?? ""));
    if (n && !vistas.has(chaveDaFuncao(n))) { vistas.add(chaveDaFuncao(n)); funcoesNoLink.push(n); }
  }
  return {
    prazoInscricaoHoras: horas(r.prazoInscricaoHoras, CONFIG_PADRAO.prazoInscricaoHoras),
    permiteDesistir: r.permiteDesistir === undefined ? CONFIG_PADRAO.permiteDesistir : r.permiteDesistir === true,
    prazoDesistenciaHoras: horas(r.prazoDesistenciaHoras, CONFIG_PADRAO.prazoDesistenciaHoras),
    funcoesNoLink,
    linkAtivo: r.linkAtivo === undefined ? CONFIG_PADRAO.linkAtivo : r.linkAtivo === true,
  };
}

/** A função aparece no link? Lista vazia = todas. */
export function funcaoNoLink(funcao: string, funcoesNoLink: string[]): boolean {
  if (!funcoesNoLink.length) return true;
  const k = chaveDaFuncao(funcao);
  return funcoesNoLink.some((f) => chaveDaFuncao(f) === k);
}

/** O link ainda aceita inscrição neste turno? */
export function inscricaoAberta(turno: { data: string; inicio: string }, agora: AgoraDaLoja, cfg: Pick<ConfigDaEscala, "prazoInscricaoHoras">): boolean {
  return minutosAteOTurno(turno, agora) >= cfg.prazoInscricaoHoras * 60 && minutosAteOTurno(turno, agora) > 0;
}

/** A pessoa ainda pode desistir pelo link? (a loja tira pelo painel a qualquer hora) */
export function desistenciaAberta(turno: { data: string; inicio: string }, agora: AgoraDaLoja, cfg: Pick<ConfigDaEscala, "permiteDesistir" | "prazoDesistenciaHoras">): boolean {
  return cfg.permiteDesistir && minutosAteOTurno(turno, agora) >= cfg.prazoDesistenciaHoras * 60 && minutosAteOTurno(turno, agora) > 0;
}

/** "até 2 h antes", "até a hora do turno". */
export function prazoFalado(horasAntes: number): string {
  if (horasAntes <= 0) return "até a hora do turno";
  if (horasAntes % 24 === 0) return `até ${horasAntes / 24} dia${horasAntes === 24 ? "" : "s"} antes`;
  return `até ${horasAntes} h antes`;
}

// ── Pessoas ─────────────────────────────────────────────────────────────────

/** Só o primeiro nome — o que o link mostra de quem já se inscreveu. */
export function primeiroNome(nome: string | null | undefined): string {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

/** O telefone dá para identificar alguém? (DDD + número; o resto é recusado) */
export const telefoneUtilizavel = (t: string | null | undefined) => telefoneCanonico(t) !== "";

/** A chave do telefone que vai para o banco (para achar e para não duplicar freelancer). */
export const chaveDoTelefone = (t: string | null | undefined) => telefoneCanonico(t);

/**
 * Quem tem este telefone? A regra de lib/telefone.ts (DDD + número; o nono
 * dígito é a única tolerância) — "22 99999-1111" e "+55 (22) 9999-1111" são a
 * mesma pessoa; "9999-1111" sem DDD não é ninguém.
 */
export function acharPeloTelefone<T extends { telefone?: string | null }>(telefone: string | null | undefined, pessoas: T[]): T | null {
  if (!telefoneUtilizavel(telefone)) return null;
  return pessoas.find((p) => mesmoTelefone(p.telefone, telefone)) ?? null;
}

export const chaveDaPessoa = (tipo: string, id: string) => `${tipo}:${id}`;

// ── Custo previsto (só o dono vê) ───────────────────────────────────────────

type TurnoComDiarias = { inscritos: Array<{ pessoaTipo: string; pessoaId: string; nome: string; diaria: number | null | undefined }> };

/**
 * Soma das diárias combinadas de quem está inscrito no período. Quem não tem
 * diária cadastrada entra na conta de "sem valor", para o dono saber que o
 * total está incompleto em vez de achar que é tudo.
 */
export function custoPrevisto(turnos: TurnoComDiarias[]): { total: number; semValor: number; porPessoa: Array<{ nome: string; turnos: number; total: number }> } {
  let total = 0, semValor = 0;
  const por = new Map<string, { nome: string; turnos: number; total: number }>();
  for (const t of turnos) {
    for (const i of t.inscritos) {
      const v = Number(i.diaria);
      if (!(v > 0)) { semValor++; continue; }
      total += v;
      const k = chaveDaPessoa(i.pessoaTipo, i.pessoaId);
      const p = por.get(k) || { nome: i.nome, turnos: 0, total: 0 };
      p.turnos++;
      p.total = Math.round((p.total + v) * 100) / 100;
      por.set(k, p);
    }
  }
  return { total: Math.round(total * 100) / 100, semValor, porPessoa: [...por.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome)) };
}
