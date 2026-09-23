/**
 * Trava o casamento "opção do pedido → complemento do cadastro"
 * (lib/complemento-da-opcao.ts), que faz o relatório contar a borda que vem
 * DENTRO da pizza.
 *
 *   npx tsx scripts/teste-complemento-da-opcao.ts
 *
 * Os nomes são os da NIK Esfihas e Pizzas, medidos em 23/09/2026 nos pedidos
 * dos últimos 60 dias — o cadastro de um lado, cada canal do outro.
 */
import { complementosDaOpcao, montarMapaDeComplementos } from "../src/lib/complemento-da-opcao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// O cadastro da NIK: as seis bordas (todas complemento, preço 0), com o
// "Chesse" escrito errado como está lá. Mais dois adicionais e um sabor de
// meia pizza, para provar que a regra não é só de borda.
const MAPA = montarMapaDeComplementos([
  { id: "b1", nome: "Borda de Catupiry", categoria: "Bordas", custo: 2 },
  { id: "b2", nome: "Borda de Cheddar", categoria: "Bordas", custo: 2 },
  { id: "b3", nome: "Borda de Chocolate", categoria: "Bordas", custo: 3 },
  { id: "b4", nome: "Borda de Cream Chesse", categoria: "Bordas", custo: 3 },
  { id: "b5", nome: "Borda de Doce de Leite", categoria: "Bordas", custo: 3 },
  { id: "b6", nome: "Borda tradicional", categoria: "Bordas", custo: 0 },
  { id: "a1", nome: "Bacon", categoria: "Adicionais", custo: 1 },
  { id: "a2", nome: "Catupiry Extra", categoria: "Adicionais", custo: 1 },
  { id: "s1", nome: "Calabresa", categoria: "Sabores de Pizza", custo: 5 },
]);

const ids = (nome: string) => complementosDaOpcao(nome, MAPA).map((c) => `${c.id ?? "?"}:${c.categoria}`);

console.log("\n1) Balcão e site: o nome do cadastro, igual");
confere("Borda de Catupiry", ids("Borda de Catupiry"), ["b1:Bordas"]);
confere("Borda de Doce de Leite", ids("Borda de Doce de Leite"), ["b5:Bordas"]);
confere("caixa e acento não importam", ids("BORDA DE CHOCOLATE"), ["b3:Bordas"]);

console.log("\n2) iFood: massa e borda numa opção só, partida no '+'");
confere("Massa Tradicional + Borda Catupiry", ids("Massa Tradicional + Borda Catupiry"), ["b1:Bordas"]);
confere("Massa Tradicional + Borda Tradicional (a massa não vira borda)", ids("Massa Tradicional + Borda Tradicional"), ["b6:Bordas"]);
confere("Massa Tradicional + Borda Chocolate", ids("Massa Tradicional + Borda Chocolate"), ["b3:Bordas"]);
confere("Massa Tradicional + Borda Doce de Leite", ids("Massa Tradicional + Borda Doce de Leite"), ["b5:Bordas"]);
// O cadastro diz "Chesse": nenhum nome casa, mas toda borda começa com "borda".
confere("Cream Cheese × Chesse do cadastro: conta em Bordas, sem produto", ids("Massa Tradicional + Borda Cream Cheese"), ["?:Bordas"]);

console.log("\n3) Wabiz: palavra a mais no fim");
confere("Borda Catupiry Original", ids("Borda Catupiry Original"), ["b1:Bordas"]);
confere("Borda Chocolate", ids("Borda Chocolate"), ["b3:Bordas"]);

console.log("\n4) O que NÃO pode virar complemento");
confere("Sem borda", ids("Sem borda"), []);
confere("Massa Tradicional sozinha", ids("Massa Tradicional"), []);
confere("sabor de esfiha dentro do combo (produto vendável, não está no mapa)", ids("Esfiha Calabresa"), []);
confere("bebida do combo", ids("Guaraná Mineiro 1,5l"), []);
confere("'Pizza Bacon' não é o adicional Bacon", ids("Pizza Bacon"), []);
confere("nome vazio", ids(""), []);

console.log("\n5) Adicional e meia pizza, pelo mesmo caminho");
confere("Bacon", ids("Bacon"), ["a1:Adicionais"]);
confere("Adicional Catupiry Extra", ids("Adicional Catupiry Extra"), ["a2:Adicionais"]);
confere("1/2 Calabresa (fração sai do nome)", ids("1/2 Calabresa"), ["s1:Sabores de Pizza"]);
confere("duas coisas numa opção: borda + adicional", ids("Borda de Cheddar + Bacon"), ["b2:Bordas", "a1:Adicionais"]);

console.log("\n6) Empate");
const EMPATE = montarMapaDeComplementos([
  { id: "x1", nome: "Borda Catupiry", categoria: "Bordas", custo: 0 },
  { id: "x2", nome: "Catupiry Borda", categoria: "Adicionais", custo: 0 },
  { id: "x3", nome: "Borda Cheddar", categoria: "Bordas", custo: 0 },
]);
confere("mesmas palavras em categorias diferentes: não conta",
  complementosDaOpcao("Borda Catupiry Especial", EMPATE).map((c) => c.categoria), []);
const MESMA = montarMapaDeComplementos([
  { id: "y1", nome: "Borda Catupiry", categoria: "Bordas", custo: 0 },
  { id: "y2", nome: "Borda Cheddar", categoria: "Bordas", custo: 0 },
]);
confere("empate na MESMA categoria: conta na categoria, sem produto",
  complementosDaOpcao("Borda Catupiry Cheddar", MESMA).map((c) => `${c.id ?? "?"}:${c.categoria}`), ["?:Bordas"]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
