/**
 * scripts/montar-instalador-completo.js — o instalador COMPLETO do FireHub
 * para Windows ("FireHub-Completo-Setup.exe").
 *
 * É o MESMO Assistente (mesmo appId, mesma pasta, mesmo nome): instalado por
 * cima de um Assistente que já existe, vira uma atualização, não um segundo
 * programa (dois Assistentes imprimiriam em dobro, ver instancias.js). A
 * diferença é a semente (scripts/montar-semente.js) em resources/semente:
 * com ela o computador ativa a contingência sem baixar o FireHub, e o
 * Assistente cria o ícone "FireHub" que abre o sistema em janela própria
 * (main.js, item 7; janela-do-firehub.js). Depois disso tudo se atualiza
 * sozinho como sempre: o Assistente pelo /api/assistente/versao e o FireHub
 * do computador por hash (só o que mudou).
 *
 *   node scripts/montar-instalador-completo.js --semente <pasta da semente> [--saida <pasta>]
 *
 * Não publica nada: o .exe fica em <saida> (padrão dist-completo/).
 */
const fs = require("fs");
const path = require("path");

function argumento(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : null;
}

/** A configuração do electron-builder: a do package.json + a semente e o nome do arquivo. */
function configuracaoCompleta(base, semente, saida) {
  return {
    ...base,
    directories: { ...(base.directories || {}), output: saida },
    extraResources: [...(base.extraResources || []), { from: semente, to: "semente", filter: ["**/*"] }],
    win: { ...(base.win || {}), target: ["nsis"] },
    nsis: { ...(base.nsis || {}), artifactName: "FireHub-Completo-Setup.exe" },
    // O que pesa é a semente (já comprimida em boa parte: .zip, .tgz, .wasm…);
    // "maximum" leva vários minutos a mais e quase não muda o tamanho.
    compression: "normal",
  };
}

async function principal() {
  const raiz = path.resolve(__dirname, "..");
  const semente = path.resolve(argumento("--semente") || "");
  const saida = path.resolve(argumento("--saida") || path.join(raiz, "dist-completo"));
  if (!argumento("--semente") || !fs.existsSync(path.join(semente, "semente.json"))) {
    throw new Error("Uso: node scripts/montar-instalador-completo.js --semente <pasta com semente.json>");
  }
  for (const precisa of ["objetos", "runtime/node.zip", "runtime/postgres.tgz"]) {
    if (!fs.existsSync(path.join(semente, precisa))) throw new Error(`A semente está incompleta: falta ${precisa}.`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));
  const builder = require("electron-builder");
  const inicio = Date.now();
  const feitos = await builder.build({
    projectDir: raiz,
    targets: builder.Platform.WINDOWS.createTarget(["nsis"], builder.Arch.x64),
    config: configuracaoCompleta(pkg.build, semente, saida),
  });
  for (const f of feitos.filter((f) => f.endsWith(".exe"))) {
    console.log(`${f} — ${(fs.statSync(f).size / 1024 / 1024).toFixed(1)} MB (${Math.round((Date.now() - inicio) / 1000)} s)`);
  }
}

if (require.main === module) {
  principal().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = { configuracaoCompleta };
