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
import { dataDaLoja, relogioDaLoja, FUSO_PADRAO, HORA_DE_VIRADA_DO_EXPEDIENTE } from "@/lib/fuso";
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

// ── Chave Pix (Douglas, 12/11/2026: "manda ele colocar o Pix dele") ─────────

export type TipoDePix = "cpf" | "cnpj" | "telefone" | "email" | "aleatoria";
export const TIPOS_DE_PIX: Array<{ tipo: TipoDePix; rotulo: string }> = [
  { tipo: "cpf", rotulo: "CPF" }, { tipo: "telefone", rotulo: "Celular" }, { tipo: "email", rotulo: "E-mail" },
  { tipo: "aleatoria", rotulo: "Aleatória" }, { tipo: "cnpj", rotulo: "CNPJ" },
];
export const ehTipoDePix = (t: unknown): t is TipoDePix => TIPOS_DE_PIX.some((x) => x.tipo === t);
export const ROTULO_DO_PIX: Record<TipoDePix, string> = { cpf: "CPF", cnpj: "CNPJ", telefone: "Celular", email: "E-mail", aleatoria: "Aleatória" };

/** Os dígitos verificadores do CPF batem? (pega o número digitado errado, não "valida" a pessoa) */
export function cpfValido(cpf: string): boolean {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function cnpjValido(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((t, p, i) => t + Number(d[i]) * p, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_ALEATORIA = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** Celular para Pix: DDD + 9 + 8 dígitos (com ou sem +55). Devolve "DDD9XXXXXXXX" ou "". */
function celularDoPix(bruto: string): string {
  let d = bruto.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  return d.length === 11 && d[2] === "9" && d[0] !== "0" ? d : "";
}

/**
 * A chave Pix digitada vira chave limpa + tipo — ou a frase do erro. O tipo
 * escolhido manda; sem tipo, adivinha: "@" é e-mail, 32 letras/números
 * hexadecimais é aleatória, 14 dígitos é CNPJ, 11 dígitos é CPF quando os
 * dígitos verificadores batem e celular quando não batem e tem o 9 depois do
 * DDD. Validação leve: pega o número com dígito trocado, não garante que a
 * chave existe no banco.
 *
 * Como fica gravada: CPF/CNPJ só dígitos, celular "+55DDD9XXXXXXXX" (o formato
 * do Banco Central), e-mail minúsculo, aleatória minúscula com hífens.
 */
export function lerChavePix(bruta: unknown, tipoEscolhido?: unknown): { ok: true; chave: string; tipo: TipoDePix } | { ok: false; erro: string } {
  const s = String(bruta ?? "").trim();
  if (!s) return { ok: false, erro: "Digite a chave Pix." };
  if (s.length > 120) return { ok: false, erro: "Chave Pix comprida demais." };
  const digitos = s.replace(/\D/g, "");
  let tipo: TipoDePix | null = ehTipoDePix(tipoEscolhido) ? tipoEscolhido : null;
  if (!tipo) {
    if (s.includes("@")) tipo = "email";
    else if (RE_ALEATORIA.test(s.replace(/\s/g, ""))) tipo = "aleatoria";
    else if (/^[\d\s().+\-/]+$/.test(s)) {
      if (digitos.length === 14 && !s.startsWith("+")) tipo = "cnpj";
      else if (digitos.length === 11 && !s.startsWith("+") && !s.includes("(") && cpfValido(digitos)) tipo = "cpf";
      else if (celularDoPix(s)) tipo = "telefone";
      else if (digitos.length === 11) return { ok: false, erro: "Esse número não é um CPF válido nem um celular com DDD. Confira os dígitos." };
    }
    if (!tipo) return { ok: false, erro: "Não reconheci a chave. Use CPF, celular com DDD, e-mail ou a chave aleatória." };
  }
  if (tipo === "email") {
    const e = s.toLowerCase();
    return RE_EMAIL.test(e) && e.length <= 77 ? { ok: true, chave: e, tipo } : { ok: false, erro: "E-mail da chave Pix inválido." };
  }
  if (tipo === "aleatoria") {
    const h = s.replace(/[\s-]/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(h)) return { ok: false, erro: "A chave aleatória tem 32 letras e números (ex.: 1a2b3c4d-…)." };
    return { ok: true, chave: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, tipo };
  }
  if (tipo === "cpf") return cpfValido(digitos) ? { ok: true, chave: digitos, tipo } : { ok: false, erro: "CPF inválido. Confira os números." };
  if (tipo === "cnpj") return cnpjValido(digitos) ? { ok: true, chave: digitos, tipo } : { ok: false, erro: "CNPJ inválido. Confira os números." };
  const cel = celularDoPix(s);
  return cel ? { ok: true, chave: `+55${cel}`, tipo } : { ok: false, erro: "Celular da chave Pix com DDD e o 9 (ex.: 22 99999-1234)." };
}

/** O tipo de uma chave já gravada (a gravada sem tipo é adivinhada; não deu = null). */
export function tipoDaChave(chave: string | null | undefined, tipo?: string | null): TipoDePix | null {
  if (ehTipoDePix(tipo)) return tipo;
  const l = chave ? lerChavePix(chave) : null;
  return l && l.ok ? l.tipo : null;
}

/** A chave para MOSTRAR ao dono: CPF com pontos, celular com DDD entre parênteses. */
export function pixFormatado(chave: string, tipo?: string | null): string {
  const t = tipoDaChave(chave, tipo);
  const d = chave.replace(/\D/g, "");
  if (t === "cpf" && d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (t === "cnpj" && d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (t === "telefone") { const c = celularDoPix(chave); if (c) return `(${c.slice(0, 2)}) ${c.slice(2, 7)}-${c.slice(7)}`; }
  return chave;
}

/**
 * A chave para COPIAR e colar no app do banco: CPF/CNPJ só dígitos, celular
 * DDD + número (o campo "celular" do app do banco já põe o +55 sozinho), o
 * resto como está.
 */
export function pixParaCopiar(chave: string, tipo?: string | null): string {
  const t = tipoDaChave(chave, tipo);
  if (t === "cpf" || t === "cnpj") return chave.replace(/\D/g, "");
  if (t === "telefone") return celularDoPix(chave) || chave;
  return chave;
}

/**
 * A chave escondida — o que o LINK mostra para a própria pessoa conferir. O
 * link identifica só pelo telefone, então quem digitar o número de um colega
 * não pode ler a chave dele inteira.
 */
export function pixMascarado(chave: string, tipo?: string | null): string {
  const t = tipoDaChave(chave, tipo);
  const d = chave.replace(/\D/g, "");
  if (t === "cpf" && d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (t === "cnpj" && d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
  if (t === "telefone") { const c = celularDoPix(chave); if (c) return `(${c.slice(0, 2)}) *****-${c.slice(7)}`; }
  if (t === "email" && chave.includes("@")) {
    const [u, dom] = chave.split("@");
    return `${u.slice(0, 2)}***@${dom}`;
  }
  if (chave.length <= 8) return "****";
  return `${chave.slice(0, 4)}…${chave.slice(-4)}`;
}

// ── Pagamento de quem trabalhou (só o dono) ─────────────────────────────────

/**
 * O dia do EXPEDIENTE do turno — o que o acerto do motoboy usa (vira às 5h).
 * O turno das 18:00 de segunda é de segunda; o que começa 01:00 de terça
 * ainda é a noite de segunda. A escala continua mostrando o turno no dia do
 * calendário: isto só serve para casar com o acerto pago (MotoboyAcertoPago).
 */
export function diaDoExpedienteDoTurno(t: { data: string; inicio: string }): string {
  return (lerHora(t.inicio) ?? 0) < HORA_DE_VIRADA_DO_EXPEDIENTE * 60 ? somarDias(t.data, -1) : t.data;
}

/** O acerto pago do motoboy que cobre o dia deste turno (o primeiro, se houver dois). */
export function acertoQueCobre<A extends { dias: string[] }>(acertos: A[] | null | undefined, t: { data: string; inicio: string }): A | null {
  const dia = diaDoExpedienteDoTurno(t);
  return (acertos || []).find((a) => a.dias.includes(dia)) ?? null;
}

export type FormaDePagamento = "pix" | "dinheiro";
export const ehFormaDePagamento = (f: unknown): f is FormaDePagamento => f === "pix" || f === "dinheiro";

export type PagamentoFeito = { id: string; valor: number; forma: FormaDePagamento | null; obs: string | null; pagoEm: string; pagoPor: string | null };
export type ItemDePagamento = {
  inscricaoId: string; turnoId: string; data: string; inicio: string; fim: string; funcao: string;
  pessoaTipo: TipoDePessoa; pessoaId: string; nome: string; diaria: number | null;
  pagamento: PagamentoFeito | null;
  /** Motoboy: o acerto pago (tela do acerto) que já cobre o dia do turno. */
  acerto: { id: string; em: string; dia: string } | null;
};

export type SituacaoDoPagamento = "futuro" | "pago" | "acerto" | "pendente";

/**
 * Turno de amanhã não é "a pagar": a pessoa ainda não trabalhou. Conta a
 * DATA do turno contra o hoje da loja (o turno de hoje à noite já aparece —
 * o dono costuma pagar no fim do expediente).
 */
export function situacaoDoPagamento(i: Pick<ItemDePagamento, "data" | "pagamento" | "acerto">, hoje: string): SituacaoDoPagamento {
  if (i.pagamento) return "pago";
  if (numeroDoDia(i.data) > numeroDoDia(hoje)) return "futuro";
  return i.acerto ? "acerto" : "pendente";
}

const centavos = (v: number) => Math.round(v * 100) / 100;

export type ResumoDaPessoa = {
  pessoaTipo: TipoDePessoa; pessoaId: string; nome: string;
  /** Turnos já trabalhados no período (data até hoje). */
  turnos: number;
  devido: number; pago: number; pendente: number;
  /** Turnos pendentes de quem não tem diária combinada (fora do "pendente" em R$). */
  semValor: number;
  /** Motoboy: turnos cobertos pelo acerto pago (fora do devido — o acerto já pagou). */
  noAcerto: number;
  itens: ItemDePagamento[];
};
export type ResumoDosPagamentos = { devido: number; pago: number; pendente: number; semValor: number; noAcerto: number; turnos: number; porPessoa: ResumoDaPessoa[] };

/**
 * Devido, pago e pendente no período — no total e por pessoa.
 *   pago     = o que foi marcado (o valor que o dono digitou, não a diária);
 *   pendente = a diária combinada dos turnos trabalhados ainda sem pagamento;
 *   devido   = pago + pendente.
 * Turno futuro fica fora; turno do motoboy coberto pelo acerto também (o
 * acerto pagou o dia inteiro, com a conta dele). Quem está pendente sem diária
 * entra em `semValor`, para a tela dizer "sem valor combinado" em vez de R$ 0.
 */
export function resumoDosPagamentos(itens: ItemDePagamento[], hoje: string): ResumoDosPagamentos {
  const por = new Map<string, ResumoDaPessoa>();
  const total = { devido: 0, pago: 0, pendente: 0, semValor: 0, noAcerto: 0, turnos: 0 };
  for (const i of itens) {
    const s = situacaoDoPagamento(i, hoje);
    if (s === "futuro") continue;
    const k = chaveDaPessoa(i.pessoaTipo, i.pessoaId);
    const p = por.get(k) || { pessoaTipo: i.pessoaTipo, pessoaId: i.pessoaId, nome: i.nome, turnos: 0, devido: 0, pago: 0, pendente: 0, semValor: 0, noAcerto: 0, itens: [] };
    p.turnos++; total.turnos++;
    p.itens.push(i);
    if (s === "pago") { p.pago = centavos(p.pago + i.pagamento!.valor); total.pago = centavos(total.pago + i.pagamento!.valor); }
    else if (s === "acerto") { p.noAcerto++; total.noAcerto++; }
    else if (Number(i.diaria) > 0) { p.pendente = centavos(p.pendente + Number(i.diaria)); total.pendente = centavos(total.pendente + Number(i.diaria)); }
    else { p.semValor++; total.semValor++; }
    p.devido = centavos(p.pago + p.pendente);
    por.set(k, p);
  }
  total.devido = centavos(total.pago + total.pendente);
  for (const p of por.values()) p.itens.sort((a, b) => a.data.localeCompare(b.data) || a.inicio.localeCompare(b.inicio));
  const porPessoa = [...por.values()].sort((a, b) => b.pendente - a.pendente || b.semValor - a.semValor || a.nome.localeCompare(b.nome, "pt-BR"));
  return { ...total, porPessoa };
}

/**
 * "Pagar tudo o que está pendente": o dono confirma UM total, e cada turno
 * guarda a sua parte — proporcional à diária de cada um (sem diária = a
 * média das outras; ninguém com diária = partes iguais). A sobra dos
 * centavos vai para o último, para a soma bater exatamente com o total.
 */
export function dividirValor(total: number, pesos: Array<number | null | undefined>): number[] {
  const n = pesos.length;
  if (!n) return [];
  const t = Math.round(total * 100);
  // Turno sem diária no meio de outros com diária pesa a média deles (não fica com R$ 0).
  const conhecidos = pesos.map(Number).filter((p) => p > 0);
  const media = conhecidos.length ? conhecidos.reduce((a, b) => a + b, 0) / conhecidos.length : 1;
  const base = pesos.map((p) => (Number(p) > 0 ? Number(p) : media));
  const somaBase = base.reduce((a, b) => a + b, 0);
  const partes = base.map((p) => Math.floor((t * p) / somaBase));
  partes[n - 1] += t - partes.reduce((a, b) => a + b, 0);
  return partes.map((c) => c / 100);
}
