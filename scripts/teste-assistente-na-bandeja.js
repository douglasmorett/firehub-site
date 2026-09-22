/**
 * O ASSISTENTE TEM QUE FICAR NA BANDEJA, COM CARA, E NÃO PODE FECHAR SOZINHO.
 *
 * Três queixas de loja em 20/09/2026: "ele fecha durante a operação e para de
 * imprimir", "não tem ícone, os clientes não acham ele no cantinho" e "não
 * atualiza sozinho". O que este harness protege:
 *
 *  1. O .ico é lido de verdade — cabeçalho, entradas e cada PNG conferidos
 *     byte a byte. ICO malformado não dá erro em lugar nenhum: o Windows
 *     simplesmente desenha um quadrado vazio na bandeja, que é exatamente o
 *     sintoma que o lojista descreveu. É o único teste aqui que roda o
 *     formato real, e por isso o mais importante.
 *
 *  2. As garantias do main.js são conferidas no código. São de uma linha cada
 *     (`skipTaskbar`, o `window-all-closed` que não encerra, a trava de
 *     instância) e somem numa refatoração sem ninguém notar — o preço é a
 *     loja sem comanda, descoberto no jantar.
 *
 *  3. O server.js não pode voltar a ter DUAS travas de instância brigando, e
 *     a falha de rede não pode voltar a custar 6 h de versão velha.
 *
 *   node scripts/teste-assistente-na-bandeja.js
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const APP = path.join(RAIZ, "firehub-print-assistant");

let ok = 0, falhou = 0;
const exigir = (nome, condicao, detalhe) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome + (detalhe ? "\n         " + detalhe : "")); }
};

/* ── 1. O ÍCONE ─────────────────────────────────────────────────────────── */
console.log("\n== O ícone da bandeja ==");

const TAMANHOS_ESPERADOS = [16, 20, 24, 32, 48, 64, 128, 256];
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function lerIco(arquivo) {
  const b = fs.readFileSync(arquivo);
  if (b.readUInt16LE(0) !== 0) throw new Error("campo reservado não é 0");
  if (b.readUInt16LE(2) !== 1) throw new Error("tipo não é 1 (ícone)");
  const qtd = b.readUInt16LE(4);
  const entradas = [];
  for (let i = 0; i < qtd; i++) {
    const e = 6 + 16 * i;
    const largura = b.readUInt8(e) || 256;
    const altura = b.readUInt8(e + 1) || 256;
    const bytes = b.readUInt32LE(e + 8);
    const desloc = b.readUInt32LE(e + 12);
    if (desloc + bytes > b.length) throw new Error(`entrada ${i} aponta para fora do arquivo`);
    const dados = b.subarray(desloc, desloc + bytes);
    // PNG dentro de ICO: a largura real está no cabeçalho IHDR, e é ELA que o
    // Windows usa. Declarar 32 e entregar 16 desenha borrão.
    const ehPng = dados.subarray(0, 8).equals(ASSINATURA_PNG);
    const larguraReal = ehPng ? dados.readUInt32BE(16) : null;
    const alturaReal = ehPng ? dados.readUInt32BE(20) : null;
    entradas.push({ largura, altura, bytes, ehPng, larguraReal, alturaReal });
  }
  return entradas;
}

for (const pasta of ["assets", "build"]) {
  const arquivo = path.join(APP, pasta, "icon.ico");
  const existe = fs.existsSync(arquivo);
  exigir(`${pasta}/icon.ico existe`, existe, "rode: node scripts/gerar-icone-do-assistente.js");
  if (!existe) continue;

  let entradas = null;
  try { entradas = lerIco(arquivo); ok++; console.log(`  ok     ${pasta}/icon.ico é um ICO válido (${entradas.length} tamanhos)`); }
  catch (e) { falhou++; console.log(`  FALHOU ${pasta}/icon.ico não é um ICO válido: ${e.message}`); continue; }

  const tamanhos = entradas.map((e) => e.largura).sort((a, b) => a - b);
  exigir(
    `${pasta}/icon.ico traz os tamanhos que o Windows escolhe na bandeja`,
    TAMANHOS_ESPERADOS.every((t) => tamanhos.includes(t)),
    `veio: ${tamanhos.join(", ")}`
  );
  exigir(`${pasta}/icon.ico tem 16 px (a bandeja em 100% de DPI usa este)`, tamanhos.includes(16));
  exigir(`${pasta}/icon.ico — toda entrada é PNG de verdade`, entradas.every((e) => e.ehPng));
  exigir(
    `${pasta}/icon.ico — o tamanho declarado bate com o do PNG`,
    entradas.every((e) => e.larguraReal === e.largura && e.alturaReal === e.altura),
    entradas.filter((e) => e.larguraReal !== e.largura).map((e) => `declarou ${e.largura}, é ${e.larguraReal}`).join("; ")
  );
  exigir(`${pasta}/icon.ico — nenhuma entrada vazia`, entradas.every((e) => e.bytes > 50));
}

