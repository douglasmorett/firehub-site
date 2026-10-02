/**
 * A busca de clientes no balcão (lib/busca-de-clientes.ts).
 *
 *   npx tsx scripts/teste-busca-de-clientes.ts
 *
 * O exemplo do Gama que o Douglas mostrou (02/10/2026): digitou "2299215" e
 * a lista ofereceu "Flavio Teixeira - (22) 9 9276-1161" e os outros com o
 * número parecido, para clicar e copiar.
 */
import {
  digitosNacionais,
  lerConsulta,
  nomeCasa,
  preencherBalcao,
  sugerirClientes,
  telefoneBonito,
  telefoneCasa,
} from "../src/lib/busca-de-clientes";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

console.log("\n— O que o atendente digitou —");
confere("dígitos: busca por telefone", lerConsulta("2299"), { digitos: "2299", nome: "" });
confere("com máscara no meio", lerConsulta("(22) 992"), { digitos: "22992", nome: "" });
confere("número inteiro com o 55 do país", lerConsulta("5522992761161"), { digitos: "22992761161", nome: "" });
confere("prefixo curto começando por 55 fica (é DDD também)", lerConsulta("55 22 99276"), { digitos: "552299276", nome: "" });
confere("dois dígitos ainda não", lerConsulta("22"), null);
confere("letras: busca por nome", lerConsulta("Fla"), { digitos: "", nome: "Fla" });
confere("uma letra ainda não", lerConsulta("F"), null);
confere("misturado não busca", lerConsulta("Fl22"), null);
confere("vazio", lerConsulta("  "), null);

console.log("\n— Telefone nacional e bonito —");
confere("site com máscara", digitosNacionais("(22) 99276-1161"), "22992761161");
confere("WhatsApp com 55", digitosNacionais("5522992761161"), "22992761161");
confere("0800 do iFood não é de ninguém", digitosNacionais("08002853233"), "");
confere("00000000000 do balcão sem telefone", digitosNacionais("00000000000"), "00000000000");
confere("bonito celular", telefoneBonito("22992761161"), "(22) 99276-1161");
confere("bonito fixo", telefoneBonito("2227641161"), "(22) 2764-1161");

console.log("\n— O prefixo casa —");
confere("desde o DDD", telefoneCasa("22992761161", "2299"), true);
confere("só o número, sem DDD", telefoneCasa("22992761161", "99276"), true);
confere("sem o 9 da frente", telefoneCasa("22992761161", "9276"), true);
confere("prefixo de outro número", telefoneCasa("22992761161", "2198"), false);
confere("nome sem acento e sem caixa", nomeCasa("Célia Maria Portugal", "celia"), true);
confere("nome que não contém", nomeCasa("Célia Maria", "flavio"), false);

console.log("\n— As sugestões —");
const dia = (n: number) => new Date(Date.UTC(2026, 8, n, 20, 0, 0));
const pedidos = [
  { customerName: "Flavio Teixeira", customerPhone: "(22) 99276-1161", customerAddress: "Rua das Casuarinas, 20 - Âncora (Ap 201)", deliveryType: "DELIVERY", createdAt: dia(30) },
  { customerName: "Flavio", customerPhone: "5522992761161", customerAddress: "Rua Antiga, 1 - Centro", deliveryType: "DELIVERY", createdAt: dia(10) },
  { customerName: "Jessica Teixeira", customerPhone: "22992150443", customerAddress: null, deliveryType: "RETIRADA", createdAt: dia(29) },
  { customerName: "Cliente", customerPhone: "22992150443", customerAddress: "quadra 05", deliveryType: "DELIVERY", createdAt: dia(28) },
  { customerName: "Balcão", customerPhone: "00000000000", customerAddress: "Balcão", deliveryType: "RETIRADA", createdAt: dia(30) },
  { customerName: "Pedido iFood", customerPhone: "08002853233", customerAddress: "R. X, 1 - Comp: a - Centro - Rio", deliveryType: "DELIVERY", createdAt: dia(30) },
  { customerName: "Celia Maria Portugal", customerPhone: "21998756470", customerAddress: "Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ, portão branco", deliveryType: "DELIVERY", createdAt: dia(20) },
];
const cadastros = [
  { name: "Flavio do Gama", phone: "5522992761161", address: null }, // já tem pedido: o nome do pedido vale
  { name: "Daniel Importado", phone: "5522992640361", address: null }, // só o cadastro
  { name: "R", phone: "5522999514634", address: null }, // nome de uma letra: sem nome
];

