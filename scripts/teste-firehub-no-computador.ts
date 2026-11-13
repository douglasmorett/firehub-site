/**
 * O FireHub completo no computador (12/11/2026): as fotos do cardápio, a
 * história de 31 dias na cópia da loja e o botão do instalador.
 * (O lado do Assistente: firehub-print-assistant/scripts/teste-semente.js.)
 *
 *   npx tsx scripts/teste-firehub-no-computador.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { caminhoDaFoto, DIAS_DE_HISTORIA_NA_COPIA, FOTOS_DA_COPIA, tabelaDaCopia } from "../src/lib/contingencia/catalogo";
import { fotosQueFaltam } from "../contingencia/supervisor/fotos";
import { enderecoDoInstalador, INSTALADOR_DO_ASSISTENTE } from "../src/lib/contingencia/instalador";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

console.log("— O endereço da foto —");
confere("relativo", caminhoDaFoto("/uploads/produtos/123-abc.webp"), "produtos/123-abc.webp");
confere("absoluto da nuvem", caminhoDaFoto("https://firehubfood.com.br/uploads/lojas/logo.png"), "lojas/logo.png");
confere("com www", caminhoDaFoto("https://www.firehubfood.com.br/uploads/lojas/capa.jpg"), "lojas/capa.jpg");
confere("com ?v= no fim", caminhoDaFoto("/uploads/produtos/x.jpeg?v=2"), "produtos/x.jpeg");
confere("de outro site (CDN do iFood) não desce", caminhoDaFoto("https://static-images.ifood.com.br/image/upload/x.png"), null);
confere("domínio parecido não desce", caminhoDaFoto("https://firehubfood.com.br.golpe.com/uploads/a.png"), null);
confere("subir pasta (..) não desce", caminhoDaFoto("/uploads/../.env.png"), null);
confere("barra dupla não desce", caminhoDaFoto("/uploads//a.png"), null);
confere("%2e%2e não desce", caminhoDaFoto("/uploads/%2e%2e/a.png"), null);
confere("vídeo da capa não desce", caminhoDaFoto("/uploads/lojas/capa.mp4"), null);
confere("fora de /uploads não desce", caminhoDaFoto("/imagens/a.png"), null);
confere("vazio", caminhoDaFoto(null), null);

console.log("— O que falta baixar —");
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "firehub-fotos-"));
fs.mkdirSync(path.join(pasta, "produtos"), { recursive: true });
fs.writeFileSync(path.join(pasta, "produtos", "ja.webp"), "x");
const faltou = new Map<string, number>([["produtos/sumiu.webp", Date.now() + 60_000]]);
confere(
  "baixa só o que não está no disco, e espera a que a nuvem não tinha",
  fotosQueFaltam(["produtos/ja.webp", "produtos/nova.webp", "produtos/sumiu.webp"], pasta, faltou),
  ["produtos/nova.webp"],
);
confere(
  "passada a espera, tenta de novo",
  fotosQueFaltam(["produtos/sumiu.webp"], pasta, faltou, Date.now() + 120_000),
  ["produtos/sumiu.webp"],
);
fs.rmSync(pasta, { recursive: true, force: true });

console.log("— O catálogo —");
confere("fotos de produto, categoria, logo e capa", FOTOS_DA_COPIA.map((f) => `${f.tabela}.${f.coluna}`), [
  "MenuProduct.imageUrl", "MenuCategory.imageUrl", "User.storeLogo", "User.storeBanner",
]);
confere("31 dias de história (relatórios do mês sem internet)", DIAS_DE_HISTORIA_NA_COPIA, 31);
for (const nome of ["CustomerOrder", "CustomerOrderItem", "CashSession", "CashMovement", "CashSessionEdicao", "TableSession", "TableGuest"]) {
  confere(`${nome}: a foto usa a história de 31 dias`, (tabelaDaCopia(nome)?.foto || "").includes("interval '31 days'"), true);
}
confere("impressão continua só do último dia (não reimprime história)", (tabelaDaCopia("PrintRequest")?.foto || "").includes("interval '1 day'"), true);

console.log("— O botão de baixar —");
confere("sem o completo publicado: o Assistente de sempre", enderecoDoInstalador({}), { completo: false, url: INSTALADOR_DO_ASSISTENTE, tamanhoMb: null });
confere(
  "com o completo publicado (https): ele, com o tamanho",
  enderecoDoInstalador({ FIREHUB_INSTALADOR_COMPLETO_URL: "https://arquivos.exemplo/FireHub-Completo-Setup.exe", FIREHUB_INSTALADOR_COMPLETO_MB: "412.4" }),
  { completo: true, url: "https://arquivos.exemplo/FireHub-Completo-Setup.exe", tamanhoMb: 412 },
);
confere("endereço http (sem cadeado) não vale", enderecoDoInstalador({ FIREHUB_INSTALADOR_COMPLETO_URL: "http://x/FireHub.exe" }).completo, false);
confere("tamanho inválido: sem tamanho", enderecoDoInstalador({ FIREHUB_INSTALADOR_COMPLETO_URL: "https://x/a.exe", FIREHUB_INSTALADOR_COMPLETO_MB: "muito" }).tamanhoMb, null);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
