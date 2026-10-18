/**
 * Vendedores com 0% no LINK passam a 10% (Douglas, 18/10/2026: "quem veio pelo
 * link dele garante 10% de comissão"). Quem já tem % de link maior (20%/30%,
 * vindo do programa de embaixador) fica como está; quem tem entre 0 e 10
 * (exclusive) também não é tocado — aparece na lista para o Douglas decidir.
 *
 * Critério (o que este script muda): Ambassador com isVendedor = true e
 * commissionPercent = 0. É exatamente quem foi criado pelo "Cadastrar
 * vendedor" do admin antes desta versão (nascia com commissionPercent 0).
 * Pausados (active = false) também entram: o % só vale se ele voltar a ativo.
 *
 * Idempotente: rodar de novo não muda nada (já estão em 10).
 *
 *   npx tsx scripts/comissao-vendedores-10.ts            # só mostra
 *   npx tsx scripts/comissao-vendedores-10.ts --gravar   # grava (com o ok do Douglas, no deploy)
 *
 * Usa a DATABASE_URL do ambiente (produção só com aprovação).
 */
import { PrismaClient } from "@prisma/client";

const NOVO_PERCENTUAL = 10;
const gravar = process.argv.includes("--gravar");

async function main() {
  const prisma = new PrismaClient();
  try {
    const vendedores = await prisma.ambassador.findMany({
      where: { isVendedor: true },
      select: { id: true, name: true, email: true, active: true, commissionPercent: true, sellerPercent: true, _count: { select: { referredStores: true } } },
      orderBy: { name: "asc" },
    });
    const muda = vendedores.filter((v) => v.commissionPercent === 0);
    const fica = vendedores.filter((v) => v.commissionPercent !== 0);

    console.log(`\nVendedores da equipe: ${vendedores.length}`);
    console.log(`\n— Passam de 0% para ${NOVO_PERCENTUAL}% no link (${muda.length}) —`);
    for (const v of muda) console.log(`  ${v.name} <${v.email}> · ${v.active ? "ativo" : "PAUSADO"} · ${v._count.referredStores} loja(s) pelo link · atribuídas ${v.sellerPercent}%`);
    console.log(`\n— Ficam como estão (${fica.length}) —`);
    for (const v of fica) {
      const nota = v.commissionPercent > NOVO_PERCENTUAL ? "maior que 10, fica" : v.commissionPercent < NOVO_PERCENTUAL ? "ENTRE 0 e 10 — decidir à mão" : "já está em 10";
      console.log(`  ${v.name} <${v.email}> · link ${v.commissionPercent}% (${nota}) · ${v._count.referredStores} loja(s) pelo link`);
    }

    if (!gravar) {
      console.log(`\nNada gravado. Para aplicar: npx tsx scripts/comissao-vendedores-10.ts --gravar\n`);
      return;
    }
    if (!muda.length) {
      console.log("\nNada a gravar.\n");
      return;
    }
    const r = await prisma.ambassador.updateMany({
      where: { id: { in: muda.map((v) => v.id) }, isVendedor: true, commissionPercent: 0 },
      data: { commissionPercent: NOVO_PERCENTUAL },
    });
    console.log(`\nGravado: ${r.count} vendedor(es) agora com ${NOVO_PERCENTUAL}% no link. Vale a partir do próximo boleto fechado.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
