/**
 * Prova de que o robô só afirma o que a LOJA cadastrou (lib/fatos-da-loja.ts).
 *
 *   node scripts/teste-fatos-da-loja.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/fatos-da-loja.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  minimoDeEntrega, minimoDeRetirada, linhasDoMinimoNosDados, regraDoPedidoMinimo,
  lembreteDoMinimo, tempoDaZona, prazoParaORobo, HORARIO_NAO_CADASTRADO, linhaDoHorarioDeHoje,
} = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

// Nada que saia daqui pode carregar o número de OUTRA loja nem código cru.
const LIXO = [/\$\{/, /esfirra/i, /26,00/, /18:00/, /23:30/, /45 a 60/, /undefined|NaN|null/];
const semLixo = (texto) => LIXO.every((re) => !re.test(texto));

console.log("\n1) Pedido mínimo: o que está no cadastro, e zero quando não há");
conferir("número", minimoDeEntrega({ minimumOrderValue: 29.9 }) === 29.9);
conferir("texto com ponto", minimoDeEntrega({ minimumOrderValue: "19.90" }) === 19.9);
conferir("texto com vírgula", minimoDeEntrega({ minimumOrderValue: "26,50" }) === 26.5);
conferir("ausente = 0 (era 26)", minimoDeEntrega({}) === 0);
conferir("sem config = 0", minimoDeEntrega(null) === 0 && minimoDeEntrega(undefined) === 0);
conferir("vazio = 0", minimoDeEntrega({ minimumOrderValue: "" }) === 0);
conferir("lixo = 0", minimoDeEntrega({ minimumOrderValue: "abc" }) === 0);
conferir("negativo = 0", minimoDeEntrega({ minimumOrderValue: -5 }) === 0);

console.log("\n2) Mínimo da retirada: ausente herda, zero explícito vale");
conferir("ausente herda o da entrega", minimoDeRetirada({ minimumOrderValue: 26 }) === 26);
conferir("vazio herda", minimoDeRetirada({ minimumOrderValue: 26, minimumOrderValuePickup: "" }) === 26);
conferir("null herda", minimoDeRetirada({ minimumOrderValue: 26, minimumOrderValuePickup: null }) === 26);
conferir("zero explícito = sem mínimo", minimoDeRetirada({ minimumOrderValue: 29.9, minimumOrderValuePickup: 0 }) === 0);
conferir("zero em texto", minimoDeRetirada({ minimumOrderValue: 29.9, minimumOrderValuePickup: "0" }) === 0);
conferir("próprio", minimoDeRetirada({ minimumOrderValue: 29.9, minimumOrderValuePickup: 10 }) === 10);
conferir("sem nada = 0", minimoDeRetirada({}) === 0);

console.log("\n3) Regra do mínimo no prompt — loja COM mínimo");
for (const min of [18, 19.9, 26, 29.9, 35, 5]) {
  const t = regraDoPedidoMinimo({ minimoEntrega: min, minimoRetirada: 0, aceitaRetirada: true });
  const br = min.toFixed(2).replace(".", ",");
  conferir(`mín ${br}: cita o mínimo real`, t.includes(`R$ ${br} de SUBTOTAL`) && t.includes(`é ${br} reais`), t);
  conferir(`mín ${br}: sem resto de outra loja nem código cru`, min === 26 ? semLixo(t.replaceAll("26,00", "")) : semLixo(t), t);
  // O exemplo tem que fechar a conta: ficou + faltam = mínimo.
  const m = t.match(/Ficou (\d+,\d{2}) reais[\s\S]*?Faltam (\d+,\d{2}) reais/);
  const n = (s) => Number(s.replace(",", "."));
  conferir(`mín ${br}: exemplo fecha a conta`, !!m && Math.abs(n(m[1]) + n(m[2]) - min) < 0.005 && n(m[1]) > 0 && n(m[2]) > 0, m && [m[1], m[2]]);
}
{
  const t = regraDoPedidoMinimo({ minimoEntrega: 26, minimoRetirada: 0, aceitaRetirada: true });
  conferir("retirada sem mínimo: oferece como saída", /ofereça a RETIRADA NO BALCÃO — retirada não tem pedido mínimo/.test(t), t);
  const t2 = regraDoPedidoMinimo({ minimoEntrega: 26, minimoRetirada: 10, aceitaRetirada: true });
  conferir("retirada com mínimo menor: oferece e diz o valor", /na retirada o mínimo é R\$ 10,00/.test(t2), t2);
  const t3 = regraDoPedidoMinimo({ minimoEntrega: 26, minimoRetirada: 26, aceitaRetirada: true });
  conferir("retirada com o MESMO mínimo: não é saída", /MESMO mínimo/.test(t3) && !/ofereça a RETIRADA/.test(t3), t3);
  const t4 = regraDoPedidoMinimo({ minimoEntrega: 26, minimoRetirada: 0, aceitaRetirada: false });
  conferir("loja só delivery: não oferece retirada", /NÃO aceita retirada/.test(t4) && !/ofereça a RETIRADA/.test(t4), t4);
}

console.log("\n4) Regra do mínimo no prompt — loja SEM mínimo");
{
  const t = regraDoPedidoMinimo({ minimoEntrega: 0, minimoRetirada: 0, aceitaRetirada: true });
  conferir("diz que não há", /NÃO tem pedido mínimo/.test(t), t);
  conferir("não cita valor nenhum", !/R\$/.test(t) && semLixo(t), t);
  conferir("começa como item A", /^\s+A\) PEDIDO MÍNIMO/.test(t));
  const t2 = regraDoPedidoMinimo({ minimoEntrega: 0, minimoRetirada: 15, aceitaRetirada: true });
  conferir("só a retirada tem mínimo", /Só a RETIRADA[\s\S]*R\$ 15,00/.test(t2), t2);
  const t3 = regraDoPedidoMinimo({ minimoEntrega: 0, minimoRetirada: 15, aceitaRetirada: false });
  conferir("sem retirada, o mínimo dela não aparece", !/15,00/.test(t3), t3);
}

console.log("\n5) Linhas de DADOS DA LOJA");
{
  const a = linhasDoMinimoNosDados({ minimoEntrega: 29.9, minimoRetirada: 0, aceitaRetirada: true });
  conferir("com mínimo", a.includes("R$ 29,90") && a.includes("RETIRADA NO BALCÃO: não há"), a);
  const b = linhasDoMinimoNosDados({ minimoEntrega: 0, minimoRetirada: 0, aceitaRetirada: true });
  conferir("sem mínimo: NÃO HÁ, sem R$", b.includes("NÃO HÁ") && !/R\$/.test(b), b);
  const c = linhasDoMinimoNosDados({ minimoEntrega: 20, minimoRetirada: 0, aceitaRetirada: false });
  conferir("sem retirada: uma linha só", !/RETIRADA/.test(c) && c.split("\n").length === 1, c);
  conferir("lembrete com mínimo", lembreteDoMinimo(19.9).includes("19,90"));
  conferir("lembrete sem mínimo = vazio", lembreteDoMinimo(0) === "");
}

console.log("\n6) Prazo de entrega: só o que a loja cadastrou");
{
  const p = prazoParaORobo([{ name: "Centro", fee: 5, time: 30 }, { name: "Longe", fee: 9, time: "50" }, { name: "Sem", fee: 3 }]);
  conferir("faixa do menor ao maior", p.temDado && p.menorMin === 30 && p.maiorMin === 50 && p.faixa === "de 30 a 50 minutos", p);
  conferir("regra cita a faixa", p.regra.includes("de 30 a 50 minutos") && semLixo(p.regra), p.regra);
  conferir("linha dos dados cita a faixa", p.linhaDosDados.includes("de 30 a 50 minutos") && semLixo(p.linhaDosDados));

  const um = prazoParaORobo([{ time: 40 }, { time: 40 }]);
  conferir("um tempo só = 'cerca de'", um.faixa === "cerca de 40 minutos" && !/conforme a região/.test(um.regra), um);

  for (const [nome, z] of [["sem zonas", []], ["null", null], ["zonas sem tempo", [{ name: "A", fee: 5 }]], ["tempo zero", [{ time: 0 }]], ["tempo absurdo", [{ time: 9999 }]], ["tempo lixo", [{ time: "abc" }]]]) {
    const s = prazoParaORobo(z);
    conferir(`${nome}: não promete minutos`, !s.temDado && s.faixa === "" && /NÃO/.test(s.regra) && !/\d+ minutos/.test(s.regra + s.linhaDosDados) && semLixo(s.regra + s.linhaDosDados), s);
  }

  conferir("tempo ao lado da zona", tempoDaZona({ time: 35 }) === " · ~35 min");
  conferir("zona sem tempo = nada", tempoDaZona({ fee: 5 }) === "" && tempoDaZona(null) === "" && tempoDaZona({ time: "x" }) === "");
}

console.log("\n7) Horário: quem não cadastrou não 'abre das 18:00 às 23:30'");
{
  conferir("constante sem horário inventado", semLixo(HORARIO_NAO_CADASTRADO) && /NÃO CADASTRADO/.test(HORARIO_NAO_CADASTRADO));
  conferir("com frase de hoje, vale ela", linhaDoHorarioDeHoje({ fraseDeHoje: "Hoje (Sexta) a loja funciona das 11:00 às 15:00.", temQuadro: true }) === "Hoje (Sexta) a loja funciona das 11:00 às 15:00.");
  conferir("com quadro e sem frase, aponta o quadro", /Quadro Geral/.test(linhaDoHorarioDeHoje({ fraseDeHoje: "", temQuadro: true })));
  conferir("sem nada, não afirma", linhaDoHorarioDeHoje({ fraseDeHoje: "", temQuadro: false }) === HORARIO_NAO_CADASTRADO);
}

console.log(falhas === 0 ? "\nTUDO CERTO\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
