/**
 * O Bill na taxa de entrega por bairro (lib/assessor/entrega.ts), pelas
 * ferramentas de verdade (executarFerramentaDoAssessor) e com o banco trocado
 * por um falso em memória:
 *   - altera com acento/caixa diferentes e com "R$ 13", "13,50" e 0 (grátis),
 *     sem mexer no resto do bairro (mínimo, apelidos, tempo);
 *   - nome que não existe devolve os parecidos e NÃO grava nada;
 *   - cadastra (tempo do último bairro quando não vem), recusa o repetido;
 *   - remove; o "desfaz" volta a taxa exata / o bairro que saiu / tira o novo;
 *   - bairro mexido de novo depois do Bill não se desfaz por aqui;
 *   - loja por raio, desenho ou sem área: consulta diz o método e nada grava;
 *   - o valor do motoboy segue a tela ("um valor por bairro" ligado ou não);
 *   - a resposta de reserva e a trava conhecem as ações novas.
 *
 *   npx tsx scripts/teste-bill-taxa-de-bairro.ts
 */
import assert from "node:assert/strict";
// Banco que não existe: se alguma consulta escapar do falso, falha na hora.
process.env.DATABASE_URL = "postgresql://teste@127.0.0.1:1/teste";

type Reg = { id: string; franchiseeId: string; tipo: string; resumo: string; refs: any; desfeitoEm: Date | null; criadoEm: Date };
let loja: any;
let regs: Reg[] = [];
let gravacoes = 0;
let relogio = 0;
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const BAIRROS = [
  { name: "Centro", fee: 5, time: 30 },
  { name: "Vivendas Bela Vista", fee: 10, time: 45, minimo: 40 },
  { name: "Jardim São José", fee: 7, time: 40, aliases: ["JSJ"] },
  { name: "Parque Água Branca", fee: 8, time: 50 },
];
const porBairro = (extra: any = {}) => ({ deliveryZoneType: "NEIGHBORHOOD", deliveryZones: copia(BAIRROS), deliveryConfig: {}, ...extra });
const bairro = (nome: string) => loja.deliveryZones.find((z: any) => z.name === nome);

const casa = (r: Reg, w: any) =>
  (!w.id || r.id === w.id) && (!w.franchiseeId || r.franchiseeId === w.franchiseeId) && (!("desfeitoEm" in w) || (w.desfeitoEm === null ? r.desfeitoEm === null : true));

