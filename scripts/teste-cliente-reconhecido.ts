/**
 * O cliente reconhecido pelo telefone (lib/cliente-reconhecido.ts).
 *
 *   npx tsx scripts/teste-cliente-reconhecido.ts
 *
 * O caso da Showrrascão (02/10/2026): o cliente volta, digita o WhatsApp e o
 * cardápio oferece o nome e os endereços em que a loja já entregou para ele.
 */
import {
  enderecosDoCliente,
  lerEnderecoGravado,
  mesmoEndereco,
  nomeDoCliente,
  pontoConfirmadoPeloCliente,
  primeiroNome,
  reconhecerCliente,
  telefoneParaReconhecer,
  textoDoEndereco,
} from "../src/lib/cliente-reconhecido";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

console.log("\n— O telefone como a consulta precisa —");
confere("máscara do site", telefoneParaReconhecer("(22) 99276-1161"), "22992761161");
confere("com o 55 do WhatsApp", telefoneParaReconhecer("5522992761161"), "22992761161");
confere("fixo com DDD", telefoneParaReconhecer("22 2764-1161"), "2227641161");
confere("curto demais não identifica", telefoneParaReconhecer("99276"), "");
confere("vazio", telefoneParaReconhecer(null), "");

console.log("\n— O endereço gravado, nos moldes que a plataforma escreve —");
confere(
  "site com complemento",
  lerEnderecoGravado("Rua das Casuarinas, 20 - Âncora (Apartamento 201)"),
  { rua: "Rua das Casuarinas", numero: "20", bairro: "Âncora", complemento: "Apartamento 201", cep: "", ponto: null },
);
confere(
  "site sem complemento",
  lerEnderecoGravado("Av. Brasil, 1.234 - Centro"),
  { rua: "Av. Brasil", numero: "1.234", bairro: "Centro", complemento: "", cep: "", ponto: null },
);
confere(
  "complemento com traço dentro dos parênteses",
  lerEnderecoGravado("Rua Dez, 59 - Costazul (BL A AP 203 - Cond. Caravelas)"),
  { rua: "Rua Dez", numero: "59", bairro: "Costazul", complemento: "BL A AP 203 - Cond. Caravelas", cep: "", ponto: null },
);
confere(
  "sem número (S/N)",
  lerEnderecoGravado("Estrada do Mar, S/N - Praia"),
  { rua: "Estrada do Mar", numero: "S/N", bairro: "Praia", complemento: "", cep: "", ponto: null },
);
confere(
  "rua com vírgula no nome: a última vírgula separa o número",
  lerEnderecoGravado("Rua A, Lote 5, 12 - Centro"),
  { rua: "Rua A, Lote 5", numero: "12", bairro: "Centro", complemento: "", cep: "", ponto: null },
);
confere(
  "robô: rua, número, bairro, cidade",
  lerEnderecoGravado("Rua Paranaíba, 470, Operário, Rio das Ostras"),
  { rua: "Rua Paranaíba", numero: "470", bairro: "Operário", complemento: "", cep: "", ponto: null },
);
confere(
  "robô sem a cidade",
  lerEnderecoGravado("Rua Paranaíba, 470, Operário"),
  { rua: "Rua Paranaíba", numero: "470", bairro: "Operário", complemento: "", cep: "", ponto: null },
);
confere(
  "CEP solto no texto vira campo",
  lerEnderecoGravado("Rua Dez, 59 - Costazul CEP 28890-000"),
  { rua: "Rua Dez", numero: "59", bairro: "Costazul", complemento: "", cep: "28890-000", ponto: null },
);
confere("iFood (três partes) não é chutado", lerEnderecoGravado("R. Itaperu, 107 - Comp: casa 1 - Centro - Rio das Ostras"), null);
confere("99Food (cidade e UF) não é chutado", lerEnderecoGravado("Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ, portão branco"), null);
confere("texto solto do balcão não é chutado", lerEnderecoGravado("quadra 05"), null);
confere("sem número não é chutado", lerEnderecoGravado("Rua das Flores - Centro"), null);
confere("mesa não é endereço", lerEnderecoGravado("Mesa 4"), null);
confere("vazio", lerEnderecoGravado(""), null);

