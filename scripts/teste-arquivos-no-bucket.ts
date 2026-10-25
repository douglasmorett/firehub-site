/**
 * Os arquivos no bucket (Cloudflare R2) para duas instâncias:
 * src/lib/arquivos-no-bucket.ts, lib/storage.ts, a rota /uploads e o cofre
 * fiscal (lib/nfce/armazenamento.ts), mais o script de cópia inicial.
 *
 *   npx tsx scripts/teste-arquivos-no-bucket.ts
 *
 * Sem rede: o bucket é um servidor HTTP local que imita o S3 (PUT, GET com
 * Range, HEAD, DELETE e a listagem) e CONFERE a assinatura de cada pedido. A
 * "instância B" é outro processo, com outra pasta de uploads e o mesmo bucket.
 */
import { spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import http from "http";
import { tmpdir } from "os";
import path from "path";
import { assinarSigV4, codificar } from "../src/lib/arquivos-no-bucket";

export {};

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe ?? ""); }
}

const SEGREDO = "segredo-de-teste-do-bucket";
const BUCKET = "firehub-teste";
const ehB = process.argv.includes("--instancia-b");

// ─── 1. Assinatura: vetores oficiais da AWS ──────────────────────────────
// Suíte "aws-sig-v4-test-suite" (a mesma de packages/signature-v4 do SDK JS):
// serviço "service", us-east-1, AKIDEXAMPLE, 30/08/2015 12:36:00 UTC.
function vetoresDaAws() {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const suite = (nome: string, metodo: string, caminho: string, query: [string, string][], cab: Record<string, string>, corpo: string, assinatura: string, assinados = "host;x-amz-date") => {
    const q = query.map(([k, v]) => `${codificar(k)}=${codificar(v)}`).join("&");
    const url = new URL(`https://example.amazonaws.com${caminho.split("/").map(codificar).join("/")}${q ? "?" + q : ""}`);
    const obtido = assinarSigV4({
      metodo, url, cabecalhos: { "x-amz-date": "20150830T123600Z", ...cab }, hashDoCorpo: sha(corpo),
      regiao: "us-east-1", servico: "service", chaveId: "AKIDEXAMPLE", segredo: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      quando: new Date("2015-08-30T12:36:00Z"),
    });
    const esperado = `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=${assinados}, Signature=${assinatura}`;
    confere(`AWS: ${nome}`, obtido === esperado, obtido);
  };
  suite("get-vanilla", "GET", "/", [], {}, "", "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  suite("get-vanilla-query-order-key-case", "GET", "/", [["Param2", "value2"], ["Param1", "value1"]], {}, "", "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500");
  suite("get-vanilla-query-unreserved", "GET", "/", [["-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"]], {}, "", "9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197");
  suite("get-vanilla-utf8-query", "GET", "/", [["ሴ", "bar"]], {}, "", "2cdec8eed098649ff3a119c94853b13c643bcf08f8b0a1d91e12c9027818dd04");
  suite("get-unreserved", "GET", "/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", [], {}, "", "07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f");
  suite("get-utf8", "GET", "/ሴ", [], {}, "", "8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85");
  suite("get-header-value-trim", "GET", "/", [], { "my-header1": "value1", "my-header2": '"a   b   c"' }, "", "acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736", "host;my-header1;my-header2;x-amz-date");
  suite("post-vanilla", "POST", "/", [], {}, "", "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b");
  suite("post-vanilla-query-nonunreserved", "POST", "/", [["@#$%^", ""], ["+", '/,?><`";:\\|][{}']], {}, "", "66c82657c86e26fb25238d0e69f011edc4c6df5ae71119d7cb98ed9b87393c1e");
  suite("post-x-www-form-urlencoded", "POST", "/", [], { "content-type": "application/x-www-form-urlencoded" }, "Param1=value1", "ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a", "content-type;host;x-amz-date");

  // O exemplo "GET Object" da documentação do S3 (Signature Version 4, header-based auth):
  // examplebucket, test.txt, Range bytes=0-9, 24/05/2013.
  const vazio = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const s3 = assinarSigV4({
    metodo: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
    cabecalhos: { range: "bytes=0-9", "x-amz-content-sha256": vazio, "x-amz-date": "20130524T000000Z" }, hashDoCorpo: vazio,
    regiao: "us-east-1", servico: "s3", chaveId: "AKIAIOSFODNN7EXAMPLE", segredo: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    quando: new Date("2013-05-24T00:00:00Z"),
  });
  confere("AWS S3: GET Object", s3.endsWith("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"), s3);
}

// ─── O bucket falso ──────────────────────────────────────────────────────
type Objeto = { corpo: Buffer; tipo: string };
const guardados = new Map<string, Objeto>();
const pedidos: { metodo: string; chave: string }[] = [];
let foraDoAr = false;

function bucketFalso(): Promise<{ endpoint: string; fechar: () => void }> {
  const servidor = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => {
      const corpo = Buffer.concat(partes);
      const url = new URL(`http://${req.headers.host}${req.url}`);
      const caminho = url.pathname.split("/").map((p) => decodeURIComponent(p));
      const chave = caminho.slice(2).join("/");
      pedidos.push({ metodo: req.method || "", chave });
      if (foraDoAr) { res.writeHead(500).end("InternalError"); return; }

      // Confere a assinatura como o S3: refaz com o segredo e compara.
      const auth = String(req.headers.authorization || "");
      const assinados = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(";") || [];
      const cab: Record<string, string> = {};
      for (const n of assinados) if (n !== "host") cab[n] = String(req.headers[n] ?? "");
      const data = String(req.headers["x-amz-date"] || "");
      const quando = new Date(`${data.slice(0, 4)}-${data.slice(4, 6)}-${data.slice(6, 8)}T${data.slice(9, 11)}:${data.slice(11, 13)}:${data.slice(13, 15)}Z`);
      const hash = createHash("sha256").update(corpo).digest("hex");
      const esperado = assinarSigV4({ metodo: req.method || "", url, cabecalhos: cab, hashDoCorpo: hash, regiao: "auto", servico: "s3", chaveId: "chave-de-teste", segredo: SEGREDO, quando });
      if (caminho[1] !== BUCKET || auth !== esperado || req.headers["x-amz-content-sha256"] !== hash) {
        res.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
        return;
      }

      if (req.method === "PUT") {
        guardados.set(chave, { corpo, tipo: String(req.headers["content-type"] || "") });
        res.writeHead(200).end();
      } else if (req.method === "DELETE") {
        guardados.delete(chave);
        res.writeHead(204).end();
      } else if (!chave && url.searchParams.get("list-type") === "2") {
        // Duas por página, para a paginação ser exercitada.
        const prefixo = url.searchParams.get("prefix") || "";
        const todas = [...guardados.keys()].filter((k) => k.startsWith(prefixo)).sort();
        const de = Number(url.searchParams.get("continuation-token") || 0);
        const pagina = todas.slice(de, de + 2);
        const truncada = de + 2 < todas.length;
        const xml = `<ListBucketResult>${pagina.map((k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key><Size>${guardados.get(k)!.corpo.length}</Size></Contents>`).join("")}<IsTruncated>${truncada}</IsTruncated>${truncada ? `<NextContinuationToken>${de + 2}</NextContinuationToken>` : ""}</ListBucketResult>`;
        res.writeHead(200, { "content-type": "application/xml" }).end(xml);
      } else if (req.method === "GET" || req.method === "HEAD") {
        const o = guardados.get(chave);
        if (!o) { res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>"); return; }
        const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ""));
        if (m) {
          const ini = Number(m[1]);
          const fim = m[2] ? Math.min(Number(m[2]), o.corpo.length - 1) : o.corpo.length - 1;
          res.writeHead(206, { "content-type": o.tipo, "content-length": fim - ini + 1, "content-range": `bytes ${ini}-${fim}/${o.corpo.length}` });
          res.end(req.method === "HEAD" ? undefined : o.corpo.subarray(ini, fim + 1));
        } else {
          res.writeHead(200, { "content-type": o.tipo, "content-length": o.corpo.length });
          res.end(req.method === "HEAD" ? undefined : o.corpo);
        }
      } else {
        res.writeHead(405).end();
      }
    });
  });
  return new Promise((ok) => servidor.listen(0, "127.0.0.1", () => {
    const porta = (servidor.address() as { port: number }).port;
    ok({ endpoint: `http://127.0.0.1:${porta}`, fechar: () => servidor.close() });
  }));
}

