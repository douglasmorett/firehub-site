// node sessao-compacta.test.cjs — migração arquivos → banco → arquivos com o Baileys real.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { useMultiFileAuthState, BufferJSON, initAuthCreds } = require("@whiskeysockets/baileys");
const sc = require("./sessao-compacta");

const txt = (v) => JSON.stringify(v, BufferJSON.replacer);
// O Baileys monta o objeto na ordem em que as leituras terminam: compara id a id.
const igual = (a, b) => {
  if (a && b && typeof a === "object" && !Buffer.isBuffer(a) && Object.keys(a).every((k) => k in b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).some((k) => /\d/.test(k))) {
    for (const k of Object.keys(b)) assert.equal(txt(a[k]), txt(b[k]), k);
  } else assert.equal(txt(a), txt(b));
};
const pedidos = {
  "pre-key": ["1", "77"],
  session: ["5522999182214.0", "131366423384261_1.0"],
  "identity-key": ["222891656372319_1.0"],
  "lid-mapping": ["5522999182214", "131366423384261_reverse"],
  "app-state-sync-key": ["AAAAAKBc"],
  "device-list": ["5522999182214"],
  tctoken: ["243624252035233@lid"],
  "sender-key": ["120363@g.us::5522:1"],
};

(async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "sessao-"));
  const inst = "firehub_teste";

  // 1) sessão no formato antigo
  const antigo = await useMultiFileAuthState(pasta);
  antigo.state.creds.me = { id: "5522999182214:3@s.whatsapp.net", lid: "131366423384261:3@lid" };
  await antigo.saveCreds();
  await antigo.state.keys.set({
    "pre-key": { 1: { private: Buffer.from("a"), public: Buffer.from("b") }, 77: { private: Buffer.alloc(32, 7), public: Buffer.alloc(32, 8) } },
    session: { "5522999182214.0": { _sessions: { x: Buffer.from("s") } }, "131366423384261_1.0": { y: 1 } },
    "identity-key": { "222891656372319_1.0": Buffer.alloc(33, 1) },
    "lid-mapping": { "5522999182214": "131366423384261", "131366423384261_reverse": "5522999182214" },
    "app-state-sync-key": { AAAAAKBc: { keyData: Buffer.alloc(32, 3), fingerprint: { rawId: 1, currentIndex: 2, deviceIndexes: [0, 1] }, timestamp: 123 } },
    "device-list": { "5522999182214": ["0", "3"] },
    tctoken: { "243624252035233@lid": { token: Buffer.from("t"), timestamp: "9" } },
    "sender-key": { "120363@g.us::5522:1": Buffer.from("k") },
  });
  const esperado = {};
  for (const [t, ids] of Object.entries(pedidos)) esperado[t] = await antigo.state.keys.get(t, ids);
  const arquivosAntes = fs.readdirSync(pasta).filter((n) => n.endsWith(".json")).length;

  // 2) liga o banco: migra, apaga os JSON, lê igual
  process.env.AUTH_COMPACTO = inst;
  const novo = await sc.abrirEstado(pasta, inst);
  const sobra = fs.readdirSync(pasta);
  assert.equal(sobra.filter((n) => n.endsWith(".json")).length, 0, "JSON deveriam ter saído");
  assert.ok(sobra.includes("keys.sqlite"));
  assert.ok(sobra.some((n) => n.startsWith("legacy-backup-")));
  igual(novo.state.creds, antigo.state.creds);
  for (const [t, ids] of Object.entries(pedidos)) igual(await novo.state.keys.get(t, ids), esperado[t]);
  assert.equal(sc.listarNomes(pasta).length, arquivosAntes);

  // 3) grava, apaga chave e salva creds pelo banco
  await novo.state.keys.set({ "pre-key": { 1: null, 900: { private: Buffer.from("n"), public: Buffer.from("m") } } });
  assert.equal((await novo.state.keys.get("pre-key", ["1"]))["1"], null);
  novo.state.creds.nextPreKeyId = 901;
  await novo.saveCreds();
  const reaberto = await sc.abrirEstado(pasta, inst);
  assert.equal(reaberto.state.creds.nextPreKeyId, 901);
  igual((await reaberto.state.keys.get("pre-key", ["900"]))["900"], { private: Buffer.from("n"), public: Buffer.from("m") });

  // 4) apagar por nome (mutirão/apagarSessaoDoContato)
  const doContato = sc.listarNomes(pasta).filter((n) => n.startsWith("session-5522999182214."));
  assert.deepEqual(doContato, ["session-5522999182214.0.json"]);
  sc.apagarNomes(pasta, doContato);
  assert.equal((await reaberto.state.keys.get("session", ["5522999182214.0"]))["5522999182214.0"], null);
  JSON.parse(sc.lerJson(pasta, "creds.json"));

  // 5) volta atrás: desliga → exporta para arquivos → Baileys lê igual
  process.env.AUTH_COMPACTO = "";
  const volta = await sc.abrirEstado(pasta, inst);
  assert.ok(!fs.existsSync(path.join(pasta, "keys.sqlite")));
  assert.equal(volta.state.creds.nextPreKeyId, 901);
  igual((await volta.state.keys.get("app-state-sync-key", ["AAAAAKBc"])).AAAAAKBc, esperado["app-state-sync-key"].AAAAAKBc);
  igual((await volta.state.keys.get("lid-mapping", ["5522999182214"]))["5522999182214"], "131366423384261");

  // 6) logout apaga a pasta; sessão nova nasce no banco com creds novas
  process.env.AUTH_COMPACTO = "*";
  const velho = await sc.abrirEstado(pasta, inst);
  sc.fechar(pasta); // no Linux o rm apaga com o banco aberto; no Windows precisa fechar
  fs.rmSync(pasta, { recursive: true, force: true });
  // socket velho gravando depois do logout: recusa, não recria a pasta
  await assert.rejects(velho.state.keys.set({ "pre-key": { 9: { private: Buffer.from("x"), public: Buffer.from("y") } } }));
  assert.ok(!fs.existsSync(pasta));
  const zerada = await sc.abrirEstado(pasta, inst);
  assert.ok(zerada.state.creds.noiseKey && !zerada.state.creds.me);
  await zerada.state.keys.set({ "pre-key": { 5: { private: Buffer.from("z"), public: Buffer.from("w") } } });
  assert.ok(fs.existsSync(path.join(pasta, "keys.sqlite")));

  // 7) pasta sem creds.json (lixo) não migra nem inventa sessão em cima
  const lixo = fs.mkdtempSync(path.join(os.tmpdir(), "sessao-"));
  fs.writeFileSync(path.join(lixo, "pre-key-1.json"), "{}");
  const deLixo = await sc.abrirEstado(lixo, inst);
  assert.ok(deLixo.state.creds.noiseKey);

  sc.fechar(pasta); sc.fechar(lixo);
  console.log("sessao-compacta: 7 cenários OK");
})().catch((e) => { console.error(e); process.exit(1); });
