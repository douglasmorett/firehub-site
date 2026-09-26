/**
 * O vídeo da capa do cardápio: a conferência do envio (src/lib/video-enviado.ts),
 * o Range (src/lib/pedaco-do-arquivo.ts) e a rota que entrega o arquivo
 * (src/app/uploads/[...path]/route.ts) — o iPhone só toca vídeo servido em pedaços.
 *
 *   npx tsx scripts/teste-video-da-capa.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { codecDoVideo, conferirVideo, MAX_VIDEO_BYTES, tipoRealDoVideo } from "../src/lib/video-enviado";
import { pedacoPedido } from "../src/lib/pedaco-do-arquivo";

export {};

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe ?? ""); }
}

// ── MP4 de mentira, caixa por caixa ──────────────────────────────────────
const txt = (s: string) => Buffer.from(s, "latin1");
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const caixa = (tipo: string, ...filhos: Buffer[]) => {
  const corpo = Buffer.concat(filhos);
  return Buffer.concat([u32(8 + corpo.length), txt(tipo), corpo]);
};
const ftyp = (marca = "isom") => caixa("ftyp", txt(marca), u32(0x200), txt(marca));
const hdlr = (tipo: string) => caixa("hdlr", u32(0), u32(0), txt(tipo), Buffer.alloc(12), Buffer.from([0]));
const stsd = (codec: string) => caixa("stsd", u32(0), u32(1), caixa(codec, Buffer.alloc(78)));
const trak = (tipoDaFaixa: string, codec: string) =>
  caixa("trak", caixa("tkhd", Buffer.alloc(84)), caixa("mdia", caixa("mdhd", Buffer.alloc(24)), hdlr(tipoDaFaixa), caixa("minf", caixa("stbl", stsd(codec)))));
const mp4 = (...traks: Buffer[]) => Buffer.concat([ftyp(), caixa("moov", caixa("mvhd", Buffer.alloc(100)), ...traks), caixa("mdat", Buffer.alloc(64))]);

// ── Tipo pelos bytes ─────────────────────────────────────────────────────
const h264 = mp4(trak("vide", "avc1"), trak("soun", "mp4a"));
confere("MP4 é vídeo/mp4 pelos bytes", tipoRealDoVideo(h264) === "video/mp4");
confere("WebM pelo cabeçalho EBML", tipoRealDoVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])) === "video/webm");
confere("HTML renomeado não é vídeo", tipoRealDoVideo(txt("<html><script>alert(1)</script></html>")) === null);
confere("arquivo curto demais não é vídeo", tipoRealDoVideo(Buffer.from([0, 0, 0])) === null);

// ── Codec ────────────────────────────────────────────────────────────────
confere("H.264 lido da stsd", codecDoVideo(h264) === "avc1", codecDoVideo(h264));
const hevc = mp4(trak("vide", "hvc1"));
confere("HEVC lido da stsd", codecDoVideo(hevc) === "hvc1");
const audioAntes = mp4(trak("soun", "mp4a"), trak("vide", "hev1"));
confere("a faixa de áudio vem antes: vale a de vídeo", codecDoVideo(audioAntes) === "hev1", codecDoVideo(audioAntes));
const moovNoFim = Buffer.concat([ftyp(), caixa("mdat", Buffer.alloc(500)), caixa("moov", trak("vide", "avc1"))]);
confere("moov depois do mdat (vídeo sem faststart)", codecDoVideo(moovNoFim) === "avc1");
const grande = Buffer.concat([ftyp(), u32(1), txt("mdat"), u32(0), u32(16 + 32), Buffer.alloc(32), caixa("moov", trak("vide", "avc1"))]);
confere("caixa de tamanho 64 bits no caminho", codecDoVideo(grande) === "avc1", codecDoVideo(grande));
const truncado = Buffer.concat([ftyp(), u32(9999), txt("moov"), Buffer.alloc(20)]);
confere("MP4 truncado: codec desconhecido, sem estourar", codecDoVideo(truncado) === null);

// ── A conferência do envio ───────────────────────────────────────────────
const a = conferirVideo(h264);
confere("MP4 H.264 passa e grava .mp4", a.ok && a.extensao === "mp4" && a.codec === "avc1", a);
const b = conferirVideo(hevc);
confere("HEVC do iPhone é recusado com a dica do WhatsApp", !b.ok && /HEVC/.test(b.erro) && /WhatsApp/.test(b.erro), b);
const mov = Buffer.concat([ftyp("qt  "), caixa("moov", trak("vide", "avc1"))]);
const c = conferirVideo(mov);
confere("MOV com H.264 passa e grava .mp4", c.ok && c.extensao === "mp4", c);
const d = conferirVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]));
confere("WebM passa e grava .webm", d.ok && d.extensao === "webm", d);
const e = conferirVideo(txt("<html>nada</html>"));
confere("não-vídeo é recusado", !e.ok && /não é um vídeo/.test(e.erro), e);
const f = conferirVideo(h264, MAX_VIDEO_BYTES + 1);
confere("acima de 9 MB é recusado, com o tamanho", !f.ok && /9,0 MB e o limite é 9 MB/.test(f.erro), f);
confere("exatamente 9 MB passa", conferirVideo(h264, MAX_VIDEO_BYTES).ok);
confere("vídeo sem codec legível passa (trava só o que se sabe que quebra)", conferirVideo(truncado).ok);

// ── Range ────────────────────────────────────────────────────────────────
const igual = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
confere("bytes=0-1 (a sondagem do Safari)", igual(pedacoPedido("bytes=0-1", 100), { ini: 0, fim: 1 }));
confere("bytes=0- vai até o fim", igual(pedacoPedido("bytes=0-", 100), { ini: 0, fim: 99 }));
confere("bytes=-10 são os últimos 10", igual(pedacoPedido("bytes=-10", 100), { ini: 90, fim: 99 }));
confere("bytes=-500 num arquivo de 100 é o arquivo todo", igual(pedacoPedido("bytes=-500", 100), { ini: 0, fim: 99 }));
confere("fim além do arquivo é cortado", igual(pedacoPedido("bytes=50-500", 100), { ini: 50, fim: 99 }));
confere("começo depois do fim é 416", pedacoPedido("bytes=100-", 100) === "fora");
confere("bytes=-0 é 416", pedacoPedido("bytes=-0", 100) === "fora");
confere("fim antes do começo: ignora o Range", pedacoPedido("bytes=5-2", 100) === null);
confere("vários pedaços: ignora (vai o arquivo)", pedacoPedido("bytes=0-1,5-9", 100) === null);
confere("sem Range", pedacoPedido(null, 100) === null);
confere("Range que não é de bytes", pedacoPedido("items=0-1", 100) === null);

// ── A rota, de ponta a ponta ─────────────────────────────────────────────
async function rota() {
  const raiz = mkdtempSync(path.join(tmpdir(), "capa-"));
  try {
    mkdirSync(path.join(raiz, "lojas"), { recursive: true });
    const conteudo = Buffer.concat([h264, Buffer.alloc(1000, 7)]);
    writeFileSync(path.join(raiz, "lojas", "capa.mp4"), conteudo);
    writeFileSync(path.join(raiz, "lojas", "logo.webp"), Buffer.from("RIFF0000WEBPVP8 "));
    process.env.UPLOADS_DIR = raiz;
    const { GET } = await import("../src/app/uploads/[...path]/route");
    const { NextRequest } = await import("next/server");
    const pedir = (arquivo: string, range?: string) =>
      GET(new NextRequest(`http://localhost/uploads/lojas/${arquivo}`, { headers: range ? { range } : {} }), {
        params: Promise.resolve({ path: ["lojas", arquivo] }),
      });

    const inteiro = await pedir("capa.mp4");
    const corpo = Buffer.from(await inteiro.arrayBuffer());
    confere("sem Range: 200 com o arquivo inteiro", inteiro.status === 200 && corpo.equals(conteudo), inteiro.status);
    confere("anuncia Accept-Ranges", inteiro.headers.get("accept-ranges") === "bytes");
    confere("tipo video/mp4", inteiro.headers.get("content-type") === "video/mp4");

    const sonda = await pedir("capa.mp4", "bytes=0-1");
    const doisBytes = Buffer.from(await sonda.arrayBuffer());
    confere("bytes=0-1: 206 com 2 bytes", sonda.status === 206 && doisBytes.length === 2 && doisBytes.equals(conteudo.subarray(0, 2)), sonda.status);
    confere("Content-Range certo", sonda.headers.get("content-range") === `bytes 0-1/${conteudo.length}`, sonda.headers.get("content-range"));
    confere("Content-Length do pedaço", sonda.headers.get("content-length") === "2");

    const meio = await pedir("capa.mp4", `bytes=100-${conteudo.length - 1}`);
    const resto = Buffer.from(await meio.arrayBuffer());
    confere("pedaço do meio até o fim", meio.status === 206 && resto.equals(conteudo.subarray(100)));

    const fora = await pedir("capa.mp4", `bytes=${conteudo.length}-`);
    confere("pedaço depois do fim: 416", fora.status === 416 && fora.headers.get("content-range") === `bytes */${conteudo.length}`);

    const imagem = await pedir("logo.webp", "bytes=0-1");
    confere("imagem continua saindo inteira (200)", imagem.status === 200 && imagem.headers.get("content-type") === "image/webp");

    const exe = await pedir("capa.exe");
    confere("extensão fora da lista: 404", exe.status === 404);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

rota()
  .catch((e) => { falhas++; console.log("✖ rota estourou", e); })
  .finally(() => {
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
  });
