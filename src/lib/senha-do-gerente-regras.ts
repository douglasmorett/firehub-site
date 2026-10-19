/**
 * /src/lib/senha-do-gerente-regras.ts
 *
 * A SENHA DO GERENTE — a autorização do dono para ações que mexem em dinheiro
 * de alguém. Este arquivo é só a regra (sem banco, sem Next): o que pode ser
 * protegido, como a configuração é lida, quando a senha é pedida e o freio das
 * tentativas. Quem grava e confere no banco é lib/senha-do-gerente.ts.
 *
 * ── De onde veio ────────────────────────────────────────────────────────────
 * Allan, Delícia de Casa (decisão do Douglas, 17/10/2026): no salão lotado o
 * atendente joga a mesa para o fiado e, na conferência do motoboy, uma
 * pendência lançada some com um clique em "Excluir". O dono quer que essas
 * ações só passem com uma senha que ELE cadastra — e que vale mesmo no
 * computador do caixa logado na conta dele (é o que acontece na loja pequena:
 * o caixa usa o login do dono). Por isso a senha é pedida também ao dono: ela
 * é a prova de quem está na frente da tela, não de qual login está aberto.
 *
 * ── Para crescer ────────────────────────────────────────────────────────────
 * Ação nova protegida = uma linha em ACOES_PROTEGIDAS (nasce desligada em toda
 * loja) + `exigirSenhaDoGerente(req, lojaId, "<chave>")` na rota que a executa
 * + `comSenhaDoGerente` na tela (components/SenhaDoGerente.tsx). A tela de
 * configuração (Minha Loja → Senha do gerente) lista sozinha o que estiver
 * aqui.
 */

/** O que pode exigir a senha. A chave é gravada no banco: não renomear. */
export const ACOES_PROTEGIDAS = [
  {
    chave: "fiado",
    rotulo: "Lançar no fiado",
    ajuda: "Venda no balcão em \"Conta Funcionário\", dívida lançada à mão na tela Fiado e mesa jogada para o fiado no fechamento.",
  },
  {
    chave: "excluirPendenciaDoMotoboy",
    rotulo: "Excluir lançamento na conferência do motoboy",
    ajuda: "O botão Excluir de uma pendência já lançada no acerto do motoboy (Motoboys → Relatório de Pagamentos).",
  },
  {
    chave: "desfazerAcertoDoMotoboy",
    rotulo: "Desfazer acerto pago do motoboy",
    ajuda: "O \"desfazer\" de um acerto já marcado como pago (Motoboys → Relatório de Pagamentos). Desfazer também apaga a baixa do fiado que o acerto fez.",
  },
  {
    chave: "desfazerLancamentoDoCaixa",
    rotulo: "Apagar sangria ou suprimento do caixa",
    ajuda: "Desfazer um lançamento de dinheiro (sangria, suprimento, pagamento) no caixa aberto.",
  },
  {
    chave: "cancelarPedido",
    rotulo: "Cancelar pedido",
    ajuda: "Cancelar qualquer pedido pelo painel (no card, no Editar, arrastando para Cancelados ou em lote).",
  },
  {
    chave: "verDadosSensiveis",
    rotulo: "Abrir Dados sensíveis",
    ajuda: "A tela Dados sensíveis (CMV, custo da equipe e metas). Pede a senha ao abrir a tela.",
  },
] as const;

export type AcaoProtegida = (typeof ACOES_PROTEGIDAS)[number]["chave"];

/** Quais ações pedem a senha. Ausente = não pede (toda loja nasce assim). */
export type ExigeSenha = Record<AcaoProtegida, boolean>;

export const ehAcaoProtegida = (v: unknown): v is AcaoProtegida =>
  typeof v === "string" && ACOES_PROTEGIDAS.some((a) => a.chave === v);

export const rotuloDaAcao = (acao: AcaoProtegida): string =>
  ACOES_PROTEGIDAS.find((a) => a.chave === acao)?.rotulo ?? acao;

/** Lê o JSON gravado (ou o corpo da tela). Só `true` liga; o resto fica desligado. */
export function lerExigeSenha(bruto: unknown): ExigeSenha {
  const obj = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const saida = {} as ExigeSenha;
  for (const a of ACOES_PROTEGIDAS) saida[a.chave] = obj[a.chave] === true;
  return saida;
}

export const algumaLigada = (exige: ExigeSenha) => ACOES_PROTEGIDAS.some((a) => exige[a.chave]);

/** A senha nova é aceitável? Devolve o problema, ou null. */
export function problemaDaNovaSenha(senha: unknown): string | null {
  const s = typeof senha === "string" ? senha : "";
  if (s.trim().length < 4) return "A senha do gerente precisa de pelo menos 4 caracteres.";
  if (s.length > 64) return "A senha do gerente pode ter no máximo 64 caracteres.";
  return null;
}

/** A configuração como o banco a devolve. Nulo = a loja nunca cadastrou. */
export type ConfigDaSenha = { hash: string | null; exige: ExigeSenha } | null;

/**
 * O que fazer com esta ação nesta loja:
 *   - "livre":    a ação não está ligada, ou a loja não tem senha cadastrada;
 *   - "pedir":    está ligada e a requisição veio sem senha;
 *   - "conferir": está ligada e veio uma senha para conferir com o hash.
 *
 * Interruptor ligado sem senha cadastrada não tranca a loja: a tela de
 * configuração nem deixa ligar sem senha, e se o banco chegar nesse estado
 * (senha apagada à mão) a ação segue como era antes, em vez de travar o caixa
 * numa senha que ninguém sabe.
 */