(async () => {
  const { prisma } = await import("../src/lib/prisma");
  const falso: any = {
    user: {
      findUnique: async ({ where }: any) => (where.id === "loja" ? copia(loja) : null),
      update: async ({ where, data }: any) => {
        assert.equal(where.id, "loja");
        gravacoes++;
        Object.assign(loja, copia(data));
        return loja;
      },
    },
    assessorRegistro: {
      create: async ({ data }: any) => {
        regs.push({ id: `r${regs.length + 1}`, desfeitoEm: null, criadoEm: new Date(Date.UTC(2026, 9, 29, 12, 0, relogio++)), ...data });
        return {};
      },
      findFirst: async ({ where }: any) => [...regs].filter((r) => casa(r, where)).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())[0] ?? null,
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of regs) if (casa(r, where)) { r.desfeitoEm = data.desfeitoEm; count++; }
        return { count };
      },
    },
  };
  for (const k of Object.keys(falso)) Object.defineProperty(prisma, k, { value: falso[k], configurable: true });

  const { executarFerramentaDoAssessor: rodar, desfazerRegistroDoBill, FERRAMENTAS_QUE_GRAVAM, DECLARACOES_DO_ASSESSOR } = await import("../src/lib/assessor/ferramentas");
  const { respostaDeReserva, dizQueGravou } = await import("../src/lib/assessor/assessor");
  const ctx = { franchiseeId: "loja", usuarioId: "dono", canal: "WHATSAPP" as const, telefone: "5522999990000" };
  const desfaz = () => desfazerRegistroDoBill(ctx, null);
  const r = async (nome: string, args: any) => (await rodar(nome, args, ctx)) as any;

  // 0. As ferramentas existem para o modelo, e as que gravam passam pela trava.
  const nomes = DECLARACOES_DO_ASSESSOR.map((d) => d.name);
  for (const n of ["consultar_taxas_de_entrega", "alterar_taxa_de_bairro", "cadastrar_bairro", "remover_bairro"]) assert.ok(nomes.includes(n), n);
  for (const n of ["alterar_taxa_de_bairro", "cadastrar_bairro", "remover_bairro"]) assert.ok(FERRAMENTAS_QUE_GRAVAM.has(n), n);
  assert.ok(!FERRAMENTAS_QUE_GRAVAM.has("consultar_taxas_de_entrega"));

  // 1. Consultar: os bairros com taxa e tempo; a busca acha sem acento.
  loja = porBairro();
  let res = await r("consultar_taxas_de_entrega", {});
  assert.equal(res.ok, true);
  assert.equal(res.metodo, "por bairro");
  assert.equal(res.total, 4);
  assert.deepEqual(res.bairros[1], { bairro: "Vivendas Bela Vista", taxa: "R$ 10,00", tempo: "45 min", pedidoMinimo: "R$ 40,00" });
  res = await r("consultar_taxas_de_entrega", { busca: "sao jose" });
  assert.deepEqual(res.bairros.map((b: any) => b.bairro), ["Jardim São José"]);

  // 2. O caso real: "muda a taxa do bairro Vivendas Bela Vista para 13 reais" — caixa diferente, "R$ 13".
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "vivendas bela vista", taxa: "R$ 13" }] });
  assert.equal(res.ok, true, res.erro);
  assert.deepEqual(res.alterados, [{ bairro: "Vivendas Bela Vista", antes: "R$ 10,00", agora: "R$ 13,00" }]);
  assert.deepEqual(bairro("Vivendas Bela Vista"), { name: "Vivendas Bela Vista", fee: 13, time: 45, minimo: 40 }, "só a taxa muda");
  assert.equal(loja.deliveryZoneType, "NEIGHBORHOOD");
  assert.equal(regs.length, 1);
  assert.equal(regs[0].tipo, "ENTREGA");
  assert.equal(regs[0].resumo, "Taxa de entrega: Vivendas Bela Vista R$ 10,00 → R$ 13,00");

  // 3. Desfaz: volta a taxa exata.
  let d: any = await desfaz();
  assert.equal(d.ok, true, d.erro);
  assert.equal(bairro("Vivendas Bela Vista").fee, 10);
  assert.ok(regs[0].desfeitoEm);

  // 4. Vários numa chamada: sem acento, pelo apelido, "13,50" e grátis; o resto da lista não mexe.
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Parque Agua Branca", taxa: 0 }, { nome: "jsj", taxa: "13,50" }] });
  assert.equal(res.ok, true, res.erro);
  assert.equal(bairro("Parque Água Branca").fee, 0);
  assert.deepEqual(bairro("Jardim São José"), { name: "Jardim São José", fee: 13.5, time: 40, aliases: ["JSJ"] });
  assert.equal(bairro("Centro").fee, 5);
  assert.match(respostaDeReserva([{ nome: "alterar_taxa_de_bairro", resultado: res }]), /Parque Água Branca R\$ 8,00 → grátis; Jardim São José R\$ 7,00 → R\$ 13,50/);
  d = await desfaz();
  assert.equal(d.ok, true, d.erro);
  assert.equal(bairro("Parque Água Branca").fee, 8);
  assert.equal(bairro("Jardim São José").fee, 7);

  // 5. "de/da/do" não atrapalha: "Vivendas da Bela Vista" é o "Vivendas Bela Vista".
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Vivendas da Bela Vista", taxa: 12 }] });
  assert.equal(res.ok, true, res.erro);
  assert.equal(bairro("Vivendas Bela Vista").fee, 12);
  await desfaz();

  // 6. Nome que não existe: nada grava (nem o que foi achado na mesma chamada) e vêm os parecidos.
  let antes = gravacoes;
  const regsAntes = regs.length;
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Centro", taxa: 6 }, { nome: "Vivenda Bela Vist", taxa: 13 }] });
  assert.equal(res.ok, false);
  assert.match(res.erro, /nada foi alterado/);
  assert.equal(res.naoAchados[0].pedido, "Vivenda Bela Vist");
  assert.equal(res.naoAchados[0].parecidos[0], "Vivendas Bela Vista");
  assert.equal(gravacoes, antes);
  assert.equal(regs.length, regsAntes);
  assert.equal(bairro("Centro").fee, 5);
  res = await r("remover_bairro", { nome: "Bela" });
  assert.equal(res.ok, false);
  assert.deepEqual(res.parecidos, ["Vivendas Bela Vista"]);
  assert.equal(gravacoes, antes);

  // 7. Mesma taxa: não grava nem registra.
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "centro", taxa: 5 }] });
  assert.equal(res.ok, true);
  assert.deepEqual(res.alterados, []);
  assert.equal(gravacoes, antes);

  // 8. Cadastrar: sem tempo vale o do último bairro (como o "Adicionar bairro" da tela); com tempo, o dito.
  res = await r("cadastrar_bairro", { nome: "Morada do Sol", taxa: 9 });
  assert.equal(res.ok, true, res.erro);
  assert.deepEqual(loja.deliveryZones.at(-1), { name: "Morada do Sol", time: 50, fee: 9 });
  assert.match(respostaDeReserva([{ nome: "cadastrar_bairro", resultado: res }]), /Bairro novo na entrega: Morada do Sol — R\$ 9,00, 50 min/);
  d = await desfaz();
  assert.equal(d.ok, true, d.erro);
  assert.equal(loja.deliveryZones.length, 4);
  res = await r("cadastrar_bairro", { nome: "Morada do Sol", taxa: "8,5", tempo: 35 });
  assert.deepEqual(loja.deliveryZones.at(-1), { name: "Morada do Sol", time: 35, fee: 8.5 });
  await desfaz();
  antes = gravacoes;
  res = await r("cadastrar_bairro", { nome: "CENTRO", taxa: 4 });
  assert.equal(res.ok, false);
  assert.match(res.erro, /já está cadastrado/);
  assert.equal(gravacoes, antes);

  // 9. Remover e desfazer: o bairro volta inteiro, no mesmo lugar.
  res = await r("remover_bairro", { nome: "vivendas bela vista" });
  assert.equal(res.ok, true, res.erro);
  assert.equal(loja.deliveryZones.length, 3);
  assert.ok(!bairro("Vivendas Bela Vista"));
  assert.match(respostaDeReserva([{ nome: "remover_bairro", resultado: res }]), /Bairro removido da entrega: Vivendas Bela Vista/);
  d = await desfaz();
  assert.equal(d.ok, true, d.erro);
  assert.deepEqual(loja.deliveryZones, BAIRROS);

  // 10. O bairro mudou de novo no painel depois do Bill: não desfaz, e a marca sai.
  await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Centro", taxa: 6 }] });
  bairro("Centro").fee = 7; // a loja mudou pela tela
  d = await desfaz();
  assert.equal(d.ok, false);
  assert.match(d.erro, /mudada de novo/);
  assert.equal(regs.at(-1)!.desfeitoEm, null);
  assert.equal(bairro("Centro").fee, 7);
  regs = [];

  // 11. A validação é a da tela: taxa negativa ou sem vírgula (R$ 1.300) não grava.
  antes = gravacoes;
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Centro", taxa: -2 }] });
  assert.equal(res.ok, false);
  assert.match(res.erro, /negativa/);
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Centro", taxa: 1300 }] });
  assert.equal(res.ok, false);
  assert.match(res.erro, /vírgula/);
  assert.equal(gravacoes, antes);
  loja = porBairro({ deliveryZones: [{ name: "Centro", fee: 5, time: 30 }] });
  res = await r("remover_bairro", { nome: "Centro" });
  assert.equal(res.ok, false, "o último bairro não sai");
  assert.match(res.erro, /pelo menos um bairro/);

  // 12. "Um valor por bairro" ligado: motoboy acima da taxa pede confirmação; bairro novo pede o valor do motoboy.
  loja = porBairro({
    deliveryConfig: { repasseDoEntregador: { separado: true } },
    deliveryZones: [{ name: "Centro", fee: 5, time: 30, motoboyFee: 4 }, { name: "Vivendas Bela Vista", fee: 10, time: 45, motoboyFee: 8 }],
  });
  antes = gravacoes;
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Centro", taxa: 0 }] });
  assert.equal(res.ok, false);
  assert.match(res.erro, /motoboy recebe R\$ 4,00/);
  assert.equal(gravacoes, antes);
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Centro", taxa: 0 }], confirmarMotoboyAcimaDaTaxa: true });
  assert.equal(res.ok, true, res.erro);
  assert.deepEqual(bairro("Centro"), { name: "Centro", time: 30, fee: 0, motoboyFee: 4, repasseAcimaDaTaxa: true });
  res = await r("cadastrar_bairro", { nome: "Morada do Sol", taxa: 9 });
  assert.equal(res.ok, false);
  assert.match(res.erro, /falta quanto o motoboy recebe/);
  res = await r("cadastrar_bairro", { nome: "Morada do Sol", taxa: 9, motoboyRecebe: 7 });
  assert.equal(res.ok, true, res.erro);
  assert.equal(bairro("Morada do Sol").motoboyFee, 7);
  regs = [];

  // 13. Desligado, o valor do motoboy não vai (como na tela) e não trava a taxa.
  loja = porBairro({ deliveryZones: [{ name: "Centro", fee: 5, time: 30, motoboyFee: 9 }] });
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Centro", taxa: 3 }] });
  assert.equal(res.ok, true, res.erro);
  assert.deepEqual(bairro("Centro"), { name: "Centro", time: 30, fee: 3 });
  regs = [];

  // 14. Cadastro antigo sem tipo (lista só de nomes): é bairro para o motor e grava como a tela grava.
  loja = { deliveryZoneType: null, deliveryZones: copia(BAIRROS), deliveryConfig: null };
  res = await r("alterar_taxa_de_bairro", { bairros: [{ nome: "Centro", taxa: 6 }] });
  assert.equal(res.ok, true, res.erro);
  assert.equal(loja.deliveryZoneType, "NEIGHBORHOOD");
  regs = [];

  // 15. Loja que não é por bairro: a consulta diz o método; alterar/cadastrar/remover não gravam.
  const outras = [
    { loja: { deliveryZoneType: "KM", deliveryZones: [{ km: 3, fee: 8, time: 45 }, { km: 1, fee: 5, time: 30 }], deliveryConfig: {} }, metodo: /raio em km/ },
    { loja: { deliveryZoneType: "ROTA", deliveryZones: [{ km: 2, fee: 6, time: 30 }], deliveryConfig: {} }, metodo: /pela rua/ },
    { loja: { deliveryZoneType: "POLIGONO", deliveryZones: [{ nome: "Zona 1", pontos: [[0, 0], [0, 1], [1, 1]], fee: 7, time: 40 }], deliveryConfig: {} }, metodo: /desenhada/ },
    { loja: { deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [], deliveryConfig: {} }, metodo: /sem área/ },
  ];
  for (const o of outras) {
    loja = copia(o.loja);
    antes = gravacoes;
    res = await r("consultar_taxas_de_entrega", {});
    assert.equal(res.ok, true);
    assert.match(res.metodo, o.metodo);
    assert.match(res.observacao, /só muda a taxa de loja que cobra por bairro/);
    for (const [nome, args] of [
      ["alterar_taxa_de_bairro", { bairros: [{ nome: "Centro", taxa: 9 }] }],
      ["cadastrar_bairro", { nome: "Centro", taxa: 9 }],
      ["remover_bairro", { nome: "Centro" }],
    ] as const) {
      res = await r(nome, args);
      assert.equal(res.ok, false, `${nome} em ${o.loja.deliveryZoneType}`);
      assert.match(res.erro, /não por bairro/);
    }
    assert.equal(gravacoes, antes);
    assert.deepEqual(loja, o.loja);
  }
  loja = copia(outras[0].loja);
  res = await r("consultar_taxas_de_entrega", {});
  assert.deepEqual(res.faixas, [{ ate: "1 km", taxa: "R$ 5,00" }, { ate: "3 km", taxa: "R$ 8,00" }]);
  assert.equal(regs.length, 0);

  // 16. A trava: dizer que alterou/cadastrou/removeu conta como ação; negar, não.
  for (const t of ["Alterei a taxa do Centro para R$ 8,00", "Cadastrei o bairro Morada do Sol", "Removi o Centro da entrega", "Mudei a taxa"]) assert.equal(dizQueGravou(t), true, t);
  for (const t of ["Não alterei nada: não achei esse bairro.", "Não cadastrei o bairro ainda."]) assert.equal(dizQueGravou(t), false, t);

  console.log("teste-bill-taxa-de-bairro: ok");
})().catch((e) => { console.error(e); process.exitCode = 1; });
