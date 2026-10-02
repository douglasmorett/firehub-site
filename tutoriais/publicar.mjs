// Leva um tutorial pronto para o painel: grava a ficha (título, duração,
// capítulos, versão) em src/lib/tutoriais-fichas.json e copia vídeo, capa e
// legenda para public/tutoriais/<id>/<versao>/ — a pasta que a gravação local
// serve, e de onde os arquivos seguem para o servidor (/api/admin/tutoriais).
//
//   node tutoriais/publicar.mjs pedidos
//
// Só roda depois do vídeo APROVADO. A ficha vai para o repositório; os arquivos
// de vídeo não (moram no volume de uploads do servidor, ver tutoriais/README.md).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { indexar } from "./indexar-busca.mjs";

const id = process.argv[2];
if (!id) {
  console.error("Uso: node tutoriais/publicar.mjs <roteiro>");
  process.exit(2);
}
const origem = path.join(process.cwd(), "tutoriais", "saida", id);
const ficha = JSON.parse(fs.readFileSync(path.join(origem, "tutorial.json"), "utf8"));
const versao = crypto.createHash("sha1").update(fs.readFileSync(path.join(origem, "video.mp4"))).digest("hex").slice(0, 8);

// Uma pasta por versão: a gravação nova tem endereço novo, e o cache eterno nunca mostra a velha.
const pastaDoTutorial = path.join(process.cwd(), "public", "tutoriais", id);
fs.rmSync(pastaDoTutorial, { recursive: true, force: true });
const destino = path.join(pastaDoTutorial, versao);
fs.mkdirSync(destino, { recursive: true });
for (const arquivo of ["video.mp4", "capa.jpg", "legendas.vtt"]) fs.copyFileSync(path.join(origem, arquivo), path.join(destino, arquivo));

const arquivoDasFichas = path.join(process.cwd(), "src", "lib", "tutoriais-fichas.json");
const fichas = JSON.parse(fs.readFileSync(arquivoDasFichas, "utf8"));
fichas[id] = { id, titulo: ficha.titulo, duracao: ficha.duracao, capitulos: ficha.capitulos, versao, ...(ficha.emPe ? { emPe: true } : {}) };
fs.writeFileSync(arquivoDasFichas, JSON.stringify(fichas, null, 2) + "\n", "utf8");

// A busca da central procura no que a voz diz: o índice acompanha a ficha.
indexar();
console.log(`publicado: ${destino}`);
