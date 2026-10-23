/**
 * src/lib/url-externa.ts
 *
 * Buscar uma URL que veio DE FORA (cadastro da loja, corpo de webhook) sem
 * virar porta para a rede interna do servidor (SSRF).
 *
 * Antes, foto do cardápio, foto do anúncio, webhook de parceiro e áudio do
 * WhatsApp iam direto para `fetch(url)`: bastava gravar
 * `http://127.0.0.1:3000/api/cron/...` ou `http://169.254.169.254/` (metadata
 * da nuvem) para o servidor bater lá de dentro do container — e chamada em
 * localhost passa no verifyCronAuth como se fosse o cron-runner.
 *
 * Regra: só http/https, e o host tem que resolver SÓ para IP público. CDN de
 * foto (iFood etc.), o próprio site e o parceiro na internet continuam
 * passando. Redirecionamento é seguido à mão, conferindo cada salto.
 *
 * Limite conhecido: o fetch resolve o DNS de novo na hora de conectar (DNS
 * rebinding). Fechar isso exige fixar o IP no agente HTTP; aqui fica a
 * barreira de baixo custo, que já tira o caminho trivial.
 */
import { lookup as lookupDoSistema } from "node:dns/promises";
import { isIP } from "node:net";

type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

/** Injetável só para o teste (scripts/teste-url-externa.ts). */
export interface DependenciasDaUrlExterna {
  lookup?: Lookup;
  fetch?: typeof fetch;
}

const lookupPadrao: Lookup = (host) => lookupDoSistema(host, { all: true });

/** Loopback, rede privada, link-local/metadata, CGNAT, multicast — ou não é IP. */
export function ipInterno(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || // 0.0.0.0/8
      a === 127 || // loopback
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) || // link-local / metadata da nuvem
      (a === 100 && b >= 64 && b <= 127) || // CGNAT (rede interna de provedor)
      a >= 224 // multicast e reservado
    );
  }
  if (isIP(ip) === 6) {
    const s = ip.toLowerCase();
    return (
      s.startsWith("::") || // ::, ::1 e IPv4 embutido (::ffff:127.0.0.1)
      /^f[cd]/.test(s) || // fc00::/7
      /^fe[89ab]/.test(s) || // fe80::/10
      s.startsWith("ff") // multicast
    );
  }
  return true; // não é IP: na dúvida, recusa
}

/** Lança erro se a URL não for http/https para host público. */
export async function garantirUrlExterna(url: string, deps: DependenciasDaUrlExterna = {}): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("URL inválida");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`URL recusada: protocolo ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("URL recusada: endereço interno");
  }
  const ips = isIP(host) ? [host] : (await (deps.lookup ?? lookupPadrao)(host)).map((r) => r.address);
  if (ips.length === 0 || ips.some(ipInterno)) {
    throw new Error("URL recusada: endereço interno");
  }
}

/**
 * `fetch` para URL externa: confere o destino e cada redirecionamento.
 * Em POST só segue 307/308 (que mantêm o corpo); 301/302 em POST já viravam
 * GET sem corpo no fetch normal, então ali devolve a própria resposta 3xx.
 */
export async function fetchExterno(
  url: string,
  init: RequestInit = {},
  deps: DependenciasDaUrlExterna = {}
): Promise<Response> {
  const buscar = deps.fetch ?? fetch;
  const metodo = (init.method || "GET").toUpperCase();
  let atual = url;
  for (let salto = 0; salto <= 5; salto++) {
    await garantirUrlExterna(atual, deps);
    const r = await buscar(atual, { ...init, redirect: "manual" });
    const destino = r.headers.get("location");
    const segue = r.status === 307 || r.status === 308 || metodo === "GET" || metodo === "HEAD";
    if (r.status < 300 || r.status >= 400 || !destino || !segue) return r;
    await r.body?.cancel().catch(() => {}); // libera a conexão do salto
    atual = new URL(destino, atual).toString();
  }
  throw new Error("URL recusada: redirecionamentos demais");
}