const ligar = (endpoint: string) => {
  process.env.R2_ACCOUNT_ID = "conta-de-teste";
  process.env.R2_ACCESS_KEY_ID = "chave-de-teste";
  process.env.R2_SECRET_ACCESS_KEY = SEGREDO;
  process.env.R2_BUCKET = BUCKET;
  process.env.R2_ENDPOINT = endpoint;
};
const desligar = () => {
  for (const v of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT"]) delete process.env[v];
};

// MP4 mínimo que passa na conferência do vídeo (caixa por caixa, como em teste-video-da-capa).
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const caixa = (tipo: string, ...filhos: Buffer[]) => { const c = Buffer.concat(filhos); return Buffer.concat([u32(8 + c.length), Buffer.from(tipo, "latin1"), c]); };
const MP4 = Buffer.concat([
  caixa("ftyp", Buffer.from("isom", "latin1"), u32(0x200), Buffer.from("isom", "latin1")),
  caixa("moov", caixa("trak", caixa("mdia", caixa("hdlr", u32(0), u32(0), Buffer.from("vide", "latin1"), Buffer.alloc(13)), caixa("minf", caixa("stbl", caixa("stsd", u32(0), u32(1), caixa("avc1", Buffer.alloc(78)))))))),
  caixa("mdat", Buffer.alloc(3000, 9)),
]);

// ─── Instância A (este processo) ─────────────────────────────────────────
async function instanciaA() {
  vetoresDaAws();

  const raiz = mkdtempSync(path.join(tmpdir(), "bucket-"));
  const pastaA = path.join(raiz, "a");
  const pastaB = path.join(raiz, "b");
  mkdirSync(pastaA);
  mkdirSync(pastaB);
  process.env.UPLOADS_DIR = pastaA;
  delete process.env.FH_FISCAL_DIR;
  process.env.FISCAL_CHAVE = "chave-fiscal-de-teste-do-bucket";
  const { endpoint, fechar } = await bucketFalso();

  try {
    const storage = await import("../src/lib/storage");
    const fiscal = await import("../src/lib/nfce/armazenamento");
    const { apagarDoCofre } = await import("../src/lib/nfce/envio-do-certificado");
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c00" } }).png().toBuffer();

    // ── Sem as variáveis: exatamente o de antes, nada sai para a rede ──
    desligar();
    const semBucket = await storage.saveUploadedFile(new File([new Uint8Array(png)], "foto.png", { type: "image/png" }), "produtos");
    confere("desligado: grava no disco", existsSync(path.join(pastaA, semBucket.pathname)));
    confere("desligado: trazerDoBucket não acha", (await storage.trazerDoBucket("produtos/nao-existe.webp")) === null);
    const notaSem = await fiscal.guardarArquivoFiscal({ lojaId: "loja1", tipo: "nota", identificacao: "sem-bucket", conteudo: "<xml/>" });
    confere("desligado: cofre grava e lê", (await fiscal.lerXmlFiscal(notaSem.caminho, notaSem.sha256)) === "<xml/>");
    confere("desligado: nenhum pedido ao bucket", pedidos.length === 0, pedidos);

    // ── Ligado: grava no disco E no bucket ──
    ligar(endpoint);
    const foto = await storage.saveUploadedFile(new File([new Uint8Array(png)], "foto.png", { type: "image/png" }), "produtos");
    const noDisco = readFileSync(path.join(pastaA, foto.pathname));
    confere("ligado: foto no disco", noDisco.length === foto.size);
    confere("ligado: a mesma foto no bucket, em uploads/", guardados.get(`uploads/${foto.pathname}`)?.corpo.equals(noDisco) === true, [...guardados.keys()]);
    confere("ligado: tipo gravado junto", guardados.get(`uploads/${foto.pathname}`)?.tipo === "image/webp");

    const video = await storage.saveUploadedVideo(new File([new Uint8Array(MP4)], "capa.mp4", { type: "video/mp4" }), "lojas");
    confere("vídeo da capa no bucket", guardados.get(`uploads/${video.pathname}`)?.corpo.equals(MP4) === true);

    const nota = await fiscal.guardarArquivoFiscal({ lojaId: "loja1", tipo: "nota", identificacao: "35251000000000000000650010000000011000000019", conteudo: "<nfeProc>CPF 12345678909</nfeProc>", mes: "202610" });
    const chaveDaNota = `fiscal/${nota.caminho}`;
    const naNuvem = guardados.get(chaveDaNota);
    confere("cofre: vai para fiscal/ no bucket", !!naNuvem, [...guardados.keys()]);
    confere("cofre: vai CIFRADO (o CPF não aparece)", !!naNuvem && !naNuvem.corpo.toString("latin1").includes("12345678909"));
    confere("cofre: nunca em uploads/", ![...guardados.keys()].some((k) => k.startsWith("uploads/_fiscal")));

    const cert = await fiscal.guardarArquivoFiscal({ lojaId: "loja1", tipo: "certificado", identificacao: "a1-velho", conteudo: Buffer.from("pfx de mentira") });
    confere("certificado no bucket", guardados.has(`fiscal/${cert.caminho}`));

    // Um tutorial da versão atual no bucket, como se tivesse sido enviado à A.
    const fichas = (await import("../src/lib/tutoriais-fichas.json")).default as Record<string, { id: string; versao: string }>;
    const ficha = Object.values(fichas)[0];
    for (const a of ["video.mp4", "capa.jpg", "legendas.vtt"]) guardados.set(`uploads/tutoriais/${ficha.id}/${ficha.versao}/${a}`, { corpo: Buffer.from(`tutorial ${a}`), tipo: "x" });
    // Pegadinhas: arquivo público com nome de cofre e o cofre com extensão de imagem.
    guardados.set("uploads/_fiscal/loja1/isca.webp", { corpo: Buffer.from("RIFF0000WEBPVP8 isca"), tipo: "image/webp" });
    guardados.set("fiscal/isca.webp", { corpo: Buffer.from("RIFF0000WEBPVP8 cofre"), tipo: "image/webp" });

    // ── Instância B: outro processo, outra pasta, o mesmo bucket ──
    const resultadoB = await new Promise<{ ok: number; falhas: number }>((resolve) => {
      const filho = spawn(process.execPath, [...process.execArgv, process.argv[1], "--instancia-b"], {
        env: { ...process.env, UPLOADS_DIR: pastaB, FOTO: foto.pathname, VIDEO: video.pathname, NOTA: JSON.stringify(nota), CERT: cert.caminho, TUTORIAL: ficha.id },
        stdio: ["ignore", "pipe", "inherit"],
      });
      let saida = "";
      filho.stdout.on("data", (c) => { saida += c; });
      filho.on("close", () => {
        process.stdout.write(saida.replace(/^RESULTADO .*$/m, ""));
        const m = /^RESULTADO (\d+) (\d+)$/m.exec(saida);
        resolve(m ? { ok: Number(m[1]), falhas: Number(m[2]) } : { ok: 0, falhas: 1 });
      });
    });
    ok += resultadoB.ok;
    falhas += resultadoB.falhas;
    confere("B não pediu ao bucket nada fora de uploads/ e fiscal/<nota>", !pedidos.some((p) => p.metodo === "GET" && p.chave === "fiscal/isca.webp"));

    // ── Certificado substituído: sai do disco e do bucket ──
    confere("apagarDoCofre apaga a cópia do bucket", (await apagarDoCofre(cert.caminho)) && !guardados.has(`fiscal/${cert.caminho}`));

    // ── Bucket fora do ar: a gravação no disco vale, nada estoura ──
    foraDoAr = true;
    const avisos: unknown[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => { avisos.push(a); };
    try {
      const mesmoAssim = await storage.saveUploadedFile(new File([new Uint8Array(png)], "foto.png", { type: "image/png" }), "produtos");
      confere("fora do ar: a foto grava no disco e a URL volta", existsSync(path.join(pastaA, mesmoAssim.pathname)) && mesmoAssim.url.startsWith("/uploads/produtos/"));
      const notaFora = await fiscal.guardarArquivoFiscal({ lojaId: "loja1", tipo: "nota", identificacao: "fora-do-ar", conteudo: "<a/>" });
      confere("fora do ar: o cofre grava e lê do disco", (await fiscal.lerXmlFiscal(notaFora.caminho, notaFora.sha256)) === "<a/>");
      const { GET } = await import("../src/app/uploads/[...path]/route");
      const { NextRequest } = await import("next/server");
      const r = await GET(new NextRequest("http://localhost/uploads/produtos/sumiu.webp"), { params: Promise.resolve({ path: ["produtos", "sumiu.webp"] }) });
      confere("fora do ar: arquivo que não está no disco é 404, não 500", r.status === 404, r.status);
      confere("fora do ar: avisou no log", avisos.length > 0);
    } finally {
      console.warn = warn;
      foraDoAr = false;
    }

    // Endereço que nem responde (porta fechada): mesma coisa.
    process.env.R2_ENDPOINT = "http://127.0.0.1:9";
    console.warn = () => {};
    try {
      const semRede = await storage.saveUploadedFile(new File([new Uint8Array(png)], "foto.png", { type: "image/png" }), "produtos");
      confere("sem rede: grava no disco", existsSync(path.join(pastaA, semRede.pathname)));
    } finally {
      console.warn = warn;
      process.env.R2_ENDPOINT = endpoint;
    }

    // ── Cópia inicial: sobe o que falta, pula temporário, é idempotente ──
    const pastaC = path.join(raiz, "c");
    mkdirSync(path.join(pastaC, "lojas"), { recursive: true });
    mkdirSync(path.join(pastaC, "_fiscal", "loja9", "nota", "202610"), { recursive: true });
    writeFileSync(path.join(pastaC, "lojas", "logo.webp"), "logo");
    writeFileSync(path.join(pastaC, "lojas", "capa.mp4"), MP4);
    writeFileSync(path.join(pastaC, "lojas", "pela-metade.mp4.parcial"), "x");
    writeFileSync(path.join(pastaC, "_fiscal", "loja9", "nota", "202610", "abc.fh"), "cifrado");
    writeFileSync(path.join(pastaC, "_fiscal", "loja9", "nota", "202610", "abc.fh.1a2b.tmp"), "x");
    const rodarCopia = (...args: string[]) => new Promise<{ codigo: number; saida: string }>((resolve) => {
      const filho = spawn(process.execPath, [path.join(__dirname, "copiar-uploads-para-o-bucket.mjs"), pastaC, ...args], { env: process.env });
      let saida = "";
      filho.stdout.on("data", (c) => { saida += c; });
      filho.stderr.on("data", (c) => { saida += c; });
      filho.on("close", (codigo) => resolve({ codigo: codigo ?? 1, saida }));
    });
    const simulada = await rodarCopia("--simular");
    confere("cópia --simular não sobe nada", simulada.codigo === 0 && /faltam: 3 /.test(simulada.saida) && !guardados.has("uploads/lojas/logo.webp"), simulada.saida);
    const primeira = await rodarCopia();
    confere("cópia: sobe os 3 arquivos (assinatura do script aceita)", primeira.codigo === 0 && /subiram: 3 /.test(primeira.saida), primeira.saida);
    confere("cópia: logo e vídeo em uploads/", guardados.get("uploads/lojas/logo.webp")?.corpo.toString() === "logo" && guardados.get("uploads/lojas/capa.mp4")?.corpo.equals(MP4) === true);
    confere("cópia: _fiscal vai para fiscal/, não para uploads/", guardados.has("fiscal/loja9/nota/202610/abc.fh") && !guardados.has("uploads/_fiscal/loja9/nota/202610/abc.fh"));
    confere("cópia: temporário e .parcial ficam de fora", ![...guardados.keys()].some((k) => /\.(tmp|parcial)$/.test(k)));
    const segunda = await rodarCopia();
    confere("cópia de novo: nada falta (idempotente)", segunda.codigo === 0 && /faltam: 0 /.test(segunda.saida) && /subiram: 0 /.test(segunda.saida), segunda.saida);
    desligar();
    const semVariaveis = await rodarCopia();
    confere("cópia sem as variáveis: recusa e diz quais faltam", semVariaveis.codigo === 2 && /R2_BUCKET/.test(semVariaveis.saida));
  } finally {
    fechar();
    rmSync(raiz, { recursive: true, force: true });
  }
}

// ─── Instância B (processo filho) ────────────────────────────────────────
async function instanciaB() {
  const pastaB = process.env.UPLOADS_DIR!;
  const { GET } = await import("../src/app/uploads/[...path]/route");
  const { NextRequest } = await import("next/server");
  const fiscal = await import("../src/lib/nfce/armazenamento");
  const { lerImagemEnviada } = await import("../src/lib/imagem-enviada");
  const tutoriais = await import("../src/lib/tutoriais-no-servidor");
  const pedir = (partes: string[], range?: string) =>
    GET(new NextRequest(`http://localhost/uploads/${partes.join("/")}`, { headers: range ? { range } : {} }), { params: Promise.resolve({ path: partes }) });

  const foto = process.env.FOTO!;
  confere("B: a foto não está no disco de B", !existsSync(path.join(pastaB, foto)));
  const r = await pedir(foto.split("/"));
  const corpo = Buffer.from(await r.arrayBuffer());
  confere("B: /uploads serve a foto que A gravou (200)", r.status === 200 && corpo.length > 0, r.status);
  confere("B: com os cabeçalhos de sempre", r.headers.get("content-type") === "image/webp" && /immutable/.test(r.headers.get("cache-control") || "") && r.headers.get("x-content-type-options") === "nosniff");
  confere("B: e guardou no próprio disco (cache local)", existsSync(path.join(pastaB, foto)));

  const video = process.env.VIDEO!.split("/");
  const sonda = await pedir(video, "bytes=0-1");
  const dois = Buffer.from(await sonda.arrayBuffer());
  confere("B: vídeo de A sai em pedaços (206, bytes=0-1)", sonda.status === 206 && dois.length === 2 && sonda.headers.get("accept-ranges") === "bytes", sonda.status);
  confere("B: Content-Range do vídeo inteiro", /^bytes 0-1\/\d+$/.test(sonda.headers.get("content-range") || ""), sonda.headers.get("content-range"));
  const meio = await pedir(video, "bytes=100-199");
  confere("B: pedaço do meio", meio.status === 206 && Buffer.from(await meio.arrayBuffer()).length === 100);

  const ia = await lerImagemEnviada(`/uploads/${foto}`);
  confere("B: a leitura de nota pela IA acha a foto", ia.ok === true);

  const nota = JSON.parse(process.env.NOTA!);
  confere("B: o XML de A não está no disco de B", !existsSync(path.join(pastaB, "_fiscal", nota.caminho)));
  const xml = await fiscal.lerXmlFiscal(nota.caminho, nota.sha256).catch((e) => `erro: ${e.message}`);
  confere("B: lê e decifra o XML que A guardou", xml === "<nfeProc>CPF 12345678909</nfeProc>", xml);
  confere("B: e fica no cofre de B", existsSync(path.join(pastaB, "_fiscal", nota.caminho)));
  confere("B: certificado de A também abre", (await fiscal.lerArquivoFiscal(process.env.CERT!)).toString() === "pfx de mentira");

  // O cofre não sai por URL, nem com extensão de imagem, nem com "..".
  for (const partes of [["_fiscal", ...nota.caminho.split("/")], ["_fiscal", "loja1", "isca.webp"], ["_FISCAL", "loja1", "isca.webp"], ["..", "fiscal", "isca.webp"], ["produtos", "..", "..", "fiscal", "isca.webp"]]) {
    const resp = await pedir(partes);
    confere(`B: /uploads/${partes.join("/")} é 404`, resp.status === 404, resp.status);
  }

  // Arquivo que não existe: 404, e a segunda vez nem pergunta ao bucket.
  confere("B: inexistente é 404", (await pedir(["produtos", "nao-existe.webp"])).status === 404);
  const fetchDeVerdade = globalThis.fetch;
  let idas = 0;
  globalThis.fetch = ((...a: Parameters<typeof fetch>) => { idas++; return fetchDeVerdade(...a); }) as typeof fetch;
  const denovo = await pedir(["produtos", "nao-existe.webp"]);
  globalThis.fetch = fetchDeVerdade;
  confere("B: inexistente de novo é 404 sem ir ao bucket (30 s de memória)", denovo.status === 404 && idas === 0, idas);

  // Tutorial enviado para A: B lista o bucket, traz e o botão aparece.
  const id = process.env.TUTORIAL!;
  confere("B: tutorial ainda não está no disco", !(tutoriais.tutoriaisEnviados() || []).includes(id));
  for (let i = 0; i < 50 && !existsSync(path.join(pastaB, "tutoriais", id)); i++) await new Promise((ok) => setTimeout(ok, 50));
  await new Promise((ok) => setTimeout(ok, 200));
  tutoriais.esquecerTutoriaisEnviados();
  confere("B: depois de trazer do bucket, o tutorial aparece", (tutoriais.tutoriaisEnviados() || []).includes(id));

}

(ehB ? instanciaB() : instanciaA())
  .catch((e) => { falhas++; console.log("✖ estourou", e); })
  .finally(() => {
    // O filho devolve a contagem ao pai pela saída.
    console.log(ehB ? `RESULTADO ${ok} ${falhas}` : `${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
  });
