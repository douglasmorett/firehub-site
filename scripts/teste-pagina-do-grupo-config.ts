/**
 * O que o dono personaliza na página das suas lojas (lib/pagina-do-grupo-config.ts).
 *
 *   npx tsx scripts/teste-pagina-do-grupo-config.ts
 */
import { aplicarConfigNasLojas, lerConfigDaPaginaDoGrupo } from "../src/lib/pagina-do-grupo-config";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const lojas = [{ id: "p17", nome: "PIZZARIA 17" }, { id: "aero", nome: "PIZZARIA 17 AEROPORTO" }];

confere("nada gravado → padrão vazio", lerConfigDaPaginaDoGrupo(null), { titulo: "", frase: "", cor: "", capaDaLoja: "", ordem: [], lojas: {} });
confere("cor inválida some (não vira CSS solto)", lerConfigDaPaginaDoGrupo({ cor: "red; background:url(x)" }).cor, "");
confere("cor válida vira minúscula", lerConfigDaPaginaDoGrupo({ cor: "#15803D" }).cor, "#15803d");
confere("título longo é cortado em 60", lerConfigDaPaginaDoGrupo({ titulo: "x".repeat(200) }).titulo.length, 60);
confere("ordem só com texto", lerConfigDaPaginaDoGrupo({ ordem: ["aero", 3, null, "p17"] }).ordem, ["aero", "p17"]);

confere("sem configuração → mesma ordem e nomes",
  aplicarConfigNasLojas(lojas, lerConfigDaPaginaDoGrupo(null)).map((l) => l.nome), ["PIZZARIA 17", "PIZZARIA 17 AEROPORTO"]);
confere("ordem e nome trocados pelo dono",
  aplicarConfigNasLojas(lojas, lerConfigDaPaginaDoGrupo({ ordem: ["aero", "p17"], lojas: { aero: { nome: "Unidade Aeroporto" } } })).map((l) => l.nome),
  ["Unidade Aeroporto", "PIZZARIA 17"]);
confere("loja oculta sai da página",
  aplicarConfigNasLojas(lojas, lerConfigDaPaginaDoGrupo({ lojas: { aero: { oculta: true } } })).map((l) => l.id), ["p17"]);
confere("todas ocultas → mostra todas (link nunca fica vazio)",
  aplicarConfigNasLojas(lojas, lerConfigDaPaginaDoGrupo({ lojas: { aero: { oculta: true }, p17: { oculta: true } } })).map((l) => l.id), ["p17", "aero"]);
confere("loja nova que não está na ordem entra no fim",
  aplicarConfigNasLojas([...lojas, { id: "nova", nome: "NOVA" }], lerConfigDaPaginaDoGrupo({ ordem: ["aero", "p17"] })).map((l) => l.id), ["aero", "p17", "nova"]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
