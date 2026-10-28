/**
 * Sessão do WhatsApp num arquivo só (SQLite), em vez de um JSON por chave.
 *
 * Por quê: o `useMultiFileAuthState` do Baileys grava um arquivo por chave
 * (pre-key, session, identity-key, lid-mapping…). Com 44 lojas o volume chegou a
 * 305 mil arquivos e esgotou os INODES com 27% do disco usado (27/10/2026):
 * ENOSPC ao gravar identity-key, mensagem que não decifra, robô mudo para
 * cliente novo.
 *
 * O banco guarda cada chave pelo MESMO nome de arquivo que o Baileys usaria
 * (`session-123_1.0.json`). Assim a migração é cópia, não tradução, e o código
 * que procura "session-<número>" continua valendo.
 *
 * Ligado por instância em AUTH_COMPACTO ("*" = todas; ou lista separada por
 * vírgula). Fora da lista a instância usa os arquivos — e, se já tinha banco,
 * ele é exportado de volta para arquivos antes (volta atrás sem pedir QR).
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { useMultiFileAuthState, initAuthCreds, BufferJSON, proto } = require("@whiskeysockets/baileys");
const { openCompactKeyStore } = require("./compact-key-store.cjs");

const BANCO = "keys.sqlite";
const abertos = new Map(); // pasta → { store, ino }

function ligadoPara(instanceName) {
  const lista = String(process.env.AUTH_COMPACTO || "").split(",").map((s) => s.trim()).filter(Boolean);
  return lista.includes("*") || lista.includes(instanceName);
}

const nomeDoArquivo = (type, id) => `${type}-${id}.json`.replace(/\//g, "__").replace(/:/g, "-");
const temBanco = (pasta) => fs.existsSync(path.join(pasta, BANCO));
const jsonsDaPasta = (pasta) => {
  try { return fs.readdirSync(pasta).filter((n) => n.endsWith(".json")); } catch { return []; }
};

/**
 * O banco aberto desta pasta. Reabre se a pasta foi apagada/recriada (logout).
 * Só `abrirEstado` cria banco: um socket velho gravando depois do logout não
 * pode ressuscitar uma sessão sem credenciais na pasta apagada.
 */
function storeDa(pasta, criar = false) {
  const arquivo = path.join(pasta, BANCO);
  const atual = abertos.get(pasta);
  let ino = null;
  try { ino = fs.statSync(arquivo).ino; } catch {}
  if (atual && atual.ino === ino) return atual.store;
  if (atual) { try { atual.store.close(); } catch {} abertos.delete(pasta); }
  if (ino === null && !criar) throw new Error(`sem ${BANCO} em ${path.basename(pasta)}`);
  const store = openCompactKeyStore(pasta);
  abertos.set(pasta, { store, ino: fs.statSync(arquivo).ino });
  return store;
}

function fechar(pasta) {
  const atual = abertos.get(pasta);
  if (!atual) return;
  try { atual.store.close(); } catch {}
  abertos.delete(pasta);
}

function apagarBanco(pasta) {
  fechar(pasta);
  for (const sufixo of ["", "-wal", "-shm"]) fs.rmSync(path.join(pasta, BANCO + sufixo), { force: true });
}

/**
 * Arquivos → banco. Só apaga os arquivos depois de: backup .gz conferido, cópia
 * gravada numa transação e cada item relido igual. Qualquer falha antes disso
 * desfaz o banco e a instância segue nos arquivos.
 */
function migrar(pasta, instanceName) {
  const nomes = jsonsDaPasta(pasta);
  if (!nomes.includes("creds.json")) return false;
  const itens = [];
  for (const nome of nomes) {
    const json = fs.readFileSync(path.join(pasta, nome), "utf8");
    try { JSON.parse(json); } catch { continue; } // o Baileys já trata como ausente
    itens.push([nome, json]);
  }
  const backup = path.join(pasta, `legacy-backup-${Date.now()}.json.gz`);
  const conteudo = JSON.stringify(itens);
  fs.writeFileSync(backup, zlib.gzipSync(conteudo), { flag: "wx", mode: 0o600 });
  if (zlib.gunzipSync(fs.readFileSync(backup)).toString("utf8") !== conteudo) {
    fs.rmSync(backup, { force: true });
    throw new Error("backup não confere");
  }
  try {
    const store = storeDa(pasta, true);
    store.set(itens);
    if (store.count() !== itens.length || itens.some(([n, j]) => store.get(n) !== j)) {
      throw new Error("cópia no banco não confere");
    }
  } catch (err) {
    apagarBanco(pasta);
    fs.rmSync(backup, { force: true });
    throw err;
  }
  for (const nome of nomes) fs.rmSync(path.join(pasta, nome), { force: true });
  console.log(`[WhatsApp Gateway] 🗜️ ${instanceName}: ${itens.length} chaves migradas para ${BANCO} (backup ${path.basename(backup)}).`);
  return true;
}