const porPrefixo = sugerirClientes({ digitos: "2299", nome: "" }, pedidos, cadastros);
confere(
  "quem pediu mais recente primeiro; cadastro sem pedido no fim",
  porPrefixo.map((c) => [c.nome, c.telefoneBonito, c.pedidos]),
  [["Flavio Teixeira", "(22) 99276-1161", 2], ["Jessica Teixeira", "(22) 99215-0443", 2], ["Daniel Importado", "(22) 99264-0361", 0], ["", "(22) 99951-4634", 0]],
);
confere("o endereço é o da entrega mais recente, separado", porPrefixo[0].endereco?.texto, "Rua das Casuarinas, 20 - Âncora · Ap 201");
confere("'Cliente' não vira nome; o nome do outro pedido vale", porPrefixo[1].nome, "Jessica Teixeira");
confere("texto que não separa fica como veio", [porPrefixo[1].endereco, porPrefixo[1].enderecoTexto], [null, "quadra 05"]);
confere("balcão sem telefone e 0800 do iFood não aparecem", porPrefixo.some((c) => c.telefone.startsWith("0")), false);
confere("prefixo de outro DDD", sugerirClientes({ digitos: "2199", nome: "" }, pedidos, cadastros).map((c) => c.nome), ["Celia Maria Portugal"]);
confere("sem DDD acha o mesmo", sugerirClientes({ digitos: "99276", nome: "" }, pedidos, cadastros).map((c) => c.nome), ["Flavio Teixeira"]);
confere("por nome, sem acento", sugerirClientes({ digitos: "", nome: "celia" }, pedidos, cadastros).map((c) => c.nome), ["Celia Maria Portugal"]);
confere("por nome: 'teixeira' acha os dois", sugerirClientes({ digitos: "", nome: "Teixeira" }, pedidos, cadastros).map((c) => c.nome), ["Flavio Teixeira", "Jessica Teixeira"]);
confere("nada casa", sugerirClientes({ digitos: "777", nome: "" }, pedidos, cadastros), []);

console.log("\n— No máximo 8 —");
const muitos = Array.from({ length: 12 }, (_, i) => ({ customerName: `Cliente ${i}`, customerPhone: `229900000${String(i).padStart(2, "0")}`, customerAddress: null, deliveryType: "RETIRADA", createdAt: dia(1 + i) }));
confere("12 parecidos viram 8", sugerirClientes({ digitos: "2299", nome: "" }, muitos, []).length, 8);

console.log("\n— O clique preenche o balcão —");
const flavio = porPrefixo[0];
confere(
  "loja por bairros com o bairro na lista: rua e número no texto, bairro no select",
  preencherBalcao(flavio, [{ name: "Centro" }, { name: "Âncora" }]),
  { nome: "Flavio Teixeira", telefone: "(22) 99276-1161", endereco: "Rua das Casuarinas, 20 (Ap 201)", bairro: "Âncora" },
);
confere(
  "loja por bairros com o bairro fora da lista: fica no texto para o atendente escolher",
  preencherBalcao(flavio, [{ name: "Centro" }]),
  { nome: "Flavio Teixeira", telefone: "(22) 99276-1161", endereco: "Rua das Casuarinas, 20 (Ap 201) - Âncora", bairro: "" },
);
confere(
  "loja por km: tudo no texto",
  preencherBalcao(flavio, []),
  { nome: "Flavio Teixeira", telefone: "(22) 99276-1161", endereco: "Rua das Casuarinas, 20 (Ap 201) - Âncora", bairro: "" },
);
confere(
  "endereço que não separou vai inteiro",
  preencherBalcao(porPrefixo[1], [{ name: "Centro" }]),
  { nome: "Jessica Teixeira", telefone: "(22) 99215-0443", endereco: "quadra 05", bairro: "" },
);
confere(
  "cadastro sem endereço",
  preencherBalcao(porPrefixo[2], []),
  { nome: "Daniel Importado", telefone: "(22) 99264-0361", endereco: "", bairro: "" },
);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
