/**
 * O BILL, SEU ASSESSOR no Claude Haiku 5.5: o mesmo prompt (montarSistema em
 * assessor.ts), as mesmas ferramentas (ferramentas.ts) e o mesmo caminho de
 * gravação, pela API da Anthropic. Liga junto com o robô da loja
 * (`chatbotConfig.modeloDoRobo`, lib/robo-no-claude.ts); falhou sem ter
 * gravado nada, o Gemini responde a mesma fala (assessor.ts).
 *
 * O que muda em relação ao Gemini:
 * - áudio: o Claude não ouve; o Gemini 3.6 transcreve e a transcrição vira o
 *   [[OUVI]] e o texto da fala;
 * - as declarações das ferramentas estão no formato do Gemini (Type.OBJECT…):
 *   aqui viram JSON Schema, com os tipos em minúsculas;
 * - prompt e ferramentas vão com cache da Anthropic (5 min).
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODELO_CLAUDE, transcrever } from "@/lib/robo-no-claude";
import { DECLARACOES_DO_ASSESSOR, executarFerramentaDoAssessor, type ContextoDoAssessor } from "./ferramentas";

type Acao = { nome: string; resultado: Record<string, unknown> };
type Uso = { entrada: number; saida: number; pensamento: number; cache: number };

/** O esquema do Gemini em JSON Schema: só o `type` muda ("OBJECT" → "object"). */
function paraJsonSchema(s: any): any {
  if (Array.isArray(s)) return s.map(paraJsonSchema);
  if (!s || typeof s !== "object") return s;
  const saida: any = {};
  for (const [k, v] of Object.entries(s)) saida[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : paraJsonSchema(v);
  return saida;
}

const FERRAMENTAS: Anthropic.Tool[] = (DECLARACOES_DO_ASSESSOR as any[]).map((d) => ({
  name: d.name,
  description: d.description,
  input_schema: paraJsonSchema(d.parameters || { type: "OBJECT", properties: {} }),
}));

let cliente: { chave: string; sdk: Anthropic } | null = null;
const claude = (chave: string) => {
  if (cliente?.chave !== chave) cliente = { chave, sdk: new Anthropic({ apiKey: chave, maxRetries: 0 }) };
  return cliente.sdk;
};

export async function rodarAssessorNoClaude(p: {
  chave: string;
  geminiApiKey: string;
  sistema: string;
  anteriores: { role: "user" | "model"; texto: string }[];
  /** A fala de agora: `rotulo` é o "[WhatsApp]"/"[painel, Nome]" que abre o texto. */
  entrada: { rotulo: string; texto: string; audio?: { base64: string; mimeType: string } | null; imagem?: { base64: string; mimeType: string } | null };
  ctx: ContextoDoAssessor;
  acoes: Acao[];
  uso: Uso;
  /** A resposta tem cara de ação feita? (assessor.ts) — sem ferramenta, o modelo ganha mais uma chance. */
  afirmaAcao: (texto: string) => boolean;
}): Promise<{ resposta: string; ouvi: string | null }> {
  const mensagens: Anthropic.MessageParam[] = [];
  const somar = (role: "user" | "assistant", blocos: Anthropic.ContentBlockParam[]) => {
    const anterior = mensagens[mensagens.length - 1];
    if (anterior?.role === role) (anterior.content as Anthropic.ContentBlockParam[]).push(...blocos);
    else mensagens.push({ role, content: blocos });
  };
  for (const f of p.anteriores) if (f.texto.trim()) somar(f.role === "model" ? "assistant" : "user", [{ type: "text", text: f.texto }]);
  if (mensagens[0]?.role === "assistant") mensagens.shift();

  let ouvi: string | null = null;
  const sinalDaTranscricao = AbortSignal.timeout(30_000);
  if (p.entrada.audio?.base64) {
    const t = await transcrever({ data: p.entrada.audio.base64, mimeType: (p.entrada.audio.mimeType || "audio/ogg").split(";")[0] }, p.geminiApiKey, sinalDaTranscricao);
    ouvi = t.texto;
  }
  const agora: Anthropic.ContentBlockParam[] = [];
  if (p.entrada.imagem?.base64) {
    agora.push({ type: "image", source: { type: "base64", media_type: (p.entrada.imagem.mimeType || "image/jpeg").split(";")[0] as "image/jpeg", data: p.entrada.imagem.base64 } });
  }
  const texto = ouvi ? `(áudio do dono; transcrição automática: "${ouvi}")${p.entrada.texto ? ` ${p.entrada.texto}` : ""}` : p.entrada.texto;
  agora.push({ type: "text", text: `${p.entrada.rotulo} ${texto || (p.entrada.imagem ? "(foto do dono, sem legenda)" : "")}`.trim() });
  somar("user", agora);

  const chamar = async () => {
    const r = await claude(p.chave).messages.create(
      {
        model: MODELO_CLAUDE,
        max_tokens: 8000,
        system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
        tools: FERRAMENTAS,
        messages: mensagens,
      },
      { signal: AbortSignal.timeout(45_000) },
    );
    const u = r.usage;
    p.uso.entrada += u.input_tokens + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    p.uso.cache += u.cache_read_input_tokens || 0;
    p.uso.saida += u.output_tokens;
    return r;
  };

  /** Uma rodada: o modelo chama ferramentas até escrever a resposta. */
  const rodar = async (): Promise<string> => {
    for (let volta = 0; volta < 6; volta++) {
      const r = await chamar();
      const usos = r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (r.stop_reason !== "tool_use" || usos.length === 0) {
        if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return "";
        return r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      }
      // O pensamento volta junto, como veio: a API exige.
      mensagens.push({ role: "assistant", content: r.content as any });
      const resultados: Anthropic.ToolResultBlockParam[] = [];
      for (const uso of usos) {
        const resultado = await executarFerramentaDoAssessor(uso.name, uso.input || {}, p.ctx);
        p.acoes.push({ nome: uso.name, resultado });
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: JSON.stringify(resultado) });
      }
      mensagens.push({ role: "user", content: resultados });
    }
    return "";
  };

  let resposta = await rodar();
  // O mesmo "afirmou sem fazer" do Gemini (assessor.ts).
  if (p.acoes.length === 0 && resposta && p.afirmaAcao(resposta)) {
    somar("assistant", [{ type: "text", text: resposta }]);
    somar("user", [{ type: "text", text: "[SISTEMA] Você respondeu como se tivesse feito uma ação, mas NENHUMA ferramenta foi chamada: nada mudou no sistema. Se o dono pediu uma ação, chame a ferramenta agora. Se não pediu, responda de novo sem afirmar que fez." }]);
    resposta = await rodar();
  }
  return { resposta, ouvi };
}
