// "Ouve" o vídeo pronto: extrai a trilha de áudio, pede a transcrição com a hora
// de cada frase e compara com o roteiro. Quem monta o vídeo não tem ouvido —
// esta é a prova de que as falas entram na hora certa, na ordem certa e sem
// uma por cima da outra.
//
// Uso:  node tutoriais/motor/ouvir.mjs pedidos
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { semelhanca } from "./narrar.mjs";

const id = process.argv[2];
const pasta = path.join(process.cwd(), "tutoriais", "saida", id);
const g = JSON.parse(fs.readFileSync(path.join(pasta, "gravacao.json"), "utf8"));
const mp3 = path.join(pasta, "trilha.mp3");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(pasta, "video.mp4"), "-vn", "-b:a", "64k", mp3]);

function chave() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const arquivo of ["C:/Users/Micro/Documents/firehub-site/.env.local", "C:/Users/Micro/Documents/firehub-site/.env"]) {
    if (!fs.existsSync(arquivo)) continue;
    const linha = fs.readFileSync(arquivo, "utf8").split(/\r?\n/).find((l) => l.startsWith("GEMINI_API_KEY="));
    if (linha) return linha.slice("GEMINI_API_KEY=".length).replace(/^["']|["']$/g, "").trim();
  }
  throw new Error("GEMINI_API_KEY não encontrada");
}

const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${chave()}`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contents: [{ parts: [
      { text: "Transcreva este áudio em português. Devolva JSON: uma lista de objetos {\"inicio\": \"M:SS.d\" (minuto, segundos e décimo em que a frase começa, como texto; ex.: \"1:08.6\"), \"texto\": a frase exatamente como dita}. Uma entrada por frase. Se em algum trecho houver duas vozes ao mesmo tempo ou fala cortada, inclua um objeto {\"inicio\": ..., \"problema\": \"descrição\"}." },
      { inlineData: { mimeType: "audio/mp3", data: fs.readFileSync(mp3).toString("base64") } },
    ] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  }),
});
const j = await r.json();
// A hora vem como "M:SS.d" de propósito: pedindo "segundos", o modelo às vezes
// escreve 1:01.3 como 101.3 e a conferência acusava atraso que não existia.
const emSegundos = (t) => {
  const partes = String(t).split(":").map(Number);
  return partes.length === 2 ? partes[0] * 60 + partes[1] : partes[0];
};
const frases = JSON.parse((j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("") || "[]")
  .map((f) => ({ ...f, inicio: emSegundos(f.inicio) }));

let falhas = 0;
const problemas = frases.filter((f) => f.problema);
for (const p of problemas) { falhas++; console.log(`PROBLEMA em ${p.inicio}s: ${p.problema}`); }
const ditas = frases.filter((f) => f.texto);
for (const [i, c] of g.cenas.entries()) {
  if (!c.fala) continue;
  const de = c.inicio / 1000 - 1.2, ate = (c.inicio + c.ms) / 1000 + 1.2;
  const ouvido = ditas.filter((f) => f.inicio >= de && f.inicio <= ate).map((f) => f.texto).join(" ");
  const nota = semelhanca(c.fala, ouvido);
  const primeira = ditas.find((f) => f.inicio >= de);
  const atraso = primeira ? primeira.inicio - c.inicio / 1000 : NaN;
  const ok = nota >= 0.85 && Math.abs(atraso) <= 1.5;
  if (!ok) falhas++;
  console.log(`${ok ? "OK    " : "FALHOU"} cena ${String(i + 1).padStart(2)} · roteiro ${(c.inicio / 1000).toFixed(1)}s · ouvido ${primeira ? primeira.inicio.toFixed(1) : "?"}s · fiel ${(nota * 100).toFixed(0)}%${ok ? "" : ` · ouvido: "${ouvido.slice(0, 90)}"`}`);
}
// Tela parada depois da fala. Fala certa e na hora não basta: em 02/10/2026 o Início saiu com 30 s
// mudos depois da primeira fala (ambiente frio, a ação da cena esperou o tempo-limite do gravador)
// e a conferência acima aprovou. Nenhum vídeo aprovado tinha pausa de 5 s entre falas.
const PAUSA_MAXIMA = 5;
const comFala = g.cenas.filter((c) => c.fala);
for (const [i, c] of comFala.entries()) {
  const proxima = comFala[i + 1];
  if (!proxima) continue;
  const parada = (proxima.inicio - (c.inicio + c.ms)) / 1000;
  if (parada > PAUSA_MAXIMA) {
    falhas++;
    console.log(`FALHOU tela parada ${parada.toFixed(0)} s depois da fala que começa em ${(c.inicio / 1000).toFixed(1)}s: "${c.fala.slice(0, 60)}…"`);
  }
}
console.log(falhas ? `\n${falhas} problema(s) na trilha` : "\ntrilha conferida: todas as falas na hora e na ordem, sem tela parada");
process.exit(falhas ? 1 : 0);
