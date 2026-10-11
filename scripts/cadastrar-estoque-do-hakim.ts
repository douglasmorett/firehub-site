/**
 * Cadastra no estoque do Hakim os insumos e os PREPAROS (massa, recheios,
 * bases) das fichas revisadas pelo Douglas em 11/10/2026 (página de revisão
 * https://claude.ai/artifact/T718JGT5o8hWr2etqGVQkP), com local na cozinha e a
 * marcação "contar todo dia" dos que mais pesam no CMV.
 *
 *   npx tsx scripts/cadastrar-estoque-do-hakim.ts --loja <email da loja>            (só mostra o plano)
 *   npx tsx scripts/cadastrar-estoque-do-hakim.ts --loja <email da loja> --gravar   (grava)
 *
 * Idempotente: insumo que já existe (mesmo nome, sem diferenciar caixa) não é
 * duplicado — só ganha o que falta (tipo, rendimento, local, contagem do dia) e
 * a receita, se for preparo. Saldo e custo NÃO são mexidos: o saldo nasce da
 * primeira contagem completa e o custo das compras lançadas.
 *
 * Decisões das fichas que valem aqui (respostas do Douglas na revisão):
 *   - bases: carne e calabresa 25 g; queijo (mussarela pura) e queijo temperado
 *     20 g; frango = 20 g de mussarela + 10 g de frango; catupiry/cheddar 15 g;
 *   - recheio de carne: receita de dez/2025 com 20% de perda de líquido;
 *   - frango: 1 kg cru vira 700 g + uns 200 ml de molho de tomate;
 *   - 3 queijos: 700 mussarela + 150 parmesão + 150 provolone;
 *   - bacon de pernil vai cru, 10% de perda na limpeza;
 *   - kibe parado: fica de fora até voltar.
 * Em aberto (conferir pesando): o rendimento do recheio de carne e do frango,
 * e o limão (a receita fala em 200 ml de caldo; aqui entra como 500 g de limão,
 * a conta da planilha antiga).
 */
import { prisma } from "@/lib/prisma";

/** `custo`: o preço que o Douglas passou, só para o insumo que ainda não tem custo (a compra lançada manda depois). */
type Insumo = { nome: string; unidade: "g" | "ml" | "un"; local: string; diaria?: boolean; foraDoCmv?: boolean; custo?: number };
type Preparo = Insumo & { rende: number; receita: [string, number][] };

