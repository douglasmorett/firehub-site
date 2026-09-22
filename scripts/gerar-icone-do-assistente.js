/**
 * O ÍCONE DO ASSISTENTE — bandeja, janela, atalho e instalador.
 *
 * O Assistente nunca teve arquivo de ícone. Na bandeja do Windows ele saía
 * como um quadrado branco (um PNG 16x16 genérico embutido em base64 no
 * main.js), e o lojista não conseguia achá-lo entre os outros ícones perto do
 * relógio — quando o programa "sumia", ninguém sabia se estava rodando.
 * No instalador e no atalho, saía o ícone padrão do Electron.
 *
 * Agora sai a chama do FireHub, a mesma de public/firehub-flame.png, que é a
 * logo que o lojista já reconhece do painel.
 *
 * O .ico é montado à mão porque o `sharp` não escreve ICO: o formato é só um
 * cabeçalho seguido dos PNGs, e o Windows (Vista+) lê entradas PNG direto.
 * Ter TODOS os tamanhos importa — o Windows escolhe 16 ou 20 px para a
 * bandeja conforme o DPI, e um ícone só de 256 vira borrão quando reduzido.
 *
 *   node scripts/gerar-icone-do-assistente.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const RAIZ = path.resolve(__dirname, "..");
const ORIGEM = path.join(RAIZ, "public", "firehub-flame.png");
// `build/` é o `buildResources` do electron-builder: de lá saem o ícone do
// .exe, do atalho e do instalador — e ELE NÃO VAI para dentro do app. Por isso
// o ícone da bandeja é gravado também em `assets/`, que é empacotado e pode ser
// lido em tempo de execução de dentro do asar.
const DESTINO = path.join(RAIZ, "firehub-print-assistant", "build");
const DESTINO_APP = path.join(RAIZ, "firehub-print-assistant", "assets");

const TAMANHOS = [16, 20, 24, 32, 48, 64, 128, 256];

function montarIco(pngs) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // 1 = ícone
  cabecalho.writeUInt16LE(pngs.length, 4);

  const entradas = Buffer.alloc(16 * pngs.length);
  let deslocamento = cabecalho.length + entradas.length;

  pngs.forEach(({ tamanho, dados }, i) => {
    const e = 16 * i;
    // 256 é gravado como 0: o campo tem 1 byte só.
    entradas.writeUInt8(tamanho >= 256 ? 0 : tamanho, e + 0);
    entradas.writeUInt8(tamanho >= 256 ? 0 : tamanho, e + 1);
    entradas.writeUInt8(0, e + 2);  // paleta
    entradas.writeUInt8(0, e + 3);  // reservado
    entradas.writeUInt16LE(1, e + 4);  // planos
    entradas.writeUInt16LE(32, e + 6); // bits por pixel
    entradas.writeUInt32LE(dados.length, e + 8);
    entradas.writeUInt32LE(deslocamento, e + 12);
    deslocamento += dados.length;
  });

  return Buffer.concat([cabecalho, entradas, ...pngs.map((p) => p.dados)]);
}

async function main() {
  if (!fs.existsSync(ORIGEM)) throw new Error("não achei a logo em " + ORIGEM);
  fs.mkdirSync(DESTINO, { recursive: true });
  fs.mkdirSync(DESTINO_APP, { recursive: true });

  const pngs = [];
  for (const tamanho of TAMANHOS) {
    const dados = await sharp(ORIGEM)
      .resize(tamanho, tamanho, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    pngs.push({ tamanho, dados });
  }

  const ico = montarIco(pngs);
  for (const pasta of [DESTINO, DESTINO_APP]) {
    const alvo = path.join(pasta, "icon.ico");
    fs.writeFileSync(alvo, ico);
    console.log(`ok  ${alvo}  (${TAMANHOS.join(", ")} px, ${(ico.length / 1024).toFixed(1)} KB)`);
  }

  // PNG solto para a bandeja: em alguns Windows o Tray com .ico sai borrado
  // quando o DPI não é 100%. O main.js tenta o .ico e cai neste.
  for (const pasta of [DESTINO, DESTINO_APP]) {
    const alvo = path.join(pasta, "tray.png");
    await sharp(ORIGEM).resize(32, 32).png({ compressionLevel: 9 }).toFile(alvo);
    console.log(`ok  ${alvo}`);
  }

  // 256 px para a janela (BrowserWindow icon) e para o instalador NSIS.
  for (const pasta of [DESTINO, DESTINO_APP]) {
    const alvo = path.join(pasta, "icon.png");
    await sharp(ORIGEM).resize(256, 256).png({ compressionLevel: 9 }).toFile(alvo);
    console.log(`ok  ${alvo}`);
  }
}

main().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