console.log("\n— O ponto: só o que o próprio cliente confirmou —");
confere("GPS vale", pontoConfirmadoPeloCliente({ lat: -22.5271, lng: -41.945, origem: "gps", medida: "rota" }), { lat: -22.5271, lng: -41.945, origem: "gps" });
confere("pino vale", pontoConfirmadoPeloCliente({ lat: -22.5271, lng: -41.945, origem: "pino" }), { lat: -22.5271, lng: -41.945, origem: "pino" });
confere("o que o mapa achou não vira ponto do cliente", pontoConfirmadoPeloCliente({ lat: -22.5271, lng: -41.945, origem: "mapa" }), null);
confere("centro do bairro não vale", pontoConfirmadoPeloCliente({ lat: -22.5271, lng: -41.945, origem: "bairro" }), null);
confere("ponto de enchimento (-23,-43) não vale", pontoConfirmadoPeloCliente({ lat: -23, lng: -43, origem: "gps" }), null);
confere("nulo", pontoConfirmadoPeloCliente(null), null);

console.log("\n— Os endereços do cliente nesta loja —");
const dia = (n: number) => new Date(Date.UTC(2026, 8, n, 20, 0, 0));
const pedidos = [
  { customerName: "Flavio Teixeira", customerPhone: "(22) 99276-1161", customerAddress: "Rua das Casuarinas, 20 - Âncora (Ap 201)", customerLatLng: { lat: -22.5271, lng: -41.945, origem: "pino", medida: "rota" }, deliveryType: "DELIVERY", createdAt: dia(30), status: "ENTREGUE", source: "ONLINE" },
  { customerName: "Flávio T.", customerPhone: "22992761161", customerAddress: "Rua das Casuarinas, 20 - Âncora", customerLatLng: { lat: -22.52, lng: -41.94, origem: "mapa" }, deliveryType: "DELIVERY", createdAt: dia(20), status: "ENTREGUE", source: "SITE" },
  { customerName: "Flavio", customerPhone: "5522992761161", customerAddress: "Rua do Trabalho, 100, Centro, Rio das Ostras", customerLatLng: null, deliveryType: "DELIVERY", createdAt: dia(10), status: "ENTREGUE", source: "WHATSAPP_IA" },
  // Retirada: conta para o nome, não tem endereço.
  { customerName: "Flavio Teixeira", customerPhone: "22992761161", customerAddress: null, customerLatLng: null, deliveryType: "RETIRADA", createdAt: dia(25), status: "ENTREGUE", source: "ONLINE" },
  // Cancelado: fora.
  { customerName: "Flavio Teixeira", customerPhone: "22992761161", customerAddress: "Rua Errada, 1 - Centro", customerLatLng: null, deliveryType: "DELIVERY", createdAt: dia(28), status: "CANCELADO", source: "ONLINE" },
  // Rascunho do robô ainda sendo montado: fora.
  { customerName: "Flavio Teixeira", customerPhone: "22992761161", customerAddress: "Rua Meia, 2 - Centro", customerLatLng: null, deliveryType: "DELIVERY", createdAt: dia(29), status: "CRIANDO_IA", source: "WHATSAPP_IA" },
  // Marketplace: o endereço veio por outro caminho.
  { customerName: "Flavio Teixeira", customerPhone: "22992761161", customerAddress: "Rua do iFood, 3 - Centro", customerLatLng: null, deliveryType: "DELIVERY", createdAt: dia(27), status: "ENTREGUE", source: "IFOOD", ifoodOrderId: "abc" },
  // Outro DDD com os mesmos 8 dígitos finais: outra pessoa.
  { customerName: "Outra Pessoa", customerPhone: "21992761161", customerAddress: "Rua de Outra Pessoa, 9 - Tijuca", customerLatLng: null, deliveryType: "DELIVERY", createdAt: dia(26), status: "ENTREGUE", source: "ONLINE" },
  // Balcão (delivery lançado pelo atendente): conta.
  { customerName: "Flavio Teixeira", customerPhone: "22992761161", customerAddress: "Rua do Balcão, 7 - Centro", customerLatLng: null, deliveryType: "DELIVERY", createdAt: dia(5), status: "ENTREGUE", source: "PRESENCIAL" },
  { customerName: "Flavio Teixeira", customerPhone: "22992761161", customerAddress: "Rua Antiga, 8 - Centro", customerLatLng: null, deliveryType: "DELIVERY", createdAt: dia(1), status: "ENTREGUE", source: "ONLINE" },
];
const enderecos = enderecosDoCliente(pedidos, "(22) 99276-1161");
confere("três no máximo, do mais recente para o mais antigo", enderecos.map((e) => e.rua), ["Rua das Casuarinas", "Rua do Trabalho", "Rua do Balcão"]);
confere("o mesmo endereço conta uma vez (duas entregas)", enderecos[0].vezes, 2);
confere("o complemento mais recente fica", enderecos[0].complemento, "Ap 201");
confere("o pino confirmado volta", enderecos[0].ponto, { lat: -22.5271, lng: -41.945, origem: "pino" });
confere("o que o mapa achou não vira ponto", enderecos[1].ponto, null);
confere("texto para a lista", enderecos[0].texto, "Rua das Casuarinas, 20 - Âncora · Ap 201");
confere("última vez é do pedido mais recente", enderecos[0].ultimaVez, dia(30).toISOString());
confere("outro DDD não entra", enderecos.some((e) => e.rua === "Rua de Outra Pessoa"), false);
confere("cancelado, rascunho e marketplace não entram", enderecos.some((e) => /Errada|Meia|iFood/.test(e.rua)), false);
confere("telefone curto: nada", enderecosDoCliente(pedidos, "9276"), []);