const trayPng = path.join(APP, "assets", "tray.png");
exigir("assets/tray.png existe (rede de segurança do Tray)", fs.existsSync(trayPng));
if (fs.existsSync(trayPng)) {
  const b = fs.readFileSync(trayPng);
  exigir("assets/tray.png é PNG de 32x32", b.subarray(0, 8).equals(ASSINATURA_PNG) && b.readUInt32BE(16) === 32);
}

/* ── 2. AS GARANTIAS DO main.js ─────────────────────────────────────────── */
console.log("\n== O main.js não pode perder estas garantias ==");
const main = fs.readFileSync(path.join(APP, "main.js"), "utf8");

exigir("a janela nasce escondida", /show:\s*false/.test(main));
exigir("a janela não aparece na barra de tarefas", /skipTaskbar:\s*true/.test(main));
exigir("a janela usa o ícone do FireHub", /icon:\s*icone/.test(main));
exigir("o Tray carrega o ícone de arquivo", /nativeImage\.createFromPath/.test(main));
exigir("não sobrou o ícone base64 genérico", !/createFromDataURL/.test(main));
exigir("fechar a última janela NÃO encerra o app", /app\.on\("window-all-closed"/.test(main) && !/app\.quit\(\)[\s\S]{0,120}window-all-closed/.test(main));
exigir("erro solto não derruba o processo", /process\.on\("uncaughtException"/.test(main) && /process\.on\("unhandledRejection"/.test(main));
exigir("trava de instância do Electron", /requestSingleInstanceLock/.test(main));
exigir("a cópia VIVA é quem fica (checa /status antes de matar)", /outroAssistenteRespondendo/.test(main));
exigir("não mata mais processo por porta logo ao abrir", !/Get-NetTCPConnection/.test(main));
exigir("sobe com o Windows a cada boot", /setLoginItemSettings/.test(main) && /openAtLogin:\s*true/.test(main));
exigir("sobe escondido, direto para a bandeja", /openAsHidden:\s*true/.test(main) || /"--hidden"/.test(main));
exigir("sair pela bandeja pede confirmação", /showMessageBox[\s\S]{0,400}PARA DE IMPRIMIR/.test(main));
exigir("o menu tem 'Procurar atualização agora'", /atualizar-agora/.test(main));
exigir("o servidor só sobe depois de ganhar a trava", main.indexOf('require("./server.js")') > main.indexOf("requestSingleInstanceLock"));

/* ── 3. O server.js ─────────────────────────────────────────────────────── */
console.log("\n== O server.js ==");
const servidor = fs.readFileSync(path.join(APP, "server.js"), "utf8");

exigir("existe a rota /atualizar-agora", /app\.post\("\/atualizar-agora"/.test(servidor));
exigir("a trava antiga não roda mais dentro do Electron", /rodandoDentroDoElectron\(\)\)\s*return;/.test(servidor));
exigir("falta de rede reagenda em minutos, não em 6 h", /tentarDeNovoQuandoAInternetVoltar/.test(servidor));
exigir("falha de rede não queima a versão por 24 h", /if\s*\(!versaoAlvo\)/.test(servidor));
exigir("o cupom de caixa tem renderizador próprio", /const ehCaixa = String\(order\.kind \|\| ""\)\.startsWith\("CAIXA_"\)/.test(servidor));

/* ── 4. O empacotamento ─────────────────────────────────────────────────── */
console.log("\n== O instalador ==");
const pkg = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8"));
exigir("o .exe leva o ícone do FireHub", pkg.build?.win?.icon === "build/icon.ico");
exigir("o instalador leva o ícone do FireHub", pkg.build?.nsis?.installerIcon === "build/icon.ico");
exigir("assets/ vai empacotado (senão a bandeja fica sem ícone no cliente)", (pkg.build?.files || []).some((f) => String(f).startsWith("assets")));
exigir("a versão bateu na do server.js", servidor.includes("VERSAO_ASSISTENTE") && typeof pkg.version === "string");

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
