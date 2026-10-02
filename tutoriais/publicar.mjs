// Leva um tutorial pronto para o painel: copia vídeo, capa e legenda para
// public/tutoriais/<id>/ e grava a ficha (título, duração, capítulos, versão)
// em src/lib/tutoriais-fichas.json — é ela que faz o botão aparecer na tela.
//
//   node tutoriais/publicar.mjs pedidos
//
// Só roda depois do vídeo APROVADO. A ficha vai para o repositório; os arquivos
// de vídeo vão para onde a hospedagem escolhida mandar (ver tutoriais/README.md).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const id = process.argv[2];
if (!id) {
  console.error("Uso: node tutoriais/publicar.mjs <roteiro>");
  process.exit(2);
}
const origem = path.join(process.cwd(), "tutoriais", "saida", id);
const destino = path.join(process.cwd(), "public", "tutoriais", id);
const ficha = JSON.parse(fs.readFileSync(path.join(origem, "tutorial.json"), "utf8"));

fs.mkdirSync(destino, { recursive: true });
for (const arquivo of ["video.mp4", "capa.jpg", "legendas.vtt"]) fs.copyFileSync(path.join(origem, arquivo), path.join(destino, arquivo));

const versao = crypto.createHash("sha1").update(fs.readFileSync(path.join(origem, "video.mp4"))).digest("hex").slice(0, 8);
const arquivoDasFichas = path.join(process.cwd(), "src", "lib", "tutoriais-fichas.json");
const fichas = JSON.parse(fs.readFileSync(arquivoDasFichas, "utf8"));
fichas[id] = { id, titulo: ficha.titulo, duracao: ficha.duracao, capitulos: ficha.capitulos, versao };
fs.writeFileSync(arquivoDasFichas, JSON.stringify(fichas, null, 2) + "\n", "utf8");

console.log(`publicado: ${destino} (versão ${versao})`);
