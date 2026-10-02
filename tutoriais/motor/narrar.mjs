// A voz do tutorial: cada fala do roteiro vira um arquivo de áudio.
//
// ── Guardado por conteúdo ───────────────────────────────────────────────────
// O nome do arquivo é o resumo (hash) de voz + estilo + texto. Regravar um
// vídeo porque a TELA mudou não gasta voz nenhuma; mudar uma frase regrava só
// aquela frase.
//
// ── Conferida antes de usar ─────────────────────────────────────────────────
// Voz sintética às vezes engole palavra ou escorrega para sotaque de Portugal,
// e quem monta o vídeo não ouve cada fala. Então cada áudio novo é transcrito
// de volta e comparado com o texto; fala que não bate é refeita.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const VOZ = {
  modelo: process.env.TUTORIAL_VOZ_MODELO || "gemini-2.5-flash-preview-tts",
  nome: process.env.TUTORIAL_VOZ || "Sulafat",
  estilo:
    "Leia em português do Brasil, com sotaque brasileiro neutro. Voz simpática e clara, de quem mostra a um colega como usar um sistema. Ritmo natural de conversa, sem pressa e sem arrastar. Leia exatamente o texto:",
};

/**
 * Pronúncia que vale para TODOS os roteiros. "FireHub" junto a voz lia
 * "fíre-rúbi"; o Douglas ouviu as opções em 02/10/2026 e escolheu "Fire Hub"
 * separado. Só a voz muda: a legenda continua "FireHub".
 */
export const PRONUNCIA_FIXA = { FireHub: "Fire Hub" };

const PASTA = path.join(process.cwd(), "tutoriais", "saida", "_vozes");
const API = "https://generativelanguage.googleapis.com/v1beta/models";

function chave() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // A chave mora no .env do checkout principal; a pasta de gravação não tem .env de produção.
  for (const arquivo of [process.env.TUTORIAL_ENV, "C:/Users/Micro/Documents/firehub-site/.env.local", "C:/Users/Micro/Documents/firehub-site/.env"]) {
    if (!arquivo || !fs.existsSync(arquivo)) continue;
    const linha = fs.readFileSync(arquivo, "utf8").split(/\r?\n/).find((l) => l.startsWith("GEMINI_API_KEY="));
    if (linha) return linha.slice("GEMINI_API_KEY=".length).replace(/^["']|["']$/g, "").trim();
  }
  throw new Error("GEMINI_API_KEY não encontrada (defina a variável ou TUTORIAL_ENV com o caminho do .env).");
}

const soLetras = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/** Quanto das palavras do texto aparece, em ordem, na transcrição (0 a 1). */
export function semelhanca(texto, transcricao) {
  const a = soLetras(texto), b = soLetras(transcricao);
  if (!a.length) return 1;
  const linha = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const guardado = linha[j];
      linha[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(linha[j], linha[j - 1]);
      diagonal = guardado;
    }
  }
  return linha[b.length] / a.length;
}

async function gemini(modelo, corpo) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(`${API}/${modelo}:generateContent?key=${chave()}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
    if (r.ok) return r.json();
    const erro = (await r.text()).slice(0, 300);
    // Várias gravações em paralelo dividem o mesmo limite por minuto: insistir com calma.
    if (tentativa >= 10 || ![429, 500, 502, 503].includes(r.status)) throw new Error(`Gemini ${modelo} ${r.status}: ${erro}`);
    await new Promise((ok) => setTimeout(ok, Math.min(60_000, 6000 * tentativa)));
  }
}

async function sintetizar(texto, destinoWav) {
  const j = await gemini(VOZ.modelo, {
    contents: [{ parts: [{ text: `${VOZ.estilo}\n\n${texto}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ.nome } } } },
  });
  const parte = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!parte) throw new Error(`Sem áudio na resposta: ${JSON.stringify(j).slice(0, 300)}`);
  const cru = Buffer.from(parte.inlineData.data, "base64");
  const bruto = `${destinoWav}.bruto`;
  fs.writeFileSync(bruto, cru);
  // Alguns modelos devolvem PCM puro (24 kHz, 16 bits, mono), outros já devolvem WAV.
  const entrada = /wav/i.test(parte.inlineData.mimeType || "") ? ["-i", bruto] : ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", bruto];
  // Tira o silêncio das pontas e nivela o volume: cada fala é gerada à parte e
  // sem isto uma sai mais alta que a outra.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...entrada, "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,loudnorm=I=-17:TP=-1.5:LRA=11",
    "-ar", "48000", "-ac", "1", destinoWav]);
  fs.rmSync(bruto, { force: true });
}

