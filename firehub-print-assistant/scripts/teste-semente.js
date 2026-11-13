/**
 * scripts/teste-semente.js — o instalador completo (semente + janela + ícone),
 * sem Electron e sem nuvem, num APPDATA de mentira na pasta temporária:
 *   • daSemente: arquivo que confere entra (sem rede), adulterado ou sem hash não;
 *   • adotarSementeDoInstalador: a semente sai da pasta da instalação para o
 *     %APPDATA% e fica a marca de instalação completa;
 *   • montar-semente.js: cada arquivo da lista vira objetos/<sha256>, e lista
 *     que não bate com o disco é recusada;
 *   • montar-instalador-completo.js: mesmo appId/nome do Assistente (atualiza,
 *     não duplica) e a semente em resources/semente;
 *   • janela-do-firehub.js: para onde vai quando a nuvem não abre, o que abre
 *     dentro da janela e o ícone da área de trabalho.
 *
 *   node scripts/teste-semente.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), "firehub-semente-teste-"));
process.env.APPDATA = path.join(RAIZ, "appdata");
const c = require("../contingencia");
const { semearArquivos } = require("./montar-semente");
const { configuracaoCompleta } = require("./montar-instalador-completo");
const j = require("../janela-do-firehub");

let falhas = 0;
function confere(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` → ${JSON.stringify(obtido)} (esperado ${JSON.stringify(esperado)})`}`);
}
const sha256 = (d) => crypto.createHash("sha256").update(d).digest("hex");

(async () => {
  console.log("— daSemente —");
  const semente = path.join(RAIZ, "instalacao", "resources", "semente");
  fs.mkdirSync(path.join(semente, "objetos"), { recursive: true });
  const bom = Buffer.from("conteúdo do server.js");
  const hBom = sha256(bom);
  fs.writeFileSync(path.join(semente, "objetos", hBom), bom);
  const hFalso = sha256(Buffer.from("outra coisa"));
  fs.writeFileSync(path.join(semente, "objetos", hFalso), Buffer.from("adulterado"));
  fs.writeFileSync(path.join(semente, "semente.json"), JSON.stringify({ versao: "v-teste" }));

  const destino = path.join(RAIZ, "objetos", hBom);
  confere("arquivo que confere entra", await c.daSemente(`objetos/${hBom}`, destino, { sha256: hBom }, [semente]), true);
  confere("…e está no destino, com o conteúdo certo", fs.existsSync(destino) && sha256(fs.readFileSync(destino)) === hBom, true);
  confere("adulterado (hash não bate) não entra", await c.daSemente(`objetos/${hFalso}`, path.join(RAIZ, "objetos", hFalso), { sha256: hFalso }, [semente]), false);
  confere("…e não chega ao destino", fs.existsSync(path.join(RAIZ, "objetos", hFalso)), false);
  confere("sem hash para conferir, nada entra", await c.daSemente(`objetos/${hFalso}`, path.join(RAIZ, "x"), {}, [semente]), false);
  confere("arquivo que não está na semente: baixa como sempre", await c.daSemente("runtime/node.zip", path.join(RAIZ, "node.zip"), { sha256: c.NODE.sha256 }, [semente]), false);
  const pg = Buffer.from("postgres de mentira");
  fs.mkdirSync(path.join(semente, "runtime"), { recursive: true });
  fs.writeFileSync(path.join(semente, "runtime", "postgres.tgz"), pg);
  const pg512 = crypto.createHash("sha512").update(pg).digest("base64");
  confere("runtime confere pelo sha512 (o do Postgres)", await c.daSemente("runtime/postgres.tgz", path.join(RAIZ, "pg.tgz"), { sha512b64: pg512 }, [semente]), true);

  console.log("— adotarSementeDoInstalador —");
  confere("antes: não é instalação completa", c.instalacaoCompleta(), false);
  confere("adota a semente do instalador", await c.adotarSementeDoInstalador(semente), true);
  confere("a semente foi para o %APPDATA%", fs.existsSync(path.join(c.PASTA_DA_SEMENTE, "semente.json")), true);
  confere("…e saiu da pasta da instalação", fs.existsSync(semente), false);
  confere("marca de instalação completa", c.instalacaoCompleta(), true);
  confere("versão da semente anotada", JSON.parse(fs.readFileSync(c.ARQUIVO_DA_INSTALACAO_COMPLETA, "utf8")).versaoDaSemente, "v-teste");
  confere("sem semente no instalador: nada a adotar", await c.adotarSementeDoInstalador(path.join(RAIZ, "nao-existe")), false);
  confere("estado público avisa a tela", c.estadoPublico().instalacaoCompleta, true);

  console.log("— montar-semente —");
  const app = path.join(RAIZ, "app");
  fs.mkdirSync(path.join(app, "contingencia"), { recursive: true });
  fs.mkdirSync(path.join(app, ".next"), { recursive: true });
  const a1 = Buffer.from("server"), a2 = Buffer.from("pagina");
  fs.writeFileSync(path.join(app, "server.js"), a1);
  fs.writeFileSync(path.join(app, ".next", "a.js"), a2);
  fs.writeFileSync(path.join(app, ".next", "b.js"), a2); // mesmo conteúdo em dois caminhos
  const lista = {
    versao: "v1",
    arquivos: [
      { caminho: "server.js", hash: sha256(a1), tamanho: a1.length },
      { caminho: ".next/a.js", hash: sha256(a2), tamanho: a2.length },
      { caminho: ".next/b.js", hash: sha256(a2), tamanho: a2.length },
    ],
  };
  fs.writeFileSync(path.join(app, "contingencia", "pacote.json"), JSON.stringify(lista));
  const saida = path.join(RAIZ, "semente-montada");
  const r = semearArquivos(app, saida);
  confere("um objeto por hash (repetido entra uma vez)", [r.versao, r.arquivos, fs.readdirSync(path.join(saida, "objetos")).sort()], ["v1", 2, [sha256(a1), sha256(a2)].sort()]);
  fs.writeFileSync(path.join(app, "server.js"), "mudou depois da lista");
  fs.rmSync(path.join(saida, "objetos", sha256(a1)));
  let recusou = false;
  try { semearArquivos(app, saida); } catch { recusou = true; }
  confere("lista que não bate com o disco é recusada", recusou, true);

  console.log("— montar-instalador-completo —");
  const pkg = require("../package.json");
  const cfg = configuracaoCompleta(pkg.build, "C:/semente", "C:/saida");
  confere("mesmo appId e nome do Assistente (atualiza, não duplica)", [cfg.appId, cfg.productName], [pkg.build.appId, pkg.build.productName]);
  confere("a semente vai em resources/semente", cfg.extraResources.find((e) => e.to === "semente")?.from, "C:/semente");
  confere("nome do arquivo", cfg.nsis.artifactName, "FireHub-Completo-Setup.exe");
  confere("o package.json não mudou", pkg.build.nsis.artifactName, "FireHub-Assistente-Impressao-Setup.exe");
  confere("a janela entra no Assistente", pkg.build.files.includes("janela-do-firehub.js"), true);

  console.log("— janela-do-firehub —");
  confere("nuvem sem internet → porta da loja", j.seguirDepoisDaFalha("https://firehubfood.com.br/store", -106), "http://127.0.0.1:7890/");
  confere("nuvem com DNS falhando → porta da loja", j.seguirDepoisDaFalha("https://firehubfood.com.br/store", -105), "http://127.0.0.1:7890/");
  confere("porta da loja fechada → aviso", j.seguirDepoisDaFalha("http://127.0.0.1:7890/", -102), "aviso");
  confere("navegação abortada pela página → fica", j.seguirDepoisDaFalha("https://firehubfood.com.br/store", -3), null);
  confere("erro de certificado não é queda → fica", j.seguirDepoisDaFalha("https://firehubfood.com.br/store", -202), null);
  confere("abre na janela: nuvem", j.abreNaJanela("https://firehubfood.com.br/store/pedidos"), true);
  confere("abre na janela: www", j.abreNaJanela("https://www.firehubfood.com.br/store"), true);
  confere("abre na janela: este computador", j.abreNaJanela("http://127.0.0.1:7890/store"), true);
  confere("fora da janela: site de outro", j.abreNaJanela("https://wa.me/5522"), false);
  confere("fora da janela: domínio parecido", j.abreNaJanela("https://firehubfood.com.br.golpe.com/"), false);

  // O ícone, com um shell de mentira que grava o atalho como JSON.
  const mesa = path.join(RAIZ, "Desktop");
  fs.mkdirSync(mesa, { recursive: true });
  const shell = {
    writeShortcutLink: (arq, _modo, o) => { fs.writeFileSync(arq, JSON.stringify(o)); return true; },
    readShortcutLink: (arq) => JSON.parse(fs.readFileSync(arq, "utf8")),
  };
  const amb = { shell, fs, path, areaDeTrabalho: mesa, executavel: "C:/FireHub/Assistente.exe", log: () => {} };
  fs.writeFileSync(path.join(mesa, "FireHub.url"), "[InternetShortcut]\r\nURL=https://firehubfood.com.br/store\r\n[FireHub]\r\nCriadoPor=Modo Contingencia\r\n");
  confere("cria o ícone e tira o .url do supervisor", [j.garantirAtalhoDaJanela(amb), fs.existsSync(path.join(mesa, "FireHub.url"))], ["criado", false]);
  confere("o ícone abre a janela", JSON.parse(fs.readFileSync(path.join(mesa, "FireHub.lnk"), "utf8")).args, "--abrir-firehub");
  confere("na próxima abertura: já tinha", j.garantirAtalhoDaJanela(amb), "ja-tinha");
  confere("Assistente em outra pasta: atualiza o ícone", j.garantirAtalhoDaJanela({ ...amb, executavel: "D:/Novo/Assistente.exe" }), "atualizado");
  fs.writeFileSync(path.join(mesa, "FireHub.lnk"), JSON.stringify({ target: "C:/Chrome/chrome.exe", args: "--app=https://firehubfood.com.br" }));
  confere("atalho FireHub feito pela loja: fica o dela", j.garantirAtalhoDaJanela(amb), "da-loja");
  fs.rmSync(path.join(mesa, "FireHub.lnk"));
  fs.writeFileSync(path.join(mesa, "FireHub.url"), "[InternetShortcut]\r\nURL=https://outro.com\r\n");
  confere(".url da própria loja: fica o dela", [j.garantirAtalhoDaJanela(amb), fs.existsSync(path.join(mesa, "FireHub.url"))], ["da-loja", true]);

  fs.rmSync(RAIZ, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} FALHA(S).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
