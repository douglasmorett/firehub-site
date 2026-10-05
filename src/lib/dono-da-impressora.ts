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
 */

/** Sem consultar por este tempo, o Assistente deixa de ser dono. */
export const VALIDADE_DO_DONO_MS = 30_000;

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
  vistos.set(chave, {
    chave,
    versao: String(estado?.versao || ""),
    impressoras: Array.isArray(estado?.impressoras) ? (estado!.impressoras as unknown[]).map(nomeDaImpressora).filter(Boolean) : [],
    primeiraVez: antes?.primeiraVez ?? agora,
    ultimaVez: agora,
  });
}

/** O Assistente dono desta impressora na loja, ou null se ninguém disse enxergá-la. */
export function donoDaImpressora(loja: string, impressora: unknown, agora = Date.now()): string | null {
  const nome = nomeDaImpressora(impressora);
  if (!nome) return null;
  let dono: AssistenteVisto | null = null;
  for (const v of vistosPorLoja.get(loja)?.values() || []) {
    if (agora - v.ultimaVez > VALIDADE_DO_DONO_MS) continue;
    if (!v.impressoras.includes(nome)) continue;
    if (
      !dono ||
      compararVersoes(v.versao, dono.versao) > 0 ||
      (compararVersoes(v.versao, dono.versao) === 0 && v.primeiraVez < dono.primeiraVez)
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
export function trabalhosDoAssistente<J extends Job>(jobs: J[], loja: string, chave: string, agora = Date.now()): J[] {
  const saida: J[] = [];
  for (const job of jobs || []) {
    const destinos = Array.isArray(job?.destinos) ? job.destinos : [];
    if (destinos.length === 0) {
      saida.push(job);
      continue;
    }
    const meus = destinos.filter((d) => {
      const dono = donoDaImpressora(loja, d?.printer, agora);
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
}
