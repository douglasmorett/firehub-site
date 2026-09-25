// E1c (extra) — a validação das faixas também está no SERVIDOR (PUT
// /api/store-settings, sessão da loja): km repetido, km 0, taxa negativa,
// tempo 0, repasse faltando numa faixa. Nada disso pode gravar. No fim,
// confere que o cadastro do E1 continua intacto.
import { navegador, contextoPainel, entrarNoPainel, BASE, banco, gravarResultado, EMAIL, dormir } from "./comum.mjs";

const prisma = banco();
const antes = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true, deliveryZoneType: true } });
const boas = antes.deliveryZones;
const r = { casos: {} };
const b = await navegador();
const page = await (await contextoPainel(b)).newPage();
try {
  await entrarNoPainel(page);
  const put = (corpo) => page.evaluate(async ([u, c]) => {
    const res = await fetch(u, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
    return { status: res.status, corpo: await res.json().catch(() => null) };
  }, [`${BASE}/api/store-settings`, corpo]);
  const mudar = (fn) => boas.map((z, i) => fn({ ...z }, i));
  r.casos.kmRepetido = await put({ deliveryZoneType: "ROTA", deliveryZones: mudar((z, i) => (i === 8 ? { ...z, km: 4.5 } : z)) });
  await dormir(300);
  r.casos.kmZero = await put({ deliveryZoneType: "ROTA", deliveryZones: mudar((z, i) => (i === 0 ? { ...z, km: 0 } : z)) });
  await dormir(300);
  r.casos.taxaNegativa = await put({ deliveryZoneType: "ROTA", deliveryZones: mudar((z, i) => (i === 1 ? { ...z, fee: -3 } : z)) });
  await dormir(300);
  r.casos.tempoZero = await put({ deliveryZoneType: "ROTA", deliveryZones: mudar((z, i) => (i === 2 ? { ...z, time: 0 } : z)) });
  await dormir(300);
  r.casos.repasseFaltandoNumaFaixa = await put({ deliveryZoneType: "ROTA", deliveryZones: mudar((z, i) => { if (i === 3) delete z.motoboyFee; return z; }) });
  await dormir(300);
  r.casos.repasseMaiorQueTaxaSemConfirmar = await put({ deliveryZoneType: "ROTA", deliveryZones: mudar((z, i) => (i === 4 ? { ...z, motoboyFee: 40 } : z)) });
  const depois = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true, deliveryZoneType: true } });
  r.cadastroIntacto = JSON.stringify(depois.deliveryZones) === JSON.stringify(boas) && depois.deliveryZoneType === "ROTA";
  if (!r.cadastroIntacto) {
    r.cadastroDepois = depois;
    // devolve o cadastro do E1
    await prisma.user.update({ where: { email: EMAIL }, data: { deliveryZones: boas, deliveryZoneType: "ROTA" } });
    r.restaurado = true;
  }
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
} finally {
  gravarResultado("e1c", r);
  console.log(JSON.stringify(r, null, 2));
  await b.close();
  await prisma.$disconnect();
}
