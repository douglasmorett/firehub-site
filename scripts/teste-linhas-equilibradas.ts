/**
 * Os atalhos da barra da tela de Pedidos em linhas iguais
 * (lib/linhas-equilibradas.ts): nunca um botão sozinho na última linha.
 *
 *   npx tsx scripts/teste-linhas-equilibradas.ts
 */
import { distribuirEmLinhas } from "../src/lib/linhas-equilibradas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// Larguras medidas na prévia (Painel clean, Resumo, Alta Demanda, Agendamentos,
// Balcão, Mesas, Alertas, Roteirização, App Motoboys, Mudar tempo de entrega).
const barra = [216, 148, 131, 163, 138, 85, 169, 121, 134, 195];
const VAO = 6;
const natural = barra.reduce((s, w) => s + w, 0) + (barra.length - 1) * VAO;

/** O que o navegador faz: enche a linha com max(botão, base) até não caber. */
function linhasDoNavegador(larguras: number[], disponivel: number, base: number): number[] {
  const out: number[] = [];
  let usado = -1, naLinha = 0;
  for (const w of larguras) {
    const t = Math.max(w, base);
    const cabe = naLinha === 0 || usado + VAO + t <= disponivel;
    if (cabe) { usado = naLinha === 0 ? t : usado + VAO + t; naLinha++; }
    else { out.push(naLinha); usado = t; naLinha = 1; }
  }
  if (naLinha) out.push(naLinha);
  return out;
}
const linhas = (disp: number, l = barra) => {
  const d = distribuirEmLinhas(l, disp, VAO);
  return d ? linhasDoNavegador(l, disp, d.base) : null;
};

confere("cabe tudo: uma linha só", linhas(natural + 10), [10]);
// Monitor de 1680 px (≈1390 de barra): o flex puro dava 9 + 1.
confere("monitor 1680: o flex puro deixaria 1 sozinho", linhasDoNavegador(barra, 1390, 0), [9, 1]);
confere("monitor 1680: fica 5 + 5", linhas(1390), [5, 5]);
confere("notebook 1366 (1063 px): 5 + 5", linhas(1063), [5, 5]);
confere("tablet 768 (≈728 px): 4/4/2", linhas(728), [4, 4, 2]);
confere("botão largo no começo: repartir gastaria mais linhas, fica o flex puro", distribuirEmLinhas([600, 100, 100, 100], 700, VAO), null);
confere("nada para arrumar", distribuirEmLinhas([], 900, VAO), null);
confere("sem largura medida: não mexe", distribuirEmLinhas([100, 100], 0, VAO), null);
confere("botão maior que a tela: não mexe (o flex puro já põe um por linha)", distribuirEmLinhas([900, 900], 500, VAO), null);
confere("loja com só 3 atalhos ligados: uma linha", linhas(1063, [216, 148, 195]), [3]);
confere("nunca usa mais linhas que o flex puro (larguras de 300 a 1900 px)", [300, 400, 500, 600, 728, 800, 900, 1063, 1200, 1390, 1500, 1560, 1700, 1900].every((d) => {
  const r = linhas(d);
  return !r || r.length <= linhasDoNavegador(barra, d, 0).length;
}), true);
confere("nunca deixa 1 sozinho quando há 3+ por linha", [728, 800, 900, 1063, 1200, 1390, 1500, 1560].every((d) => {
  const r = linhas(d);
  return !r || r.length === 1 || r[r.length - 1] > 1;
}), true);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
