/**
 * Empacota firehub-prazos-extension/ em public/downloads/FireHub-Prazos-Extensao.zip.
 *
 * Zip escrito à mão (deflate-raw + CRC32) porque Compress-Archive e o
 * ZipFile do .NET gravam os caminhos com barra invertida — o Chrome recusa a
 * extensão ao descompactar em outro sistema. Uso: `node scripts/zipar-extensao-prazos.js`.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const RAIZ = path.join(__dirname, "..", "firehub-prazos-extension");
const SAIDA = path.join(__dirname, "..", "public", "downloads", "FireHub-Prazos-Extensao.zip");

function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function listar(dir, base) {
  const saida = [];
  for (const nome of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, nome);
    const rel = base ? base + "/" + nome : nome;
    if (fs.statSync(abs).isDirectory()) saida.push(...listar(abs, rel));
    else saida.push({ abs, rel });
  }
  return saida;
}

function dosData(d) {
  const tempo = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { tempo, data };
}

const arquivos = listar(RAIZ, "");
const partes = [];
const central = [];
let offset = 0;
const agora = dosData(new Date());
for (const a of arquivos) {
  const nome = Buffer.from(a.rel, "utf8");
  const dados = fs.readFileSync(a.abs);
  const comp = zlib.deflateRawSync(dados, { level: 9 });
  const crc = crc32(dados);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(agora.tempo, 10); local.writeUInt16LE(agora.data, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28);
  partes.push(local, nome, comp);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
  cd.writeUInt16LE(agora.tempo, 12); cd.writeUInt16LE(agora.data, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(dados.length, 24);
  cd.writeUInt16LE(nome.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
  central.push(cd, nome);
  offset += local.length + nome.length + comp.length;
}
const centralBuf = Buffer.concat(central);
const fim = Buffer.alloc(22);
fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(0, 4); fim.writeUInt16LE(0, 6); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
fim.writeUInt32LE(centralBuf.length, 12); fim.writeUInt32LE(offset, 16); fim.writeUInt16LE(0, 20);
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, Buffer.concat([...partes, centralBuf, fim]));
console.log(`zip: ${arquivos.length} arquivos, ${fs.statSync(SAIDA).size} bytes → ${path.relative(process.cwd(), SAIDA)}`);
