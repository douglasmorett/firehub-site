import { Type, type GoogleGenAI } from "@google/genai";

/**
 * O REVISOR DO ROBÔ DO FIREHUB — confere a resposta antes de ela sair.
 *
 * A regra "só afirme o que está na BASE" está no prompt desde o começo, e não
 * bastou: em 01/10/2026 o Fabiano (Ragnar) perguntou se dava para mudar um
 * pedido de delivery para mesa, e o robô respondeu que sim — "abre o pedido em
 * Pedidos e altera o tipo dele por ali". A função não existia. A base só diz
 * "Pedidos: menu Pedidos"; o modelo completou o resto, com a confiança das
 * respostas técnicas da equipe que estavam logo acima na conversa.
 *
 * Pedir de novo, mais alto, ao mesmo modelo que gerou a resposta não resolve.
 * Então outra chamada, com temperatura 0 e uma tarefa só: a resposta afirma
 * alguma coisa sobre o FireHub que não está na base, nas ferramentas ou no que
 * a equipe já disse nesta conversa? Se sim, a resposta não sai: o contato
 * recebe "vou confirmar com a equipe" e uma pessoa é chamada com o texto que o
 * robô ia mandar (robo.ts).
 *
 * Revisor fora do ar (sem resposta dos dois modelos) = a resposta sai: o robô
 * principal também usa o Gemini, e silenciar tudo numa falha da API seria
 * chamar pessoa em toda mensagem.
 */

const MODELOS_DO_REVISOR = ["gemini-2.5-flash", "gemini-3.6-flash"];

export type Veredito = { inventou: boolean; trecho: string };

export type ParaConferir = {
  base: string;
  /** As últimas mensagens, já com quem falou: "Contato: …", "Equipe (Douglas): …", "Robô: …". */
  conversa: string;
  /** O que as ferramentas devolveram nesta resposta (estado da loja, fatura…). */
  ferramentas: string;
  resposta: string;
};

const INSTRUCOES = `Você é o revisor do atendimento do FireHub (sistema para delivery e restaurantes) no WhatsApp. Um assistente virtual escreveu uma resposta para um contato. Sua única tarefa: dizer se a resposta AFIRMA alguma coisa sobre o FireHub que não tem fonte.

Fontes válidas (e só estas):
1. A BASE — inclui a lista de vídeos tutoriais (título, capítulos e link de cada um) e, quando houver, "O que os vídeos ensinam": a fala gravada de cada capítulo, que vale como manual do painel.
2. O que as FERRAMENTAS devolveram (ver_tutorial devolve a fala de um vídeo: também vale como manual).
3. O que uma pessoa da EQUIPE já escreveu nesta conversa (vale para o assunto que ela tratou).

Marque inventou = true quando a resposta afirma, sem fonte:
- que uma função existe ou não existe, ou que dá ou não dá para fazer algo no sistema;
- onde fica um botão, menu, aba ou tela, ou um passo a passo de como fazer algo no painel;
- preço, prazo, desconto, integração, regra de funcionamento.
Um passo a passo detalhado em cima de uma linha genérica da base (ex.: a base diz só "Pedidos: menu Pedidos" e a resposta explica como alterar o pedido por ali) é inventado.

Link de vídeo que não está na lista é inventado.

NÃO marque: cumprimento, pergunta, pedir dados, dizer que vai confirmar com a equipe ou chamar alguém, repetir o que o próprio contato disse, falar do caso dele sem afirmar como o sistema funciona, mandar o link de um vídeo da lista dizendo que ele mostra o assunto do título ou dos capítulos dele.

Em "trecho", copie a frase da resposta que não tem fonte (vazio quando inventou = false).`;

export async function conferirResposta(ai: GoogleGenAI, c: ParaConferir): Promise<Veredito | null> {
  const texto = `# BASE
${c.base}

# FERRAMENTAS
${c.ferramentas.trim() || "(nenhuma nesta resposta)"}

# CONVERSA (mais recentes por último)
${c.conversa}

# RESPOSTA QUE O ASSISTENTE QUER MANDAR
${c.resposta}`;

  for (const modelo of MODELOS_DO_REVISOR) {
    try {
      const r = await ai.models.generateContent({
        model: modelo,
        contents: [{ role: "user", parts: [{ text: texto }] }],
        config: {
          systemInstruction: INSTRUCOES,
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: { inventou: { type: Type.BOOLEAN }, trecho: { type: Type.STRING } },
            required: ["inventou", "trecho"],
          },
        },
      });
      const v = JSON.parse(r.text || "{}");
      if (typeof v.inventou === "boolean") return { inventou: v.inventou, trecho: String(v.trecho || "").slice(0, 300) };
    } catch (err: any) {
      console.warn(`[Atendimento] Revisor com ${modelo} falhou: ${err?.message}`);
    }
  }
  return null;
}

/** O que o contato recebe no lugar da resposta barrada. */
export const RESPOSTA_DE_QUEM_NAO_SABE =
  "Essa eu vou confirmar com a nossa equipe para não te passar nada errado. Alguém já te responde por aqui.";
