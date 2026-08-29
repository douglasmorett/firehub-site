/**
 * /src/lib/zip.ts
 *
 * Um ZIP mínimo, sem compressão (método "stored").
 *
 * POR QUE ESCREVER ISTO EM VEZ DE INSTALAR UMA BIBLIOTECA. O pacote do contador
 * é um punhado de XMLs e um CSV — arquivos de texto, alguns quilobytes cada. A
 * compressão economizaria pouco e traria uma dependência nova para o container
 * de produção só para juntar arquivos numa pasta. O formato "stored" é a parte
 * mais antiga e mais estável do ZIP: qualquer descompactador do mundo, incluindo
 * o do Windows sem programa nenhum instalado, abre.
 *
 * O que NÃO fazer com isto: arquivos grandes (tudo fica na memória) ou binários
 * onde o tamanho importe. Para o pacote mensal de uma loja, serve.
 */

/** CRC-32, exigido pelo formato. Tabela montada uma vez. */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data/hora no formato MS-DOS que o ZIP usa (precisão de 2 segundos). */
function dataDosEHora(d: Date): { data: number; hora: number } {
  return {
    data: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

export type ArquivoDoZip = { nome: string; conteudo: Buffer | string };

export function montarZip(arquivos: ArquivoDoZip[], quando: Date = new Date()): Buffer {
  const { data, hora } = dataDosEHora(quando);
  const locais: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, "utf8");
    const conteudo = Buffer.isBuffer(arquivo.conteudo)
      ? arquivo.conteudo
      : Buffer.from(arquivo.conteudo, "utf8");
    const crc = crc32(conteudo);

    const cabecalhoLocal = Buffer.alloc(30);
    cabecalhoLocal.writeUInt32LE(0x04034b50, 0); // assinatura
    cabecalhoLocal.writeUInt16LE(20, 4); // versão necessária
    cabecalhoLocal.writeUInt16LE(0x0800, 6); // bit 11: nome em UTF-8
    cabecalhoLocal.writeUInt16LE(0, 8); // método 0 = stored
    cabecalhoLocal.writeUInt16LE(hora, 10);
    cabecalhoLocal.writeUInt16LE(data, 12);
    cabecalhoLocal.writeUInt32LE(crc, 14);
    cabecalhoLocal.writeUInt32LE(conteudo.length, 18);
    cabecalhoLocal.writeUInt32LE(conteudo.length, 22);
    cabecalhoLocal.writeUInt16LE(nome.length, 26);
    cabecalhoLocal.writeUInt16LE(0, 28);

    locais.push(cabecalhoLocal, nome, conteudo);

    const entradaCentral = Buffer.alloc(46);
    entradaCentral.writeUInt32LE(0x02014b50, 0);
    entradaCentral.writeUInt16LE(20, 4); // versão de quem criou
    entradaCentral.writeUInt16LE(20, 6); // versão necessária
    entradaCentral.writeUInt16LE(0x0800, 8);
    entradaCentral.writeUInt16LE(0, 10);
    entradaCentral.writeUInt16LE(hora, 12);
    entradaCentral.writeUInt16LE(data, 14);
    entradaCentral.writeUInt32LE(crc, 16);
    entradaCentral.writeUInt32LE(conteudo.length, 20);
    entradaCentral.writeUInt32LE(conteudo.length, 24);
    entradaCentral.writeUInt16LE(nome.length, 28);
    entradaCentral.writeUInt16LE(0, 30); // extra
    entradaCentral.writeUInt16LE(0, 32); // comentário
    entradaCentral.writeUInt16LE(0, 34); // disco
    entradaCentral.writeUInt16LE(0, 36); // atributos internos
    entradaCentral.writeUInt32LE(0, 38); // atributos externos
    entradaCentral.writeUInt32LE(deslocamento, 42);

    central.push(entradaCentral, nome);
    deslocamento += cabecalhoLocal.length + nome.length + conteudo.length;
  }

  const corpoCentral = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4); // disco
  fim.writeUInt16LE(0, 6); // disco do diretório
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(corpoCentral.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  fim.writeUInt16LE(0, 20); // comentário

  return Buffer.concat([...locais, corpoCentral, fim]);
}
