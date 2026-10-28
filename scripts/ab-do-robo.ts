/**
 * LABORATÓRIO DE A/B DO ROBÔ DAS LOJAS — compara modelos com o robô DE VERDADE.
 *
 *   FIREHUB_AB_SEM_REGISTRO=1 FIREHUB_AB_SEM_GRAVAR=1 FIREHUB_AB_SEM_CACHE=1 \
 *   [FIREHUB_AB_MODELO_DE_PEDIDO=gemini-3.8-flash] \
 *   [FIREHUB_AB_MODELO_BARATO=gemini-3.5-flash-lite FIREHUB_AB_ROTEADOR=1] \
 *   OUT=/caminho/saida.json npx tsx scripts/ab-do-robo.ts <variante> [--rodadas 3] [--lojas slug1,slug2]
 *
 * Usa `processChatbotAI` (o mesmo prompt, a mesma loja, o mesmo cardápio) SEM
 * número de WhatsApp: nada é enviado, nenhum pedido é gravado, nada vai ao
 * UsageLog (as três variáveis FIREHUB_AB_SEM_* — o script RECUSA rodar sem
 * elas). As variáveis de modelo são lidas na importação, por isso cada
 * variante roda em um processo.
 *
 * Cada cenário é uma conversa de várias falas do cliente; a resposta do robô
 * volta ao histórico como no WhatsApp. As checagens são automáticas e miram
 * os erros que já apareceram nos A/B de 23/09 e 03/10 e na revisão de 09/10:
 * esquecer a marca [[PEDIDO_IA]], preço inventado, inventar status de pedido,
 * negar o Pix, escrever demais. Custa centavos por rodada; guarda as respostas
 * para revisão humana.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const pasta = process.env.ENV_DIR || process.cwd();
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });

for (const v of ["FIREHUB_AB_SEM_REGISTRO", "FIREHUB_AB_SEM_GRAVAR", "FIREHUB_AB_SEM_CACHE"]) {
  if (process.env[v] !== "1") {
    console.error(`Recuso rodar sem ${v}=1 (nada pode ser gravado em produção).`);
    process.exit(2);
  }
}

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const variante = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "controle";
const RODADAS = Number(arg("rodadas") || 3);
const SLUGS = (arg("lojas") || "").split(",").filter(Boolean);

type Resp = { visivel: string; bruto: string };
type Cenario = {
  nome: string;
  falas: string[];
  /** Checagens sobre a ÚLTIMA resposta e sobre todas. */
  checa: (c: Resp & { todas: Resp[] }) => { ok: boolean; motivo?: string }[];
  /** Cenário só de observação (não entra na taxa de acerto). */
  informativo?: boolean;
};

