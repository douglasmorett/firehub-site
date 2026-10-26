/**
 * UM ASSISTENTE POR IMPRESSORA.
 *
 * A fila da nuvem (api/store/print-queue) entrega o pedido a quem consultar, e
 * só o carimba como impresso no /ack, DEPOIS do papel. Dois Assistentes da
 * mesma loja que enxergam a mesma impressora imprimem a comanda duas vezes.
 *
 * NIK, 04/10/2026: a ELGIN da cozinha passou a tirar dois papéis de todo
 * pedido, um no modelo da 1.2.32 e outro no de um Assistente anterior a 23/09
 * (o "#4137" no topo e o "N. do Pedido"). O PC do caixa tinha um Assistente só;
 * o outro estava num segundo computador que também enxerga a ELGIN — o mesmo
 * vaivém da lista de impressoras de 26/09. Pedir à loja que ache e desinstale
 * o Assistente certo, no meio do serviço, não resolve: o papel continua saindo.
 *
 * A regra: cada impressora tem UM dono entre os Assistentes que consultaram a
 * fila nos últimos 30 s e disseram enxergá-la — o de versão mais nova (o
 * modelo de comanda mais atual); empate, o que chegou primeiro. Os outros não
 * recebem o destino daquela impressora. Quem não diz o que enxerga (Assistente
 * anterior à 1.2.7) não é dono de nada e só recebe impressora sem dono — a
 * mesma coisa que recebia antes. Um Assistente sozinho na loja é dono de tudo
 * que enxerga, e a fila sai exatamente como sempre saiu.
 *
 * Fica em memória: o dono muda em até 30 s quando o Assistente dele some, e
 * uma reinicialização do servidor só devolve, por 30 s, o comportamento
 * antigo — nunca deixa papel sem sair.
 *
 * ── Com DUAS instâncias do servidor ─────────────────────────────────────────
 *
 * O Assistente não guarda cookie: o balanceador manda cada consulta a A ou a
 * B. A memória de cada um via os Assistentes numa ORDEM diferente, e o
 * "chegou primeiro" de A podia ser o caixa enquanto o de B era a cozinha: o
 * caixa recebia a comanda por A, a cozinha por B — dois papéis, o defeito que
 * este arquivo existe para impedir. Com B de peso pequeno no balanceador, B
 * pode nem ter visto o caixa nos últimos 30 s.
 *
 * Então os Assistentes vistos também vão ao banco ("AssistenteDaLoja", pelo
 * laço de lib/laco-entre-instancias.ts; no máximo uma escrita a cada 10 s por
 * Assistente e instância), com o "desde" do CLUSTER: a primeira vez que
 * qualquer instância o viu nesta presença. Quando a fila tem trabalho (só
 * então: a consulta vazia, a de toda hora, não lê nada a mais), a rota soma
 * o que o banco sabe ao que a memória sabe, e as duas instâncias chegam ao
 * mesmo dono: versão mais nova; empate, o "desde" mais antigo do cluster;
 * empate ainda, a chave (ordem fixa, igual nos dois servidores).
 */

/** Sem consultar por este tempo, o Assistente deixa de ser dono. */
export const VALIDADE_DO_DONO_MS = 30_000;
/**
 * Visto só pelo banco (pela outra instância): vale se a linha tem até isto.
 * Vivo, ele é regravado a cada ~10 s; morto, sai em até 30 s depois da última
 * consulta — nunca mais tarde que pela memória.
 */
export const VALIDADE_PELO_BANCO_MS = 20_000;
/** Uma escrita no banco por Assistente e instância, no máximo a cada isto. */
export const INTERVALO_DO_ASSISTENTE_NO_BANCO_MS = 10_000;

/** Um Assistente como o banco o conhece (lib/laco-entre-instancias.ts, assistentesNoBanco). */
export type AssistenteNoBanco = {
  chave: string;
  versao: string;
  impressoras: string[];
  /** Há quanto tempo o cluster o vê nesta presença (relógio do banco). */
  desdeHaMs: number;
  /** Há quanto tempo alguma instância gravou que o viu (relógio do banco). */
  vistoHaMs: number;
};

