/**
 * O robô do número do FireHub VÊ a mídia (midias.ts + conversaParaOModelo).
 *
 *   npx tsx scripts/teste-midias-do-robo.ts
 *
 * Sem banco e sem Gemini: guarda/lê os bytes, a espera enquanto a mídia é
 * lida, e a imagem indo junto da mensagem certa para o modelo. Ver também os
 * casos "imagem-*" do ensaio (scripts/ensaio-do-robo-do-firehub.ts), que usam
 * o Gemini de verdade.
 */
import {
  TAMANHO_MAXIMO_DA_MIDIA, bytesDoBase64, comecouALer, guardarMidia, midiaGuardada, midiaQueOModeloLe, midiaSendoLida, terminouDeLer,
} from "../src/lib/atendimento/midias";

let falhas = 0;
const confere = (oQue: string, ok: boolean, detalhe = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok || !detalhe ? "" : ` — ${detalhe}`}`);
};

(async () => {
  // robo.ts importa o prisma, que exige a variável; nenhuma consulta é feita aqui.
  process.env.DATABASE_URL ||= "postgresql://127.0.0.1:1/teste";
  const { conversaParaOModelo } = await import("../src/lib/atendimento/robo");

  // ── Guardar e ler ──────────────────────────────────────────────────────────
  guardarMidia("m1", "data:image/jpeg;base64,QUJDRA==", "image/jpeg; charset=x");
  const m1 = midiaGuardada("m1");
  confere("guarda sem o prefixo data:", m1?.base64 === "QUJDRA==", JSON.stringify(m1));
  confere("mime limpo", m1?.mimeType === "image/jpeg", m1?.mimeType);
  confere("id que não existe = null", midiaGuardada("nada") === null);
  const grande = "A".repeat(Math.ceil(((TAMANHO_MAXIMO_DA_MIDIA + 10) * 4) / 3));
  guardarMidia("m2", grande, "video/mp4");
  confere("mídia acima do teto não é guardada", midiaGuardada("m2") === null);
  confere("tamanho do base64", bytesDoBase64("QUJDRA==") === 6);

  // ── O que o Gemini lê ─────────────────────────────────────────────────────
  confere("lê imagem", midiaQueOModeloLe("image/png"));
  confere("lê vídeo", midiaQueOModeloLe("video/mp4"));
  confere("lê PDF", midiaQueOModeloLe("application/pdf"));
  confere("não lê planilha", !midiaQueOModeloLe("application/vnd.ms-excel"));

  // ── Esperar a leitura ─────────────────────────────────────────────────────
  confere("sem leitura, não espera", !midiaSendoLida("c1"));
  comecouALer("c1", "m1");
  comecouALer("c1", "m3");
  confere("lendo, espera", midiaSendoLida("c1"));
  terminouDeLer("c1", "m1");
  confere("ainda falta uma, espera", midiaSendoLida("c1"));
  terminouDeLer("c1", "m3");
  confere("leu tudo, não espera mais", !midiaSendoLida("c1"));
  confere("outro contato não espera", !midiaSendoLida("c2"));

  // ── A imagem vai junto da mensagem dela ───────────────────────────────────
  const conversa = conversaParaOModelo([
    { direcao: "ENTRADA", autor: "CLIENTE", autorNome: null, texto: "quero a grande na promoção" },
    { direcao: "SAIDA", autor: "ROBO", autorNome: null, texto: "Na linha da Grande…" },
    { direcao: "ENTRADA", autor: "CLIENTE", autorNome: null, texto: "📷 Assim?\n[O que a imagem mostra: …]", midia: { base64: "QUJDRA==", mimeType: "image/jpeg" } },
    { direcao: "ENTRADA", autor: "CLIENTE", autorNome: null, texto: "e agora?" },
  ]);
  const ultima = conversa[conversa.length - 1];
  confere("três voltas (user, model, user)", conversa.length === 3 && ultima.role === "user", JSON.stringify(conversa.map((c) => c.role)));
  confere("a imagem vem logo depois do texto dela", !!ultima.parts?.[1]?.inlineData && ultima.parts[1].inlineData.mimeType === "image/jpeg", JSON.stringify(ultima.parts?.map((p) => Object.keys(p))));
  confere("e o texto seguinte depois da imagem", ultima.parts?.[2]?.text === "e agora?");
  const daEquipe = conversaParaOModelo([
    { direcao: "ENTRADA", autor: "CLIENTE", autorNome: null, texto: "oi" },
    { direcao: "SAIDA", autor: "CELULAR", autorNome: "Pelo celular", texto: "📷 Imagem enviada pelo celular", midia: { base64: "QUJDRA==", mimeType: "image/jpeg" } },
  ]);
  confere("mídia da equipe não vai como se fosse do contato", !daEquipe[1].parts?.some((p) => p.inlineData));

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
