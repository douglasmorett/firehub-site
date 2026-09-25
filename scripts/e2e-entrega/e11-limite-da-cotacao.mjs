// E11 — /api/delivery-fee: 45 chamadas seguidas do mesmo IP → 429 com
// Retry-After, e o servidor continua de pé. Endereço já no cache (não gasta
// busca no mapa): é o limite POR REQUISIÇÃO do IP (40/min) que se testa.
// Depois espera o Retry-After e confere que volta a responder 200; e manda
// uma rajada de 45 SIMULTÂNEAS para ver que nada cai.
import { BASE, banco, idDaLoja, gravarResultado, dormir } from "./comum.mjs";

const prisma = banco();
const loja = await idDaLoja(prisma);
await prisma.$disconnect();
const q = new URLSearchParams({ franchiseeId: loja, street: "Rua Abel Gomes dos Santos", number: "50", neighborhood: "Jardim Esperança", address: "Rua Abel Gomes dos Santos, 50 - Jardim Esperança, Cabo Frio" });
const url = `${BASE}/api/delivery-fee?${q}`;
const r = { sequencia: [], rajada: null };
const t0 = Date.now();
for (let i = 1; i <= 45; i++) {
  const t = Date.now();
  const res = await fetch(url);
  const corpo = await res.json().catch(() => null);
  r.sequencia.push({ n: i, status: res.status, retryAfter: res.headers.get("retry-after"), ms: Date.now() - t, fee: corpo?.fee, msg: res.status === 429 ? corpo?.message : undefined });
}
r.duracaoMs = Date.now() - t0;
r.primeiro429 = r.sequencia.find((x) => x.status === 429) || null;
r.contagem = r.sequencia.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {});
const espera = Number(r.primeiro429?.retryAfter || 60);
r.saude = await fetch(`${BASE}/api/health`).then((x) => x.status).catch((e) => String(e));
r.cardapioNoMeioDoLimite = await fetch(`${BASE}/loja/divinos-e2e`).then((x) => x.status).catch((e) => String(e));
await dormir((espera + 1) * 1000);
const depois = await fetch(url);
r.depoisDoRetryAfter = { status: depois.status, esperouS: espera + 1 };
// Rajada simultânea (45 de uma vez) — ninguém pode derrubar o servidor.
const tR = Date.now();
const lote = await Promise.allSettled(Array.from({ length: 45 }, () => fetch(url).then((x) => x.status)));
r.rajada = { ms: Date.now() - tR, status: lote.reduce((m, x) => { const k = x.status === "fulfilled" ? x.value : "erro"; m[k] = (m[k] || 0) + 1; return m; }, {}) };
r.saudeDepoisDaRajada = await fetch(`${BASE}/api/health`).then((x) => x.status).catch((e) => String(e));
gravarResultado("e11", r);
console.log(JSON.stringify({ ...r, sequencia: r.sequencia.map((x) => `${x.n}:${x.status}${x.retryAfter ? `(RA=${x.retryAfter})` : ""}`).join(" ") }, null, 2));