/** O que o laço grava em "AssistenteDaLoja". */
export type AssistenteParaOBanco = { lojaId: string; chave: string; versao: string; impressoras: string[] };

export type AssistenteVisto = {
  chave: string;
  versao: string;
  impressoras: string[];
  primeiraVez: number;
  ultimaVez: number;
};

type Destino = { printer?: unknown };
type Job = { destinos?: Destino[] | null } & Record<string, unknown>;

const vistosPorLoja = new Map<string, Map<string, AssistenteVisto>>();

// A fila do banco fica no globalThis: quem grava é o laço (carregado pelo
// boot), e o Next pode dar a esta rota a sua própria cópia deste arquivo.
type FilaDoBanco = { fila: Map<string, AssistenteParaOBanco>; em: Map<string, number> };
const gb = globalThis as unknown as { __firehubAssistentesParaOBanco?: FilaDoBanco };
const filaDoBanco = (): FilaDoBanco => (gb.__firehubAssistentesParaOBanco ??= { fila: new Map(), em: new Map() });
const TETO_DA_FILA_DO_BANCO = 5_000;

const nomeDaImpressora = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** "1.2.32" > "1.2.9"; sem versão vale 0. */
export function compararVersoes(a: string, b: string): number {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Quem é este Assistente: endereço de onde consultou, porta, versão e o que o
 * Windows dele enxerga. Dois na mesma rede saem pelo mesmo IP; o que os separa
 * é a porta (mesmo PC) ou a lista de impressoras (outro PC).
 */
export function chaveDoAssistente(ip: string, estado: { versao?: unknown; porta?: unknown; impressoras?: unknown } | null): string {
  const impressoras = Array.isArray(estado?.impressoras) ? (estado!.impressoras as unknown[]).map(nomeDaImpressora).sort().join("|") : "";
  return [ip || "?", String(estado?.versao || "antigo"), String(estado?.porta ?? ""), impressoras].join("#");
}

export function registrarAssistente(
  loja: string,
  chave: string,
  estado: { versao?: unknown; impressoras?: unknown } | null,
  agora = Date.now(),
): void {
  let vistos = vistosPorLoja.get(loja);
  if (!vistos) {
    vistos = new Map();
    vistosPorLoja.set(loja, vistos);
  }
  for (const [k, v] of vistos) if (agora - v.ultimaVez > VALIDADE_DO_DONO_MS) vistos.delete(k);
  const antes = vistos.get(chave);
  const visto: AssistenteVisto = {
    chave,
    versao: String(estado?.versao || ""),
    impressoras: Array.isArray(estado?.impressoras) ? (estado!.impressoras as unknown[]).map(nomeDaImpressora).filter(Boolean) : [],
    primeiraVez: antes?.primeiraVez ?? agora,
    ultimaVez: agora,
  };
  vistos.set(chave, visto);

  // Para o banco: só quem diz o que enxerga (o antigo nunca é dono de nada),
  // a primeira vez na hora e depois no máximo a cada 10 s.
  if (visto.impressoras.length === 0) return;
  const f = filaDoBanco();
  const k = `${loja}|${chave}`;
  const ultima = f.em.get(k);
  if (ultima !== undefined && agora >= ultima && agora - ultima < INTERVALO_DO_ASSISTENTE_NO_BANCO_MS) return;
  if (f.em.size >= TETO_DA_FILA_DO_BANCO) f.em.clear();
  f.em.set(k, agora);
  if (f.fila.size >= TETO_DA_FILA_DO_BANCO) f.fila.clear();
  f.fila.set(k, { lojaId: loja, chave, versao: visto.versao, impressoras: visto.impressoras });
}

/** O que o laço deve gravar agora (e sai da fila). */
export function tirarAssistentesParaOBanco(): AssistenteParaOBanco[] {
  const f = filaDoBanco();
  if (f.fila.size === 0) return [];
  const lista = [...f.fila.values()];
  f.fila.clear();
  return lista;
}

/** A gravação falhou: volta para a fila (a próxima volta do laço tenta de novo). */
export function devolverAssistentesParaOBanco(lista: AssistenteParaOBanco[]): void {
  const f = filaDoBanco();
  for (const a of lista) {
    if (f.fila.size >= TETO_DA_FILA_DO_BANCO) break;
    f.fila.set(`${a.lojaId}|${a.chave}`, a);
  }
}

/**
 * Os Assistentes que contam agora: os da memória (consultaram ESTA instância
 * há até 30 s) somados aos do banco. O "desde" do banco, quando existe, manda
 * no desempate: é o mesmo número nas duas instâncias, e a primeira vez da
 * memória é só a primeira vez que ESTA instância o viu.
 */
function candidatos(loja: string, agora: number, doBanco: readonly AssistenteNoBanco[]): AssistenteVisto[] {
  const porChave = new Map<string, AssistenteVisto>();
  for (const v of vistosPorLoja.get(loja)?.values() || []) {
    if (agora - v.ultimaVez > VALIDADE_DO_DONO_MS) continue;
    porChave.set(v.chave, { ...v });
  }
  for (const b of doBanco) {
    if (!b || typeof b.chave !== "string") continue;
    const desde = agora - Math.max(0, Number(b.desdeHaMs) || 0);
    const local = porChave.get(b.chave);
    if (local) {
      local.primeiraVez = desde;
    } else if (Number(b.vistoHaMs) <= VALIDADE_PELO_BANCO_MS) {
      porChave.set(b.chave, {
        chave: b.chave,
        versao: String(b.versao || ""),
        impressoras: (b.impressoras || []).map(nomeDaImpressora).filter(Boolean),
        primeiraVez: desde,
        ultimaVez: agora - Math.max(0, Number(b.vistoHaMs) || 0),
      });
    }
  }
  return [...porChave.values()];
}

/** O Assistente dono desta impressora na loja, ou null se ninguém disse enxergá-la. */
export function donoDaImpressora(
  loja: string,
  impressora: unknown,
  agora = Date.now(),
  doBanco: readonly AssistenteNoBanco[] = [],
): string | null {
  const nome = nomeDaImpressora(impressora);
  if (!nome) return null;
  let dono: AssistenteVisto | null = null;
  for (const v of candidatos(loja, agora, doBanco)) {
    if (!v.impressoras.includes(nome)) continue;
    const versao = dono ? compararVersoes(v.versao, dono.versao) : 0;
    if (
      !dono ||
      versao > 0 ||
      (versao === 0 && v.primeiraVez < dono.primeiraVez) ||
      (versao === 0 && v.primeiraVez === dono.primeiraVez && v.chave < dono.chave)
    ) {
      dono = v;
    }
  }
  return dono?.chave ?? null;
}

/**
 * Os trabalhos que ESTE Assistente deve imprimir: tira os destinos de
 * impressora que tem outro dono. O trabalho que fica sem destino nenhum sai da
 * lista — mandá-lo vazio faria o Assistente cair na impressora padrão dele. O
 * que já vinha sem destino (loja sem impressora cadastrada) passa como está.
 */
export function trabalhosDoAssistente<J extends Job>(
  jobs: J[],
  loja: string,
  chave: string,
  agora = Date.now(),
  doBanco: readonly AssistenteNoBanco[] = [],
): J[] {
  const saida: J[] = [];
  for (const job of jobs || []) {
    const destinos = Array.isArray(job?.destinos) ? job.destinos : [];
    if (destinos.length === 0) {
      saida.push(job);
      continue;
    }
    const meus = destinos.filter((d) => {
      const dono = donoDaImpressora(loja, d?.printer, agora, doBanco);
      return dono === null || dono === chave;
    });
    if (meus.length === 0) continue;
    saida.push(meus.length === destinos.length ? job : ({ ...job, destinos: meus } as J));
  }
  return saida;
}

/** Só para os testes. */
export function esquecerAssistentes(): void {
  vistosPorLoja.clear();
  filaDoBanco().fila.clear();
  filaDoBanco().em.clear();
}