console.log("\n— Repetição antiga completa o que faltava —");
const comComplementoSoNoAntigo = [
  { customerName: "A", customerPhone: "22992761161", customerAddress: "Rua X, 1 - Centro", customerLatLng: null, deliveryType: "DELIVERY", createdAt: dia(20), status: "ENTREGUE", source: "ONLINE" },
  { customerName: "A", customerPhone: "22992761161", customerAddress: "Rua X, 1 - Centro (fundos)", customerLatLng: { lat: -22.5271, lng: -41.945, origem: "gps" }, deliveryType: "DELIVERY", createdAt: dia(10), status: "ENTREGUE", source: "ONLINE" },
];
const [unico] = enderecosDoCliente(comComplementoSoNoAntigo, "22992761161");
confere("complemento do pedido antigo entra quando o novo não tinha", unico.complemento, "fundos");
confere("GPS do pedido antigo entra quando o novo não tinha", unico.ponto, { lat: -22.5271, lng: -41.945, origem: "gps" });

console.log("\n— O nome —");
confere("o do pedido mais recente (retirada conta)", nomeDoCliente(pedidos, "22992761161", "Flavio do Gama"), "Flavio Teixeira");
confere("sem pedido: o do cadastro (importado do Gama)", nomeDoCliente([], "22992761161", "Flavio do Gama"), "Flavio do Gama");
confere("'Cliente' do balcão não é nome", nomeDoCliente([{ customerName: "Cliente", customerPhone: "22992761161", createdAt: dia(1), source: "PRESENCIAL", deliveryType: "RETIRADA" }], "22992761161", null), "");
confere("nada", nomeDoCliente([], "22992761161", null), "");
confere("primeiro nome", primeiroNome("Flavio Teixeira da Silva"), "Flavio");

console.log("\n— A resposta da rota —");
confere("sem nome e sem endereço: null", reconhecerCliente([], "22992761161", null), null);
confere("só o cadastro: nome e lista vazia", reconhecerCliente([], "22992761161", "Jessica Teixeira"), { nome: "Jessica Teixeira", enderecos: [] });
confere("com pedidos: nome e três endereços", (() => { const r = reconhecerCliente(pedidos, "22992761161", null); return r && [r.nome, r.enderecos.length]; })(), ["Flavio Teixeira", 3]);

console.log("\n— Comparar endereços —");
confere("acento, caixa e pontuação não separam", mesmoEndereco({ rua: "Rua das Casuarinas", numero: "20", bairro: "Âncora" }, { rua: "rua das casuarinas", numero: "20", bairro: "Ancora" }), true);
confere("número diferente separa", mesmoEndereco({ rua: "Rua X", numero: "20", bairro: "Centro" }, { rua: "Rua X", numero: "21", bairro: "Centro" }), false);
confere("vazio não casa com nada", mesmoEndereco({ rua: "", numero: "", bairro: "" }, { rua: "", numero: "", bairro: "" }), false);
confere("texto sem bairro", textoDoEndereco({ rua: "Rua X", numero: "1", bairro: "" }), "Rua X, 1");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
