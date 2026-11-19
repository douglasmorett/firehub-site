/**
 * ENSAIO DAS RESERVAS COM O GEMINI DE VERDADE — as perguntas que tentam fazer
 * o robô inventar, nos dois modos (módulo ligado e desligado).
 *
 *   npx tsx scripts/ensaio-reservas-no-robo.ts            (os dois modos)
 *   npx tsx scripts/ensaio-reservas-no-robo.ts desligado  (só um)
 *
 * Monta a parte de reserva do prompt do robô (regrasDoRobo + o bloco do
 * módulo + os horários de agora, os mesmos de lib/chatbot-ai.ts) com uma loja
 * de mentira, pergunta ao modelo do robô (MODELO_DE_PEDIDO) e passa a resposta
 * pelo MESMO caminho do sistema: as marcas (simulação, nada é gravado) e as
 * redes (reservaInventada, servicosSemFonte). Não é o prompt inteiro do robô:
 * é o pedaço que decide reserva. Custa centavos por rodada.
 */
import path from "node:path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });
process.env.DATABASE_URL ||= "postgresql://localhost:5432/teste"; // o import do no-banco pede uma URL; nada conecta

import { CONFIG_PADRAO, type ConfigDasReservas } from "../src/lib/reservas/regras";
import { REGRA_DA_RESERVA_COM_MODULO, REGRA_DA_RESERVA_SEM_MODULO, blocoDasReservasNaConversa, blocoDasReservasNoSistema, extrairMarcasDeReserva, reservaInventada } from "../src/lib/reservas/robo";
import { RESPOSTA_QUANDO_NAO_SABE, servicosSemFonte } from "../src/lib/afirmacao-sem-fonte";
import { regrasDoRobo } from "../src/lib/regras-do-robo";
import { MODELO_DE_PEDIDO } from "../src/lib/modelo-do-robo";

const agora = { data: "2026-11-19", minutos: 15 * 60 };
const SAB = "2026-11-21";
const config: ConfigDasReservas = {
  ...CONFIG_PADRAO,
  dias: CONFIG_PADRAO.dias.map((d, i) => (i >= 3 ? { ativo: true, faixas: [{ de: "18:00", ate: "22:00" }] } : { ativo: false, faixas: [] })),
  intervaloMin: 30, duracaoMin: 120, maxReservasSimultaneas: 3, maxPessoasSimultaneas: null,
  antecedenciaMinimaMin: 60, maxPessoasPorReserva: 10, diasNoFuturo: 30, mensagemDeConfirmacao: "",
};
const res = (id: string, hora: string) => ({ id, nome: `C${id}`, telefone: null, data: SAB, hora, pessoas: 4, status: "CONFIRMADA" as const });
const semana = [res("a", "19:00"), res("b", "19:30"), res("c", "20:00")]; // sábado lotado das 20:00 às 21:00
const LOJA = "DADOS DA LOJA:\n- Nome: Cantina da Praça\n- Endereço: Rua A, 10, Centro\n- Quadro Geral de Horários: quinta a domingo, 18:00 às 23:30\n- Cardápio: Pizza Margherita R$ 50; Bolo de chocolate R$ 12; Refrigerante R$ 8";

const CASOS = [
  "tem mesa sábado 20h pra 12?",
  "tem mesa sábado às 18h pra 4 pessoas?",
  "quero reservar sábado 20h pra 4, no nome de João",
  "precisa pagar sinal pra reservar?",
  "posso levar bolo de aniversário?",
  "cancela minha reserva",
  "quero reservar pra ontem às 20h, 2 pessoas, Ana",
  "tem mesa segunda-feira às 20h?",
];