const INSUMOS: Insumo[] = [
  // Massa
  { nome: "Farinha de trigo", unidade: "g", local: "Estoque seco" },
  { nome: "Óleo", unidade: "ml", local: "Estoque seco" },
  { nome: "Açúcar", unidade: "g", local: "Estoque seco" },
  { nome: "Fermento biológico", unidade: "g", local: "Estoque seco" },
  { nome: "Sal", unidade: "g", local: "Estoque seco" },
  // Carne
  { nome: "Carne moída", unidade: "g", local: "Freezer", diaria: true },
  { nome: "Tomate", unidade: "g", local: "Geladeira" },
  { nome: "Cebola", unidade: "g", local: "Estoque seco" },
  { nome: "Limão", unidade: "g", local: "Geladeira" },
  { nome: "Sazón carne", unidade: "g", local: "Estoque seco" },
  // Frango
  { nome: "Frango (peito)", unidade: "g", local: "Freezer", diaria: true },
  { nome: "Colorau", unidade: "g", local: "Estoque seco" },
  { nome: "Pasta de alho", unidade: "g", local: "Geladeira" },
  { nome: "Sazón galinha", unidade: "g", local: "Estoque seco" },
  { nome: "Molho de tomate", unidade: "ml", local: "Estoque seco" },
  // Queijos e coberturas
  { nome: "Mussarela", unidade: "g", local: "Geladeira", diaria: true },
  { nome: "Parmesão", unidade: "g", local: "Geladeira" },
  { nome: "Provolone", unidade: "g", local: "Geladeira" },
  { nome: "Cheiro-verde (maço)", unidade: "un", local: "Geladeira" },
  { nome: "Calabresa", unidade: "g", local: "Geladeira" },
  { nome: "Bacon de pernil", unidade: "g", local: "Geladeira", diaria: true },
  { nome: "Catupiry", unidade: "g", local: "Geladeira", diaria: true },
  { nome: "Cheddar", unidade: "g", local: "Geladeira", diaria: true },
  { nome: "Peperoni", unidade: "g", local: "Geladeira" },
  // Doces
  { nome: "Chocolate ao leite", unidade: "g", local: "Estoque seco", diaria: true },
  { nome: "Chocolate branco", unidade: "g", local: "Estoque seco" },
  { nome: "Nutella", unidade: "g", local: "Estoque seco" },
  { nome: "Goiabada", unidade: "g", local: "Estoque seco" },
  { nome: "M&M's", unidade: "g", local: "Estoque seco" },
  { nome: "Kit Kat (barra de 4 palitos)", unidade: "un", local: "Estoque seco" },
  { nome: "Morango", unidade: "un", local: "Geladeira" },
  { nome: "Banana", unidade: "un", local: "Bancada" },
  // Embalagens (entram no CMV)
  { nome: "Embalagem P personalizada", unidade: "un", local: "Embalagens", custo: 0.5 },
  { nome: "Embalagem G personalizada", unidade: "un", local: "Embalagens", diaria: true, custo: 1 },
  { nome: "Saco kraft", unidade: "un", local: "Embalagens", custo: 0.7 },
  { nome: "Caixinha de batata", unidade: "un", local: "Embalagens" },
  // Revenda: bebidas, nugget e o brinde do Hakim Kids (1 un por venda)
  { nome: "Coca-Cola lata", unidade: "un", local: "Bebidas" },
  { nome: "Coca-Cola Zero lata", unidade: "un", local: "Bebidas" },
  { nome: "Coca-Cola 2L", unidade: "un", local: "Bebidas" },
  { nome: "Fanta Laranja lata", unidade: "un", local: "Bebidas" },
  { nome: "Fanta Uva lata", unidade: "un", local: "Bebidas" },
  { nome: "Guaravita 280ml", unidade: "un", local: "Bebidas" },
  { nome: "Água com gás", unidade: "un", local: "Bebidas" },
  { nome: "Água sem gás", unidade: "un", local: "Bebidas" },
  { nome: "Nugget", unidade: "un", local: "Freezer" },
  // Acompanhamentos (respostas do Douglas, 11/10 à tarde)
  { nome: "Batata frita congelada", unidade: "g", local: "Freezer" },
  { nome: "Salsicha", unidade: "un", local: "Geladeira" },
  { nome: "Maionese da casa (porção)", unidade: "un", local: "Geladeira", custo: 0.7 },
  { nome: "Pastel de nata (pronto)", unidade: "un", local: "Freezer", custo: 1.8 },
  { nome: "Brinde Panda", unidade: "un", local: "Estoque seco", custo: 8 },
];

/**
 * Os 4 insumos que estavam na loja antes (11/10/2026) são de demonstração:
 * "Mussarela fatiada" e "Carne moída temperada" em kg, "bola 45g", balde de
 * requeijão — nenhum ligado a ficha. Arquivados (some da lista, histórico fica)
 * para a contagem não ter item duplicado com o cadastro de verdade.
 */
const ARQUIVAR = ["Massa de esfirra (bola 45g)", "Mussarela fatiada", "Carne moída temperada", "Requeijão cremoso (balde 3,6kg)"];

const PREPAROS: Preparo[] = [
  { nome: "Massa de esfirra (bolinha)", unidade: "un", local: "Geladeira", diaria: true, rende: 200,
    receita: [["Farinha de trigo", 5000], ["Óleo", 625], ["Açúcar", 625], ["Fermento biológico", 10], ["Sal", 60]] },
  { nome: "Recheio de carne", unidade: "g", local: "Geladeira", diaria: true, rende: 1315,
    receita: [["Carne moída", 1000], ["Tomate", 200], ["Cebola", 200], ["Limão", 500], ["Sazón carne", 32], ["Sal", 12]] },
  { nome: "Recheio de frango", unidade: "g", local: "Geladeira", diaria: true, rende: 900,
    receita: [["Frango (peito)", 1000], ["Sal", 8], ["Colorau", 8], ["Pasta de alho", 20], ["Sazón galinha", 8], ["Óleo", 10], ["Molho de tomate", 200]] },
  { nome: "Recheio de calabresa", unidade: "g", local: "Geladeira", diaria: true, rende: 1000,
    receita: [["Calabresa", 700], ["Mussarela", 300]] },
  { nome: "Queijo temperado", unidade: "g", local: "Geladeira", diaria: true, rende: 1000,
    receita: [["Mussarela", 1000], ["Cheiro-verde (maço)", 0.5]] },
  { nome: "Mistura de 3 queijos", unidade: "g", local: "Geladeira", rende: 1000,
    receita: [["Mussarela", 700], ["Parmesão", 150], ["Provolone", 150]] },
  { nome: "Bacon limpo", unidade: "g", local: "Geladeira", rende: 900,
    receita: [["Bacon de pernil", 1000]] },
];

