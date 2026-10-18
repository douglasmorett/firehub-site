/**
 * O prompt da loja guardado no Google (lib/cache-do-prompt.ts), com um cliente
 * do Gemini FALSO e relógio passado à mão.
 * Roda sem banco e sem Gemini: npx tsx scripts/teste-cache-do-prompt.ts
 */
import assert from "node:assert/strict";
import {
  cacheDoPromptDaLoja, esquecerCacheDaLoja, ehErroDeCacheSumido, limparEstadoDoCacheDoPrompt,
  MAX_CACHES_POR_HORA, RENOVAR_FALTANDO_MS, VIDA_DO_CACHE_S, type ClienteDeCache,
} from "../src/lib/cache-do-prompt";

const pausa = () => new Promise((r) => setTimeout(r, 5));
function falso(opcoes: { falharCriacao?: boolean } = {}) {
  const chamadas = { create: 0, update: 0, delete: [] as string[] };
  let n = 0;
  const ai: ClienteDeCache = {
    caches: {
      async create() {
        chamadas.create++;
        if (opcoes.falharCriacao) throw new Error("Cached content is too small");
        return { name: `cachedContents/c${++n}`, usageMetadata: { totalTokenCount: 12000 } };
      },
      async update() { chamadas.update++; return {}; },
      async delete(p) { chamadas.delete.push(p.name); return {}; },
    },
  };
  return { ai, chamadas };
}
const PROMPT = "Cardápio da loja: ".padEnd(20000, "pizza ");
const base = { loja: "loja1", modelo: "gemini-3.6-flash", apiKey: "chave-x" };
let ok = 0;
const caso = async (nome: string, f: () => Promise<void>) => { limparEstadoDoCacheDoPrompt(); await f(); ok++; console.log("ok -", nome); };

(async () => {
  await caso("loja parada (1 mensagem) não paga diária: segue no cache implícito", async () => {
    const { ai, chamadas } = falso();
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora: 1_000_000 }), null);
    await pausa();
    assert.equal(chamadas.create, 0);
  });

  await caso("2ª mensagem em 10 min guarda em segundo plano; a resposta não espera; a 3ª usa", async () => {
    const { ai, chamadas } = falso();
    const custos: string[] = [];
    const custo = (c: { motivo: string; segundos: number; tokens: number }) => custos.push(`${c.motivo}:${c.tokens}:${c.segundos}`);
    const t0 = Date.now();
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora: t0, custo }), null);
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora: t0 + 60_000, custo }), null, "esta vai como sempre");
    await pausa();
    assert.equal(chamadas.create, 1);
    assert.deepEqual(custos, [`criado:12000:${VIDA_DO_CACHE_S}`]);
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora: Date.now(), custo }), "cachedContents/c1");
    assert.equal(chamadas.create, 1, "não cria de novo");
  });

  await caso("perto de vencer, renova em segundo plano e segue usando", async () => {
    const { ai, chamadas } = falso();
    const agora = Date.now();
    cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora });
    cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora });
    await pausa();
    const quaseVencendo = Date.now() + VIDA_DO_CACHE_S * 1000 - RENOVAR_FALTANDO_MS + 10_000;
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora: quaseVencendo }), "cachedContents/c1");
    await pausa();
    assert.equal(chamadas.update, 1);
  });

  await caso("prompt mudou (loja abriu, cardápio editado): o cache velho é apagado e outro nasce", async () => {
    const { ai, chamadas } = falso();
    const agora = Date.now();
    cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora });
    cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora });
    await pausa();
    const outro = PROMPT + " LOJA ABERTA";
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, prompt: outro, agora: Date.now() }), null, "o prompt novo vai sem cache nesta");
    await pausa();
    assert.deepEqual(chamadas.delete, ["cachedContents/c1"]);
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, prompt: outro, agora: Date.now() }), "cachedContents/c2");
  });

  await caso("prompt que muda a toda hora trava no freio e volta ao cache implícito", async () => {
    const { ai, chamadas } = falso();
    const agora = Date.now();
    cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora });
    for (let i = 0; i < MAX_CACHES_POR_HORA + 3; i++) {
      cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT + i, agora: agora + i * 1000 });
      await pausa();
    }
    assert.equal(chamadas.create, MAX_CACHES_POR_HORA);
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT + 0, agora: agora + 20_000 }), null, "pausado");
  });

  await caso("criação recusada (prompt pequeno demais) não insiste a cada mensagem", async () => {
    const { ai, chamadas } = falso({ falharCriacao: true });
    const agora = Date.now();
    cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora });
    cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora });
    await pausa();
    for (let i = 0; i < 5; i++) cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora: Date.now() });
    await pausa();
    assert.equal(chamadas.create, 1);
  });

  await caso("prompt curto nem tenta", async () => {
    const { ai, chamadas } = falso();
    cacheDoPromptDaLoja(ai, { ...base, prompt: "curto", agora: 1 });
    cacheDoPromptDaLoja(ai, { ...base, prompt: "curto", agora: 2 });
    await pausa();
    assert.equal(chamadas.create, 0);
  });

  await caso("o Google não achou o cache: esquece e a próxima mensagem cria outro", async () => {
    const { ai, chamadas } = falso();
    const agora = Date.now();
    cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora });
    cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora });
    await pausa();
    esquecerCacheDaLoja({ ...base, nome: "cachedContents/c1" });
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, prompt: PROMPT, agora: Date.now() }), null);
    await pausa();
    assert.equal(chamadas.create, 2);
  });

  await caso("cada loja e cada chave tem o seu", async () => {
    const { ai } = falso();
    const agora = Date.now();
    for (const loja of ["a", "b"]) { cacheDoPromptDaLoja(ai, { ...base, loja, prompt: PROMPT, agora }); cacheDoPromptDaLoja(ai, { ...base, loja, prompt: PROMPT, agora }); }
    await pausa();
    assert.notEqual(cacheDoPromptDaLoja(ai, { ...base, loja: "a", prompt: PROMPT, agora: Date.now() }), cacheDoPromptDaLoja(ai, { ...base, loja: "b", prompt: PROMPT, agora: Date.now() }));
    assert.equal(cacheDoPromptDaLoja(ai, { ...base, loja: "a", apiKey: "outra", prompt: PROMPT, agora: Date.now() }), null);
  });

  await caso("SDK sem `caches` (o Gemini falso dos testes) não derruba a resposta", async () => {
    const semCaches = {} as unknown as ClienteDeCache;
    const agora = Date.now();
    assert.equal(cacheDoPromptDaLoja(semCaches, { ...base, prompt: PROMPT, agora }), null);
    assert.equal(cacheDoPromptDaLoja(semCaches, { ...base, prompt: PROMPT, agora }), null);
    assert.equal(cacheDoPromptDaLoja(semCaches, { ...base, prompt: PROMPT, agora }), null);
  });

  await caso("o erro que o Google devolve para cache sumido é reconhecido (e só ele)", async () => {
    assert.equal(ehErroDeCacheSumido(new Error('{"error":{"code":403,"message":"CachedContent not found (or permission denied)","status":"PERMISSION_DENIED"}}')), true);
    assert.equal(ehErroDeCacheSumido(new Error('{"error":{"code":403,"message":"API key not valid","status":"PERMISSION_DENIED"}}')), false);
    assert.equal(ehErroDeCacheSumido(new Error("This operation was aborted")), false);
  });

  console.log(`\n${ok} ok`);
})().catch((e) => { console.error(e); process.exit(1); });