const emojis = (t: string) => (t.match(/\p{Extended_Pictographic}/gu) || []).length;
const paragrafos = (t: string) => t.split(/\n\s*\n/).filter((x) => x.trim()).length;
const reais = (t: string) =>
  [...t.matchAll(/R\$\s*([0-9]{1,4}(?:[.,][0-9]{1,2})?)/g)]
    .map((m) => Number(m[1].replace(",", ".")))
    .filter((n) => Number.isFinite(n));

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { processChatbotAI } = await import("../src/lib/chatbot-ai");

  const lojas = await prisma.user.findMany({
    where: SLUGS.length ? { slug: { in: SLUGS } } : { storeName: { in: ["Pizzaria Lapastine", "PIZZARIA 17", "Divinos burger"] } },
    select: { id: true, storeName: true, slug: true, storeDeliveryOnly: true },
  });
  if (!lojas.length) {
    console.error("nenhuma loja achada");
    process.exit(1);
  }

  const g: any = globalThis;
  g.__abUsos ||= [];
  g.__abBrutos ||= [];
  const resultados: any[] = [];

  for (const loja of lojas) {
    const produtos = await prisma.menuProduct.findMany({
      where: { franchiseeId: loja.id, active: true, apenasEmCombo: false },
      select: { name: true, price: true, isCombo: true, isBeverage: true },
    });
    const comuns = produtos.filter((p) => !p.isCombo && !p.isBeverage && p.price > 10);
    if (comuns.length < 2) {
      console.error(`${loja.storeName}: poucos produtos`);
      continue;
    }
    // Os dois mais caros (até R$ 150): o pedido passa do mínimo da loja e dá para fechar (28/10: a porção de R$ 26,99 parava no mínimo de R$ 50).
    const porPreco = [...comuns].filter((p) => p.price <= 150).sort((a, b) => b.price - a.price);
    const p1 = porPreco[0] || comuns[0];
    const p2 = porPreco[1] || comuns[Math.min(5, comuns.length - 1)];
    // Loja só de delivery recusa retirada com razão: ali o fechamento vira só observação.
    const soDelivery = Boolean((loja as any).storeDeliveryOnly);
    const precos = [...new Set(produtos.map((p) => p.price).filter((x) => x > 0))].slice(0, 200);
    // Um valor "cabe" se é taxa/adicional (até R$ 12) ou está a até R$ 12 de uma soma de até 3 preços do cardápio.
    const valido = (v: number) => {
      if (v <= 12) return true;
      for (const a of precos) {
        if (Math.abs(v - a) <= 12) return true;
        for (const b of precos) {
          if (Math.abs(v - a - b) <= 12) return true;
          for (const c of precos) if (Math.abs(v - a - b - c) <= 12) return true;
        }
      }
      return false;
    };
    const temMarca = (todas: Resp[]) => /\[\[\s*PEDIDO_IA/i.test(todas.map((t) => t.bruto).join("\n"));
    // Fechou de verdade: a marca do pedido com "finalized": true em alguma resposta.
    const fechou = (todas: Resp[]) => todas.some((t) => /\[\[\s*PEDIDO_IA[\s\S]*"finalized"\s*:\s*true/i.test(t.bruto));

    const cenarios: Cenario[] = [
      {
        nome: "oi",
        falas: ["oi"],
        checa: ({ visivel }) => [
          { ok: visivel.length > 0, motivo: "resposta vazia" },
          { ok: paragrafos(visivel) <= 3, motivo: `${paragrafos(visivel)} parágrafos` },
          { ok: emojis(visivel) <= 3, motivo: `${emojis(visivel)} emojis` },
          { ok: reais(visivel).every(valido), motivo: "preço fora do cardápio" },
        ],
      },
      {
        nome: "horario",
        falas: ["oi, que horas vocês abrem hoje?"],
        checa: ({ visivel }) => [
          { ok: /\d{1,2}\s*(h|:)/i.test(visivel) || /fechad|abre|abert/i.test(visivel), motivo: "não falou horário/estado" },
          { ok: paragrafos(visivel) <= 3, motivo: "parágrafos demais" },
          // Completude (revisão de 25/10): loja aberta tem que dizer até que horas.
          {
            ok: !/(aberto|aberta|abertos|funcionando|já estamos)/i.test(visivel) || /fechad/i.test(visivel) || /(até|fecha\w*)\s*(as|às|a)?\s*\d{1,2}/i.test(visivel),
            motivo: "disse que está aberto sem a hora de fechar",
          },
        ],
      },
      {
        nome: "preco-exato",
        falas: [`quanto é a ${p1.name}?`],
        checa: ({ visivel }) => [
          { ok: reais(visivel).length === 0 || reais(visivel).some((n) => Math.abs(n - p1.price) < 0.01), motivo: `preço de ${p1.name} (R$ ${p1.price}) não bate` },
          { ok: reais(visivel).every(valido), motivo: "preço fora do cardápio" },
        ],
      },
      {
        nome: "cardapio",
        falas: ["me manda o cardápio"],
        checa: ({ visivel }) => [
          { ok: /http|cardápio|cardapio|link/i.test(visivel), motivo: "sem link/cardápio" },
          { ok: reais(visivel).every(valido), motivo: "preço fora do cardápio" },
        ],
      },
      {
        nome: "cade-meu-pedido",
        falas: ["cadê meu pedido?"],
        checa: ({ visivel }) => [
          { ok: !/(em preparo|preparando|saiu para (a )?entrega|a caminho|no forno|já está sendo)/i.test(visivel), motivo: "inventou status de pedido" },
        ],
      },
      {
        nome: "pix",
        falas: ["vocês aceitam pix?"],
        checa: ({ visivel }) => [{ ok: !/não (aceitamos|trabalhamos com|temos) pix/i.test(visivel), motivo: "negou o Pix" }],
      },
      {
        nome: "atendente",
        falas: ["quero falar com um atendente"],
        checa: ({ visivel, bruto }) => [{ ok: /atendente|humano|equipe|alguém|pessoa|aguard/i.test(visivel + bruto), motivo: "não encaminhou ao atendente" }],
      },
      {
        nome: "fecha-pedido-retirada",
        informativo: soDelivery,
        falas: [`quero 1 ${p1.name}`, "vou retirar aí", "no dinheiro", "pode confirmar"],
        checa: ({ todas, visivel }) => [
          { ok: temMarca(todas), motivo: "esqueceu a marca [[PEDIDO_IA]] no pedido" },
          { ok: fechou(todas), motivo: "não fechou o pedido (finalized)" },
          { ok: reais(visivel).every(valido), motivo: "preço fora do cardápio" },
        ],
      },
      {
        nome: "fecha-pedido-2-itens",
        informativo: soDelivery,
        falas: [`quero 1 ${p1.name} e 1 ${p2.name}`, "retirada", "pix", "confirma"],
        checa: ({ todas, visivel }) => [
          { ok: temMarca(todas), motivo: "esqueceu a marca [[PEDIDO_IA]] no pedido" },
          { ok: fechou(todas), motivo: "não fechou o pedido (finalized)" },
          { ok: reais(visivel).every(valido), motivo: "preço fora do cardápio" },
        ],
      },
      {
        nome: "combo-ambiguo(info)",
        falas: [`quero 1 ${p1.name}`, "e do combo?", "quero esse mesmo"],
        informativo: true,
        checa: ({ visivel }) => [{ ok: /combo/i.test(visivel), motivo: "(info) não falou de combo no fim" }],
      },
    ];

    for (let r = 1; r <= RODADAS; r++) {
      for (const cen of cenarios) {
        const historico: { sender: string; text: string }[] = [];
        // Telefone de mentira (um por conversa): o robô só o usa para ler o rascunho do cliente; nada é gravado (FIREHUB_AB_SEM_GRAVAR).
        const remoteJid = `5599${String(900000000 + lojas.indexOf(loja) * 100000 + r * 1000 + cenarios.indexOf(cen))}@s.whatsapp.net`;
        const todas: Resp[] = [];
        let erro: string | null = null;
        const antesUsos = g.__abUsos.length;
        const t0 = Date.now();
        for (const fala of cen.falas) {
          try {
            const antesBrutos = g.__abBrutos.length;
            const res: any = await processChatbotAI(loja.id, fala, historico, remoteJid, undefined, "Cliente Teste");
            const visivel = String(res?.reply || "");
            const bruto = g.__abBrutos.length > antesBrutos ? String(g.__abBrutos[g.__abBrutos.length - 1]) : visivel;
            todas.push({ visivel, bruto });
            historico.push({ sender: "user", text: fala }, { sender: "bot", text: visivel });
          } catch (e: any) {
            erro = String(e?.message || e).slice(0, 200);
            break;
          }
        }
        const ultimo = todas[todas.length - 1] || { visivel: "", bruto: "" };
        const checagens = erro ? [{ ok: false, motivo: `erro: ${erro}` }] : cen.checa({ ...ultimo, todas });
        resultados.push({
          variante,
          loja: loja.storeName,
          rodada: r,
          cenario: cen.nome,
          informativo: !!cen.informativo,
          ok: checagens.every((c) => c.ok),
          falhas: checagens.filter((c) => !c.ok).map((c) => c.motivo),
          respostas: todas.map((t) => t.visivel),
          ms: Date.now() - t0,
          usos: g.__abUsos.slice(antesUsos).map((u: any) => ({
            modelo: u.modelo,
            entrada: u.usage.promptTokenCount || 0,
            saida: u.usage.candidatesTokenCount || 0,
            pensamento: u.usage.thoughtsTokenCount || 0,
            cache: u.usage.cachedContentTokenCount || 0,
            custoUsd: u.usage.custoUsd || 0,
          })),
        });
        process.stdout.write(resultados[resultados.length - 1].ok ? "." : "F");
      }
    }
  }
  console.log("");
  const out = process.env.OUT || path.join(process.cwd(), `ab-${variante}.json`);
  fs.writeFileSync(out, JSON.stringify(resultados, null, 1));
  const valem = resultados.filter((x) => !x.informativo);
  console.log(`${variante}: ${valem.filter((x) => x.ok).length}/${valem.length} cenários ok → ${out}`);
  // Quem respondeu DE VERDADE: em 25/10 o "teste do Haiku" saiu inteiro do 2.5 Flash de reserva e ninguém viu.
  const usos = resultados.flatMap((x) => x.usos);
  const testado = process.env.FIREHUB_AB_MODELO_DE_PEDIDO || "gemini-3.6-flash";
  const doTestado = usos.filter((u: any) => u.modelo === testado).length;
  console.log(`respondido por ${testado}: ${doTestado}/${usos.length} chamadas${doTestado < usos.length ? " — ATENÇÃO: o resto caiu na reserva" : ""}`);
  const custo = usos.reduce((s: number, u: any) => s + (u.custoUsd || 0), 0);
  if (custo) console.log(`custo real (OpenRouter): US$ ${custo.toFixed(4)} no total, US$ ${(custo / Math.max(doTestado, 1)).toFixed(5)} por resposta`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