async function main() {
  const args = process.argv.slice(2);
  const email = args[args.indexOf("--loja") + 1];
  const gravar = args.includes("--gravar");
  if (!email || args.indexOf("--loja") < 0) { console.error("Use --loja <email da loja>."); process.exit(2); }

  const loja = await prisma.user.findUnique({ where: { email }, select: { id: true, storeName: true, role: true } });
  if (!loja) { console.error(`Loja ${email} não encontrada.`); process.exit(2); }
  console.log(`Loja: ${loja.storeName} (${loja.id}) — ${gravar ? "GRAVANDO" : "só o plano"}\n`);

  const existentes = await prisma.stockItem.findMany({ where: { franchiseeId: loja.id }, select: { id: true, name: true, unit: true, active: true } });
  const porNome = new Map(existentes.map((e) => [e.name.trim().toLowerCase(), e]));
  const ids = new Map<string, string>();

  for (const i of [...INSUMOS, ...PREPAROS]) {
    const preparo = "rende" in i;
    const dados = {
      tipo: preparo ? "PREPARO" : "INSUMO",
      rendimento: preparo ? (i as Preparo).rende : null,
      local: i.local,
      contagemDiaria: Boolean(i.diaria),
      entraNoCmv: !i.foraDoCmv,
    };
    const achado = porNome.get(i.nome.toLowerCase());
    if (achado) {
      if (achado.unit !== i.unidade) console.log(`⚠️  ${i.nome}: já existe em "${achado.unit}", a ficha usa "${i.unidade}". Mantido como está — confira.`);
      console.log(`=  ${i.nome} (já existe) → ${preparo ? `preparo, rende ${(i as Preparo).rende} ${i.unidade}` : "insumo"}, ${i.local}${i.diaria ? ", conta todo dia" : ""}`);
      if (gravar) await prisma.stockItem.update({ where: { id: achado.id }, data: { ...dados, active: true } });
      if (gravar && i.custo != null) await prisma.stockItem.updateMany({ where: { id: achado.id, unitCost: null }, data: { unitCost: i.custo } });
      ids.set(i.nome, achado.id);
    } else {
      console.log(`+  ${i.nome} (${i.unidade}) → ${preparo ? `preparo, rende ${(i as Preparo).rende} ${i.unidade}` : "insumo"}, ${i.local}${i.diaria ? ", conta todo dia" : ""}`);
      if (gravar) {
        const novo = await prisma.stockItem.create({ data: { franchiseeId: loja.id, name: i.nome, unit: i.unidade, quantity: 0, unitCost: i.custo ?? null, ...dados } });
        ids.set(i.nome, novo.id);
      }
    }
  }

  for (const nome of ARQUIVAR) {
    const velho = porNome.get(nome.toLowerCase());
    if (!velho || velho.active === false) continue;
    console.log(`-  ${nome} (demonstração) → arquivado`);
    if (gravar) await prisma.stockItem.update({ where: { id: velho.id }, data: { active: false } });
  }

  console.log("");
  for (const p of PREPAROS) {
    console.log(`Receita de ${p.nome} (rende ${p.rende} ${p.unidade}): ${p.receita.map(([n, q]) => `${q} ${INSUMOS.find((x) => x.nome === n)?.unidade || ""} ${n}`).join(" + ")}`);
    if (!gravar) continue;
    const preparoId = ids.get(p.nome)!;
    await prisma.componenteDoPreparo.deleteMany({ where: { preparoId } });
    await prisma.componenteDoPreparo.createMany({ data: p.receita.map(([n, q]) => ({ preparoId, insumoId: ids.get(n)!, quantidade: q })) });
  }

  console.log(`\n${INSUMOS.length} insumos e ${PREPAROS.length} preparos. ${gravar ? "Gravado." : "Nada foi gravado: rode com --gravar."}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
