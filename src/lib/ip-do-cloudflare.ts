/**
 * Faixas de IP do Cloudflare (https://www.cloudflare.com/ips-v4 e /ips-v6,
 * conferidas em 13/10/2026).
 *
 * Com o proxy do Cloudflare na frente, o Traefik recebe a conexão de um IP de
 * borda do Cloudflare, e é ESSE IP que vira o último salto do X-Forwarded-For.
 * O IP de verdade do cliente vem em `cf-connecting-ip`, que o Cloudflare
 * sobrescreve sempre. Só dá para confiar nele quando o último salto É do
 * Cloudflare: quem bate direto no IP do droplet pode mandar o cabeçalho que
 * quiser, e aí o último salto (o IP dele) continua valendo.
 *
 * Sem isto, todo cliente de uma região cai no mesmo balde do rate-limit e o
 * Assistente de impressão de cada loja "muda de IP" a cada consulta à fila
 * (lib/dono-da-impressora.ts) — pedido sem imprimir.
 *
 * Se o Cloudflare publicar faixa nova, é aqui que entra.
 */

const FAIXAS_V4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

const FAIXAS_V6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

function v4ParaNumero(ip: string): number | null {
  const partes = ip.split(".");
  if (partes.length !== 4) return null;
  let n = 0;
  for (const p of partes) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** IPv6 em 8 grupos de 16 bits (aceita "::"). */
function v6ParaGrupos(ip: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip)) return null;
  const metades = ip.split("::");
  if (metades.length > 2) return null;
  const esq = metades[0] ? metades[0].split(":") : [];
  const dir = metades.length === 2 && metades[1] ? metades[1].split(":") : [];
  const faltam = 8 - esq.length - dir.length;
  if (metades.length === 1 ? faltam !== 0 : faltam < 1) return null;
  const grupos = [...esq, ...Array(metades.length === 2 ? faltam : 0).fill("0"), ...dir];
  const nums = grupos.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(isNaN) ? null : nums;
}

const V4 = FAIXAS_V4.map((f) => {
  const [base, bits] = f.split("/");
  const n = v4ParaNumero(base)!;
  const tam = 2 ** (32 - Number(bits));
  return { inicio: n - (n % tam), tam };
});

const V6 = FAIXAS_V6.map((f) => {
  const [base, bits] = f.split("/");
  return { grupos: v6ParaGrupos(base)!, bits: Number(bits) };
});

/** true se o IP (v4, v6 ou v4 mapeado em v6) pertence ao Cloudflare. */
export function ehIpDoCloudflare(ipBruto: string | null | undefined): boolean {
  if (!ipBruto) return false;
  let ip = ipBruto.trim().toLowerCase();
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7);

  const n = v4ParaNumero(ip);
  if (n !== null) return V4.some((f) => n >= f.inicio && n < f.inicio + f.tam);

  const g = v6ParaGrupos(ip);
  if (!g) return false;
  return V6.some((f) => {
    let resto = f.bits;
    for (let i = 0; i < 8 && resto > 0; i++) {
      const usar = Math.min(16, resto);
      const mascara = (0xffff << (16 - usar)) & 0xffff;
      if ((g[i] & mascara) !== (f.grupos[i] & mascara)) return false;
      resto -= usar;
    }
    return true;
  });
}

/**
 * IP do cliente a partir do último salto do X-Forwarded-For: se esse salto é
 * do Cloudflare e veio `cf-connecting-ip`, vale o do Cloudflare; senão, vale
 * o último salto (regra de sempre, que o cliente não consegue forjar).
 */
export function ipRealDoSalto(ultimoSalto: string, cfConnectingIp: string | null | undefined): string {
  const cf = cfConnectingIp?.trim();
  if (cf && ehIpDoCloudflare(ultimoSalto)) return cf;
  return ultimoSalto;
}