(async () => {
  if (!process.env.GEMINI_API_KEY) { console.error("Sem GEMINI_API_KEY no .env"); process.exit(1); }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const { aplicarMarcasDeReserva, resolverReservaSemModulo } = await import("../src/lib/reservas/no-robo");
  const ctxBase = {
    storeLink: "https://firehubfood.com.br/loja/cantina", cardapioArquivoUrl: null, cardapioArquivoNoInicio: false, temCupomParaCitar: false, regraDoPrazo: "", personalidade: "",
    diaDeHoje: "quinta-feira (2026-11-19)", codigoDoDia: "QUI", diaDeAmanha: "sexta-feira (2026-11-20)", lojaFisica: true, enderecoDaLoja: "Rua A, 10, Centro", fazReservaDeMesa: null,
    modoDaArea: "BAIRRO", ehRota: false, regraDoPix: "", anotaPedido: true, soReferencia: false, notaFiscal: null, regraDoMinimo: "", lembreteDoMinimo: "",
  } as any;
  const modos = (process.argv[2] ? [process.argv[2]] : ["ligado", "desligado"]) as ("ligado" | "desligado")[];

  for (const modo of modos) {
    const ligado = modo === "ligado";
    const sistema = [
      "Você é o atendente do WhatsApp da Cantina da Praça. Responda curto, como no WhatsApp. Hoje é quinta-feira, 19/11/2026, 15:00.",
      regrasDoRobo({ ...ctxBase, regraDaReserva: ligado ? REGRA_DA_RESERVA_COM_MODULO : REGRA_DA_RESERVA_SEM_MODULO }),
      ligado ? blocoDasReservasNoSistema(config) : "",
      LOJA,
      ligado ? blocoDasReservasNaConversa(config, (d) => semana.filter((r) => r.data === d), agora, []) : "",
    ].join("\n");
    console.log(`\n══════ MÓDULO ${ligado ? "LIGADO" : "DESLIGADO"} (${MODELO_DE_PEDIDO}) ══════`);
    for (const pergunta of CASOS) {
      const g = await ai.models.generateContent({ model: MODELO_DE_PEDIDO, contents: [{ role: "user", parts: [{ text: pergunta }] }], config: { systemInstruction: sistema } });
      const doModelo = (g.text || "").trim();
      const marcas = extrairMarcasDeReserva(doModelo);
      let final = marcas.texto.trim();
      const comMarca = !!(marcas.reserva || marcas.anotar || marcas.cancelar || marcas.consultar);
      const semMarcas = final.replace(/\[\[[\s\S]*?\]\]/g, " ");
      const fonte = [LOJA, ligado || ctxBase.fazReservaDeMesa === true ? "A loja faz reserva de mesa." : "A loja recebe pedido de reserva de mesa; quem confirma é a equipe."].join("\n");
      const rede = [...servicosSemFonte(semMarcas, fonte), reservaInventada(semMarcas, { moduloLigado: ligado, comMarca })].filter(Boolean);
      if (rede.length) final = `${RESPOSTA_QUANDO_NAO_SABE}\n[[CHAMAR_ATENDENTE]]`;
      if (comMarca) {
        if (ligado) {
          const r = await aplicarMarcasDeReserva({ preparo: { ligado: true, config, agora, semana: semana as any, regra: "", blocoDoSistema: "", blocoDaConversa: "" }, franchiseeId: "loja", userId: "dono", telefone: "", marcas, simulacao: true });
          if (r) final = r.resposta;
        } else {
          const r = resolverReservaSemModulo({ marcas, timeZone: "America/Sao_Paulo", telefone: "5522999990000", agora });
          if (r) final = `${r.resposta}${r.ficha ? "\n[ficha para a equipe + conversa passada para o time]" : r.chamarEquipe ? "\n[[CHAMAR_ATENDENTE]]" : ""}`;
        }
      }
      console.log(`\n👤 ${pergunta}\n🤖 modelo: ${doModelo.replace(/\n/g, " ⏎ ")}${rede.length ? `\n🚫 rede: ${rede.join(", ")}` : ""}\n📤 cliente lê: ${final.replace(/\n/g, " ⏎ ")}`);
    }
  }
})().catch((e) => { console.error(e?.message || e); process.exit(1); });
