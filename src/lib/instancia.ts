import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Quem é ESTE processo do servidor, entre os que estão vivos ao mesmo tempo.
 *
 * Mesmo com um droplet só já existem dois: no deploy o container velho e o
 * novo atendem juntos por alguns segundos (e o cron de cada um rodava em
 * dobro). Com dois droplets, são A e B o tempo todo. Quem disputa a vez de um
 * job (lib/vez.ts) e quem assina um alerta precisa de um nome que não se
 * repita entre eles:
 *
 *   - INSTANCIA (opcional, "a"/"b" no Coolify): o nome que gente lê;
 *   - os.hostname(): no Docker é o id do container — muda a cada deploy;
 *   - um uuid sorteado no boot: dois processos no mesmo container (ou um
 *     reinício com o mesmo hostname) não se confundem.
 *
 * `ENV HOSTNAME=0.0.0.0` do Dockerfile é o endereço em que o Next escuta, não
 * o nome da máquina — por isso aqui é `os.hostname()`, e nunca `process.env.HOSTNAME`.
 *
 * Fica no globalThis porque o Next pode carregar este módulo em mais de um
 * pacote do servidor (instrumentation, cada rota): sem isso cada cópia
 * sortearia um uuid e a instância "mudaria de nome" no meio do caminho.
 */
export type Instancia = {
  /** INSTANCIA do ambiente, ou null. */
  nome: string | null;
  host: string;
  /** Sorteado no boot do processo. */
  boot: string;
  /** Único entre os processos vivos: é o `dono` das vezes (lib/vez.ts). */
  id: string;
  /** Quando este processo subiu (ISO). */
  desde: string;
};

const g = globalThis as typeof globalThis & { __firehubInstancia?: Instancia };

export function instancia(): Instancia {
  if (!g.__firehubInstancia) {
    const nome = (process.env.INSTANCIA || "").trim() || null;
    let host = "sem-host";
    try {
      host = hostname() || host;
    } catch {}
    const boot = randomUUID();
    g.__firehubInstancia = {
      nome,
      host,
      boot,
      id: `${nome ?? "-"}/${host}/${boot.slice(0, 8)}`,
      desde: new Date().toISOString(),
    };
  }
  return g.__firehubInstancia;
}

/** O id desta instância — o `dono` padrão das vezes. */
export function idDaInstancia(): string {
  return instancia().id;
}

/** O commit da imagem (GIT_SHA, posto pela montagem do GitHub), ou null. */
export function shaDaVersao(): string | null {
  return (process.env.GIT_SHA || "").trim() || null;
}

/** Uma linha para os alertas do WhatsApp: "a · 3f2c9a1b0c4d · versão 4df0220". */
export function descricaoDaInstancia(): string {
  const i = instancia();
  const sha = shaDaVersao();
  return [i.nome, i.host, sha ? `versão ${sha.slice(0, 7)}` : null].filter(Boolean).join(" · ");
}