/** Banco → arquivos (volta atrás). O banco só sai depois de cada arquivo conferido. */
function exportar(pasta, instanceName) {
  const store = storeDa(pasta);
  let n = 0;
  for (const { name, json } of store.entries()) {
    if (!/^[\w@.+-]+\.json$/.test(name) || name.includes("..")) throw new Error(`nome inseguro: ${name}`);
    fs.writeFileSync(path.join(pasta, name), json, { mode: 0o600 });
    if (fs.readFileSync(path.join(pasta, name), "utf8") !== json) throw new Error(`exportação não confere: ${name}`);
    n++;
  }
  fechar(pasta);
  fs.renameSync(path.join(pasta, BANCO), path.join(pasta, `${BANCO}.exportado-${Date.now()}`));
  for (const sufixo of ["-wal", "-shm"]) fs.rmSync(path.join(pasta, BANCO + sufixo), { force: true });
  console.log(`[WhatsApp Gateway] ↩️ ${instanceName}: ${n} chaves exportadas de volta para arquivos.`);
}

function estadoDoBanco(pasta) {
  const store = storeDa(pasta, true);
  const crus = store.get("creds.json");
  const creds = crus ? JSON.parse(crus, BufferJSON.reviver) : initAuthCreds();
  if (!crus) store.set([["creds.json", JSON.stringify(creds, BufferJSON.replacer)]]);
  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const s = storeDa(pasta);
          const out = {};
          for (const id of ids) {
            const j = s.get(nomeDoArquivo(type, id));
            let v = j === null ? null : JSON.parse(j, BufferJSON.reviver);
            if (type === "app-state-sync-key" && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }
          return out;
        },
        async set(data) {
          const itens = [];
          for (const [type, valores] of Object.entries(data)) {
            for (const [id, v] of Object.entries(valores || {})) {
              itens.push([nomeDoArquivo(type, id), v ? JSON.stringify(v, BufferJSON.replacer) : null]);
            }
          }
          if (itens.length) storeDa(pasta).set(itens);
        },
      },
    },
    async saveCreds() {
      storeDa(pasta).set([["creds.json", JSON.stringify(creds, BufferJSON.replacer)]]);
    },
  };
}

/** Substitui `useMultiFileAuthState(pasta)`. */
async function abrirEstado(pasta, instanceName) {
  fs.mkdirSync(pasta, { recursive: true });
  if (!ligadoPara(instanceName)) {
    if (temBanco(pasta)) exportar(pasta, instanceName);
    return useMultiFileAuthState(pasta);
  }
  if (!temBanco(pasta) && jsonsDaPasta(pasta).length) {
    try { migrar(pasta, instanceName); }
    catch (err) {
      console.error(`[WhatsApp Gateway] ❌ ${instanceName}: migração para ${BANCO} falhou, segue nos arquivos:`, err.message);
      return useMultiFileAuthState(pasta);
    }
  }
  // Sobra de arquivo com banco já existente (migração interrompida no apagar):
  // o banco é a fonte; os arquivos estão no backup.
  for (const nome of jsonsDaPasta(pasta)) fs.rmSync(path.join(pasta, nome), { force: true });
  return estadoDoBanco(pasta);
}

// ── Leitura/remoção por nome, valendo para arquivos E banco ─────────────────
function listarNomes(pasta) {
  const nomes = jsonsDaPasta(pasta);
  if (!temBanco(pasta)) return nomes;
  const store = storeDa(pasta);
  for (const { name } of store.entries()) nomes.push(name);
  return nomes;
}

function lerJson(pasta, nome) {
  if (temBanco(pasta)) {
    const j = storeDa(pasta).get(nome);
    if (j !== null) return j;
  }
  return fs.readFileSync(path.join(pasta, nome), "utf8");
}

function apagarNomes(pasta, nomes) {
  if (!nomes.length) return;
  if (temBanco(pasta)) storeDa(pasta).set(nomes.map((n) => [n, null]));
  for (const n of nomes) fs.rmSync(path.join(pasta, n), { force: true });
}

module.exports = { abrirEstado, listarNomes, lerJson, apagarNomes, fechar, ligadoPara };
