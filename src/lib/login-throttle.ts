/**
 * /src/lib/login-throttle.ts
 *
 * Freio de força bruta no login.
 *
 * Um robô testando senhas comuns contra uma lista de e-mails não precisa de
 * nada sofisticado: sem freio, ele faz milhares de tentativas por minuto até
 * acertar. O login do painel não tinha nenhum.
 *
 * ── Por que a chave principal é o e-mail, e não o IP ────────────────────────
 *
 * O caminho óbvio é contar por IP. O problema é que o IP aqui vem do cabeçalho
 * X-Forwarded-For, e esse cabeçalho é escrito por quem chama: o atacante troca
 * o valor a cada requisição e cada tentativa cai num balde novo. Um freio
 * baseado só nisso dá sensação de proteção e não protege.
 *
 * O que o atacante NÃO pode variar é a conta que quer invadir. Contando por
 * e-mail, mil tentativas contra a mesma conta batem no mesmo contador venham do
 * IP que vierem. O IP entra como segunda trava, com limite bem mais folgado,
 * para o caso de varredura ampla — e sem apertar demais, porque uma loja inteira
 * atrás da mesma conexão divide o mesmo IP.
 *
 * ── Espera progressiva ──────────────────────────────────────────────────────
 *
 * Errar a senha algumas vezes é humano; errar quarenta não é. A espera cresce
 * com a insistência, então o usuário distraído mal percebe e o robô trava.
 *
 * Estado em memória: cada instância tem o seu contador. Com várias instâncias o
 * teto efetivo é multiplicado pelo número delas — ainda assim reduz o ataque em
 * ordens de grandeza. Para um freio compartilhado de verdade, seria preciso
 * Redis/KV.
 */

interface Tentativas {
  falhas: number;
  primeira: number;
  bloqueadoAte: number;
}

const porConta = new Map<string, Tentativas>();
const porOrigem = new Map<string, Tentativas>();

/** Depois disto sem nenhuma falha nova, o contador zera sozinho. */
const JANELA_MS = 15 * 60_000;

/** Quantas falhas cada chave tolera antes da primeira espera. */
const LIMITE_CONTA = 3;
const LIMITE_ORIGEM = 30;

/**
 * Quanto esperar, por faixa de insistência. Da 5ª falha na mesma conta em diante,
 * é um minuto; quem continua vai para cinco, quinze e trinta.
 */
function esperaMs(falhas: number, limite: number): number {
  const excedente = falhas - limite;
  if (excedente <= 0) return 0;
  if (excedente <= 3) return 60_000;
  if (excedente <= 8) return 5 * 60_000;
  if (excedente <= 20) return 15 * 60_000;
  return 30 * 60_000;
}

function ler(mapa: Map<string, Tentativas>, chave: string): Tentativas | undefined {
  const registro = mapa.get(chave);
  if (!registro) return undefined;
  // Passou a janela inteira sem falha nova e sem bloqueio ativo: esqueça.
  if (Date.now() - registro.primeira > JANELA_MS && Date.now() > registro.bloqueadoAte) {
    mapa.delete(chave);
    return undefined;
  }
  return registro;
}

export interface EstadoDoFreio {
  bloqueado: boolean;
  /** Segundos que faltam para poder tentar de novo. */
  esperarSegundos: number;
}

/**
 * Chamar ANTES de conferir a senha. Se devolver bloqueado, recuse sem sequer
 * olhar a senha — inclusive quando ela estiver certa, senão o bloqueio não
 * bloqueia nada.
 */
export function verificarFreioDeLogin(email: string, ip: string): EstadoDoFreio {
  const agora = Date.now();
  const chaveConta = `conta:${String(email || "").toLowerCase().trim()}`;
  const chaveOrigem = `origem:${ip}`;

  for (const [mapa, chave] of [[porConta, chaveConta], [porOrigem, chaveOrigem]] as const) {
    const registro = ler(mapa, chave);
    if (registro && agora < registro.bloqueadoAte) {
      return {
        bloqueado: true,
        esperarSegundos: Math.ceil((registro.bloqueadoAte - agora) / 1000),
      };
    }
  }

  return { bloqueado: false, esperarSegundos: 0 };
}

/** Chamar quando a senha não bate. Só a falha conta — acerto nunca gasta cota. */
export function registrarFalhaDeLogin(email: string, ip: string): void {
  const agora = Date.now();

  const anota = (mapa: Map<string, Tentativas>, chave: string, limite: number) => {
    const registro = ler(mapa, chave) ?? { falhas: 0, primeira: agora, bloqueadoAte: 0 };
    registro.falhas += 1;
    const espera = esperaMs(registro.falhas, limite);
    if (espera > 0) registro.bloqueadoAte = agora + espera;
    mapa.set(chave, registro);
  };

  anota(porConta, `conta:${String(email || "").toLowerCase().trim()}`, LIMITE_CONTA);
  anota(porOrigem, `origem:${ip}`, LIMITE_ORIGEM);
}

/** Chamar quando o login dá certo: quem sabe a senha não fica de castigo. */
export function limparFreioDeLogin(email: string): void {
  porConta.delete(`conta:${String(email || "").toLowerCase().trim()}`);
}

/**
 * Origem da requisição para fins de contagem.
 *
 * Não confie nisto como identidade — é cabeçalho, e cabeçalho o cliente
 * escreve. Serve só como segunda trava, com limite folgado.
 */
export function origemDaRequisicao(headers: { get?: (n: string) => string | null } | Record<string, any> | undefined): string {
  const pegar = (nome: string): string => {
    if (!headers) return "";
    if (typeof (headers as any).get === "function") return (headers as any).get(nome) || "";
    const bruto = (headers as any)[nome] ?? (headers as any)[nome.toLowerCase()];
    return Array.isArray(bruto) ? bruto[0] : (bruto || "");
  };

  // X-Forwarded-For ÚLTIMO salto primeiro: é o endereço que o proxy mais
  // próximo (Traefik) carimba, e que o cliente não forja (o que ele manda fica
  // ANTES na lista). cf-connecting-ip / x-real-ip só como reserva — nesta infra
  // (sem Cloudflare) o cliente pode inventá-los, e confiar neles primeiro
  // deixava o freio de brute-force contornável trocando o cabeçalho.
  const encadeado = pegar("x-forwarded-for");
  if (encadeado) {
    const saltos = encadeado.split(",").map(s => s.trim()).filter(Boolean);
    if (saltos.length) return saltos[saltos.length - 1];
  }

  const direto = pegar("cf-connecting-ip") || pegar("x-real-ip");
  if (direto) return direto.trim();

  return "desconhecida";
}
