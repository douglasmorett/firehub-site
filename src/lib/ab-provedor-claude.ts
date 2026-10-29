/**
 * SÓ PARA O LABORATÓRIO DE A/B (scripts/ab-do-robo.ts): responde no lugar do
 * Gemini usando o Claude Code em modo `-p` (a assinatura do Douglas), para
 * comparar a QUALIDADE do Claude Haiku 5.5 com a do Gemini no robô de verdade.
 *
 * NÃO vai para produção: só é chamado quando FIREHUB_AB_PROVEDOR=claude-cli e o
 * modelo começa com "claude-". Produção usaria a API da Anthropic com chave
 * própria. Os números de custo daqui NÃO valem (o Claude Code acrescenta o
 * prompt dele); só o texto da resposta e o tempo servem.
 *
 * O Claude Code recebe uma fala só: o histórico vai achatado como transcrição.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { REGRAS_DO_CLAUDE } from "./regras-do-claude";

type Parte = { text?: string };
type Conteudo = { role: string; parts?: Parte[] };

const textoDe = (c: Conteudo) => (c.parts || []).map((p) => p.text || "").join("\n").trim();

export async function abClaudeCli(params: { model: string; contents: Conteudo[]; config?: any }) {
  // As regras do Claude (lib/regras-do-claude.ts) vão sempre no fim, como iriam em produção; FIREHUB_AB_SEM_REGRAS_DO_CLAUDE=1
  // mede sem elas. FIREHUB_AB_INSTRUCAO_EXTRA: uma linha a mais, para medir outro ajuste de prompt só no Claude.
  const sistema =
    String(params.config?.systemInstruction || "") +
    (process.env.FIREHUB_AB_SEM_REGRAS_DO_CLAUDE === "1" ? "" : `\n\n${REGRAS_DO_CLAUDE}`) +
    (process.env.FIREHUB_AB_INSTRUCAO_EXTRA ? `\n\n${process.env.FIREHUB_AB_INSTRUCAO_EXTRA}` : "");
  const dir = path.join(os.tmpdir(), "ab-claude");
  fs.mkdirSync(dir, { recursive: true });
  const arq = path.join(dir, `${crypto.createHash("sha1").update(sistema).digest("hex")}.txt`);
  if (!fs.existsSync(arq)) fs.writeFileSync(arq, sistema);

  // O contexto da conversa (primeira mensagem de "user") e o histórico viram uma transcrição; a última fala do cliente fecha.
  const turnos = params.contents.filter((c) => textoDe(c));
  const ultimo = turnos[turnos.length - 1];
  const antes = turnos.slice(0, -1).filter((c) => textoDe(c) !== "Entendido.");
  const transcricao = antes
    .map((c, i) => (i === 0 && c.role === "user" && /CONTEXTO DESTA CONVERSA/.test(textoDe(c)) ? textoDe(c) : `${c.role === "user" ? "CLIENTE" : "VOCÊ (atendente)"}: ${textoDe(c)}`))
    .join("\n\n");
  const entrada = `${transcricao}\n\nCLIENTE: ${textoDe(ultimo)}\n\nResponda agora como o atendente, só com a mensagem que o cliente vai ler (e as marcas [[...]] se as regras mandarem).`;

  // Foto do cliente nesta fala: vai como bloco de imagem (entrada em stream-json), como iria pela API.
  const imagens = (ultimo?.parts || []).filter((p: any) => p.inlineData?.mimeType?.startsWith("image/")) as any[];
  const comFoto = imagens.length > 0;
  const base = ["-p", "--model", params.model, "--system-prompt-file", arq, "--tools", "", "--disable-slash-commands"];
  const r = spawnSync(
    process.platform === "win32" ? "claude.exe" : "claude",
    comFoto ? [...base, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"] : [...base, "--output-format", "json"],
    {
      input: comFoto
        ? JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                ...imagens.map((p) => ({ type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } })),
                { type: "text", text: entrada },
              ],
            },
          }) + "\n"
        : entrada,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    },
  );
  if (r.error || !r.stdout) throw new Error(`claude-cli falhou: ${r.error?.message || r.stderr?.slice(0, 200)}`);
  const j = comFoto
    ? r.stdout.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l)).reverse().find((o) => o.type === "result") || {}
    : JSON.parse(r.stdout);
  if (j.is_error) throw new Error(`claude-cli erro: ${String(j.result || "").slice(0, 200)}`);
  const u = j.usage || {};
  const modelo = Object.values<any>(j.modelUsage || {})[0] || {};
  return {
    text: String(j.result || ""),
    usageMetadata: {
      promptTokenCount: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      candidatesTokenCount: u.output_tokens || 0,
      thoughtsTokenCount: modelo.thinkingTokens || u.output_tokens_details?.thinking_tokens || 0,
      cachedContentTokenCount: u.cache_read_input_tokens || 0,
    },
  };
}
