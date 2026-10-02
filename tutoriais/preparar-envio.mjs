// Junta numa pasta só os arquivos da versão atual de cada tutorial, com nome
// único (<id>__<versao>__<arquivo>), para serem escolhidos de uma vez no
// campo de arquivo do navegador e enviados por tutoriais/enviar-no-navegador.js.
//
//   node tutoriais/preparar-envio.mjs            → tutoriais/saida/_envio/
import fs from "node:fs";
import path from "node:path";

const fichas = JSON.parse(fs.readFileSync(path.join("src", "lib", "tutoriais-fichas.json"), "utf8"));
const destino = path.join("tutoriais", "saida", "_envio");
fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });
let total = 0;
for (const { id, versao } of Object.values(fichas)) {
  for (const arquivo of ["video.mp4", "capa.jpg", "legendas.vtt"]) {
    const origem = path.join("public", "tutoriais", id, versao, arquivo);
    if (!fs.existsSync(origem)) throw new Error(`Falta ${origem}: rode publicar.mjs ${id}.`);
    fs.copyFileSync(origem, path.join(destino, `${id}__${versao}__${arquivo}`));
    total += fs.statSync(origem).size;
  }
}
console.log(`${fs.readdirSync(destino).length} arquivos, ${(total / 1048576).toFixed(0)} MB em ${path.resolve(destino)}`);