async function transcrever(wav) {
  const j = await gemini("gemini-2.5-flash", {
    contents: [{ parts: [
      { text: "Transcreva exatamente o que é dito neste áudio, em uma linha, sem comentar. Na linha seguinte escreva só SOTAQUE=BRASIL ou SOTAQUE=PORTUGAL." },
      { inlineData: { mimeType: "audio/wav", data: fs.readFileSync(wav).toString("base64") } },
    ] }],
    generationConfig: { temperature: 0 },
  });
  return (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

export function duracaoDoAudio(arquivo) {
  const s = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", arquivo]).toString().trim();
  return Math.round(parseFloat(s) * 1000);
}

/**
 * Devolve { arquivo, ms } da fala. `pronuncia` troca termos só para a VOZ
 * (ex.: "KDS" → "cá dê esse"); a legenda continua com o texto original.
 */
export async function narrar(texto, { pronuncia = {} } = {}) {
  fs.mkdirSync(PASTA, { recursive: true });
  let falado = texto;
  for (const [de, para] of Object.entries({ ...PRONUNCIA_FIXA, ...pronuncia })) falado = falado.split(de).join(para);
  const resumo = crypto.createHash("sha1").update(`${VOZ.modelo}|${VOZ.nome}|${VOZ.estilo}|${falado}`).digest("hex").slice(0, 16);
  const arquivo = path.join(PASTA, `${resumo}.wav`);
  if (fs.existsSync(arquivo)) return { arquivo, ms: duracaoDoAudio(arquivo), novo: false };

  const palavras = soLetras(falado).length;
  let ultimo = "";
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    await sintetizar(falado, arquivo);
    const ms = duracaoDoAudio(arquivo);
    const ritmo = palavras / (ms / 1000); // palavras por segundo
    const ouvido = await transcrever(arquivo);
    // Com `pronuncia`, a voz diz "cá dê esse" e a transcrição devolve "KDS": vale a melhor
    // nota entre o texto falado e o texto original, senão fala curta com sigla nunca passava.
    const dito = ouvido.split("\n")[0] || "";
    const nota = Math.max(semelhanca(falado, dito), semelhanca(texto, dito));
    const portugal = /SOTAQUE\s*=\s*PORTUGAL/i.test(ouvido);
    ultimo = `fiel ${(nota * 100).toFixed(0)}% · ${ritmo.toFixed(1)} palavras/s${portugal ? " · sotaque de Portugal" : ""}`;
    // Fala curta tem ritmo irregular por natureza; a régua de ritmo vale a partir de 8 palavras.
    const ritmoBom = palavras < 8 || (ritmo >= 1.9 && ritmo <= 3.4);
    // Em fala curta, uma palavra transcrita diferente já derruba abaixo de 90%: tolera-se UMA.
    const minimo = Math.min(0.9, 1 - 1.01 / Math.max(2, palavras));
    if (nota >= minimo && !portugal && ritmoBom) return { arquivo, ms, novo: true, conferencia: ultimo };
    console.log(`   refazendo a fala (tentativa ${tentativa}: ${ultimo})`);
  }
  fs.rmSync(arquivo, { force: true });
  throw new Error(`A voz não passou na conferência depois de 4 tentativas (${ultimo}): "${texto.slice(0, 80)}…"`);
}
