// Folha de contato: tira fotos do vídeo pronto em pontos de cada cena e junta
// de quatro em quatro. É como se revisa enquadramento, destaque e câmera sem
// assistir ao vídeo inteiro a cada ajuste.
//
// Uso:  node tutoriais/motor/revisar.mjs pedidos [fracoes]      (padrão: 0.5,0.95)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const id = process.argv[2];
const fracoes = (process.argv[3] || "0.5,0.95").split(",").map(Number);
const pasta = path.join(process.cwd(), "tutoriais", "saida", id);
const g = JSON.parse(fs.readFileSync(path.join(pasta, "gravacao.json"), "utf8"));
const destino = path.join(pasta, "revisao");
fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });

const pontos = [];
for (const [i, c] of g.cenas.entries()) for (const f of fracoes) pontos.push({ cena: i + 1, t: (c.inicio + (c.fim - c.inicio) * f) / 1000 });
for (const [i, p] of pontos.entries()) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", p.t.toFixed(2), "-i", path.join(pasta, "video.mp4"), "-frames:v", "1",
    "-vf", `scale=960:-2,drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='cena ${p.cena} · ${p.t.toFixed(1)}s':x=10:y=10:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=6`,
    path.join(destino, `p${String(i).padStart(3, "0")}.jpg`)]);
}
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "1", "-i", path.join(destino, "p%03d.jpg"),
  "-vf", "tile=2x2:padding=6:color=white", "-q:v", "4", path.join(destino, "folha-%02d.jpg")]);
console.log(fs.readdirSync(destino).filter((f) => f.startsWith("folha")).map((f) => path.join(destino, f)).join("\n"));
