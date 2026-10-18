// Índice da busca da central de tutoriais: para cada vídeo publicado, cada
// capítulo com o título e TUDO o que a voz diz nele. A busca precisa do texto
// falado porque quem procura escreve do seu jeito ("aplicativo do motoboy"),
// e o título do vídeo diz outra coisa ("app do entregador").
//
//   node tutoriais/indexar-busca.mjs [pasta-das-gravacoes]
//
// Lê tutoriais/saida/<id>/gravacao.json (as falas) e as fichas publicadas (o
// segundo de cada capítulo no vídeo pronto) e grava src/lib/tutoriais-busca.json.
// publicar.mjs chama isto sozinho.
import fs from "node:fs";
import path from "node:path";

export function indexar(saida = path.join(process.cwd(), "tutoriais", "saida")) {
  const fichas = JSON.parse(fs.readFileSync(path.join("src", "lib", "tutoriais-fichas.json"), "utf8"));
  // O índice que já está publicado: vídeo sem a gravação nesta máquina mantém o texto de lá.
  // (18/10/2026: a pasta com as gravações dos 34 primeiros vídeos foi apagada; os vídeos e o
  // índice continuam no ar, só a fonte das falas sumiu.)
  const arquivoDoIndice = path.join("src", "lib", "tutoriais-busca.json");
  const publicado = fs.existsSync(arquivoDoIndice) ? JSON.parse(fs.readFileSync(arquivoDoIndice, "utf8")) : {};
  const indice = {};
  for (const ficha of Object.values(fichas)) {
    const arquivo = path.join(saida, ficha.id, "gravacao.json");
    if (!fs.existsSync(arquivo)) {
      const anterior = publicado[ficha.id];
      if (anterior && anterior.length === ficha.capitulos.length) { indice[ficha.id] = anterior; continue; }
      throw new Error(`Falta ${arquivo}: sem as falas, ${ficha.id} não entra na busca.`);
    }
    const { cenas } = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    // A cena que abre capítulo traz `capitulo`; as seguintes, até o próximo, são dele.
    const falas = [];
    for (const c of cenas) {
      if (c.capitulo || !falas.length) falas.push([]);
      if (c.fala) falas[falas.length - 1].push(c.fala);
    }
    if (falas.length !== ficha.capitulos.length) {
      throw new Error(`${ficha.id}: ${falas.length} capítulos na gravação e ${ficha.capitulos.length} na ficha — a gravação não é a publicada.`);
    }
    indice[ficha.id] = ficha.capitulos.map((cap, i) => ({ em: cap.em, texto: falas[i].join(" ") }));
  }
  fs.writeFileSync(path.join("src", "lib", "tutoriais-busca.json"), JSON.stringify(indice) + "\n", "utf8");
  return Object.keys(indice).length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  console.log(`índice da busca: ${indexar(process.argv[2])} vídeos`);
}