export function decisaoDaSenha(config: ConfigDaSenha, acao: AcaoProtegida, senhaInformada: string | null | undefined): "livre" | "pedir" | "conferir" {
  if (!config?.hash || !config.exige[acao]) return "livre";
  return senhaInformada && senhaInformada.length > 0 ? "conferir" : "pedir";
}

// ── O freio das tentativas ──────────────────────────────────────────────────
//
// Contado por LOJA, não por IP: quem tentaria adivinhar é alguém da equipe, no
// mesmo computador e na mesma rede do caixa. Errar 5 vezes em 15 minutos
// tranca a senha da loja até a janela passar — inclusive para o dono, que é o
// preço de não deixar ninguém tentar 10 mil combinações de 4 dígitos. Acertar
// zera a contagem. Em memória, como lib/rateLimit.ts: o servidor é um processo
// só; reiniciar o container zera a contagem (no pior caso, 5 tentativas a mais).

export const MAX_TENTATIVAS = 5;
export const JANELA_DO_FREIO_MS = 15 * 60_000;

export class FreioDaSenha {
  private erros = new Map<string, { qtd: number; desde: number }>();
  constructor(
    private readonly max = MAX_TENTATIVAS,
    private readonly janelaMs = JANELA_DO_FREIO_MS,
    private readonly agora: () => number = Date.now,
  ) {}

  private vivo(chave: string) {
    const e = this.erros.get(chave);
    if (e && this.agora() - e.desde > this.janelaMs) {
      this.erros.delete(chave);
      return null;
    }
    return e ?? null;
  }

  /** Trancada? Devolve em quantos minutos libera, ou null se pode tentar. */
  trancada(chave: string): number | null {
    const e = this.vivo(chave);
    if (!e || e.qtd < this.max) return null;
    return Math.max(1, Math.ceil((e.desde + this.janelaMs - this.agora()) / 60_000));
  }

  /** Errou: conta e devolve quantas tentativas ainda restam. */
  errou(chave: string): number {
    const e = this.vivo(chave);
    if (!e) this.erros.set(chave, { qtd: 1, desde: this.agora() });
    else e.qtd += 1;
    return Math.max(0, this.max - (this.erros.get(chave)?.qtd ?? 0));
  }

  acertou(chave: string) {
    this.erros.delete(chave);
  }
}

// ── O que a rota responde (e a tela lê) ─────────────────────────────────────

/** Cabeçalho em que a tela manda a senha (com encodeURIComponent: acento não passa cru em cabeçalho). */
export const CABECALHO_DA_SENHA = "x-senha-do-gerente";

export const CODIGO_SENHA_PEDIDA = "SENHA_DO_GERENTE_PEDIDA";
export const CODIGO_SENHA_ERRADA = "SENHA_DO_GERENTE_ERRADA";
export const CODIGO_SENHA_TRANCADA = "SENHA_DO_GERENTE_TRANCADA";

export type RecusaDaSenha = { status: number; error: string; codigo: string; acao: AcaoProtegida; restam?: number };

/** O que a conferência decidiu: passa, ou a recusa pronta para virar resposta. */
export type ResultadoDaSenha = { ok: true } | ({ ok: false } & RecusaDaSenha);

/**
 * A conferência inteira, com o banco e o bcrypt entregues por quem chama —
 * lib/senha-do-gerente.ts passa os de verdade; scripts/teste-senha-do-gerente.ts
 * passa um banco de mentira e o mesmo bcrypt. É AQUI que a senha é conferida
 * no servidor: a tela só repassa o que o gerente digitou.
 */
export async function conferirSenhaDoGerenteCom(
  deps: {
    lerConfig: (lojaId: string) => Promise<ConfigDaSenha>;
    comparar: (senha: string, hash: string) => Promise<boolean>;
    freio: FreioDaSenha;
  },
  lojaId: string,
  acao: AcaoProtegida,
  senhaInformada: string | null | undefined,
): Promise<ResultadoDaSenha> {
  const config = await deps.lerConfig(lojaId);
  const decisao = decisaoDaSenha(config, acao, senhaInformada);
  if (decisao === "livre") return { ok: true };
  const rotulo = rotuloDaAcao(acao);
  if (decisao === "pedir") {
    return { ok: false, status: 403, codigo: CODIGO_SENHA_PEDIDA, acao, error: `"${rotulo}" pede a senha do gerente.` };
  }
  const minutos = deps.freio.trancada(lojaId);
  if (minutos != null) {
    return {
      ok: false, status: 429, codigo: CODIGO_SENHA_TRANCADA, acao,
      error: `Senha do gerente errada muitas vezes. Tente de novo em ${minutos} minuto${minutos > 1 ? "s" : ""}.`,
    };
  }
  const certa = await deps.comparar(String(senhaInformada), config!.hash!);
  if (certa) {
    deps.freio.acertou(lojaId);
    return { ok: true };
  }
  const restam = deps.freio.errou(lojaId);
  return {
    ok: false, status: 403, codigo: CODIGO_SENHA_ERRADA, acao, restam,
    error: restam > 0
      ? `Senha do gerente errada. ${restam} tentativa${restam > 1 ? "s" : ""} antes de travar por 15 minutos.`
      : "Senha do gerente errada. Travada por 15 minutos.",
  };
}

/** Lê a senha do cabeçalho. Texto mal codificado vale como veio. */
export function senhaDoCabecalho(valor: string | null | undefined): string | null {
  if (!valor) return null;
  try {
    return decodeURIComponent(valor);
  } catch {
    return valor;
  }
}
