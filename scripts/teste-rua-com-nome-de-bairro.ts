/**
 * Rua com o nome de um bairro cadastrado não é o bairro (lib/area-de-entrega.ts,
 * bairroNoEndereco — a decisão da taxa do robô, do site e da gravação).
 *
 *   npx tsx scripts/teste-rua-com-nome-de-bairro.ts
 *
 * Caso da Charlie Brown Pizzas (Poços de Caldas, 15/11/2026): o cliente
 * escreveu "Av. João Pinheiro, 2835"; a loja tem o bairro "Joao Pinheiro"
 * (R$ 8). O nome do bairro era procurado no texto inteiro, a rua casava, e o
 * robô cotou R$ 8 sem perguntar o bairro — o certo era R$ 4.
 */
export {};

process.env.DATABASE_URL ||= "postgresql://teste@localhost:1/nao-usado";

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

(async () => {
  const { avaliarEntrega, bairroNoEndereco } = await import("../src/lib/area-de-entrega");
  const { partesDoEnderecoDigitado, avaliarEntregaDoRobo } = await import("../src/lib/entrega-do-robo");

  const loja: any = {
    id: "",
    city: "Poços de Caldas",
    deliveryZoneType: "NEIGHBORHOOD",
    deliveryConfig: {},
    deliveryZones: [
      { name: "Joao Pinheiro", fee: 8, time: 40 },
      { name: "Country Club", fee: 4, time: 40, aliases: ["Ville de France"] },
      { name: "Praça Seca", fee: 6, time: 40 },
    ],
  };
  // Como o robô cota: o endereço digitado e as partes tiradas dele.
  const avaliar = (endereco: string) =>
    avaliarEntrega(loja, { endereco, partes: partesDoEnderecoDigitado(endereco, loja.city) });

  console.log("\n1) A rua com o nome do bairro não decide a taxa");
  {
    const v = await avaliar("Av. João Pinheiro, 2835");
    conferir("'Av. João Pinheiro, 2835' NÃO dá ATENDE pelo bairro Joao Pinheiro", !(v.resultado === "ATENDE" && v.bairro === "Joao Pinheiro"), v);
    const endereco = "Av. João Pinheiro, 2835";
    const { veredito } = await avaliarEntregaDoRobo((p) => avaliarEntrega(loja, p), {
      endereco, partes: partesDoEnderecoDigitado(endereco, loja.city),
    });
    conferir("no robô: falta o bairro (pergunta 'Qual é o seu bairro?'), sem taxa", veredito.resultado === "DESCONHECIDO" && veredito.faltaBairro === true && veredito.taxa === null, veredito);
    for (const t of ["Avenida Joao Pinheiro 2835", "Rua João Pinheiro, 10", "Por favor, queremos 2 pizzas Av. João Pinheiro, 2835 Qual valor?"]) {
      conferir(`'${t}' não acha bairro`, bairroNoEndereco(t, loja) === null, bairroNoEndereco(t, loja));
    }
  }

  console.log("\n2) O bairro escrito continua valendo");
  {
    const v = await avaliar("Av. João Pinheiro, 2835 - Joao Pinheiro");
    conferir("'Av. João Pinheiro, 2835 - Joao Pinheiro' → R$ 8", v.resultado === "ATENDE" && v.bairro === "Joao Pinheiro" && v.taxa === 8, v);
    const s = await avaliar("Joao Pinheiro");
    conferir("'Joao Pinheiro' sozinho → R$ 8", s.resultado === "ATENDE" && s.taxa === 8, s);
    const r = await avaliar("Rua X, 10, Joao Pinheiro");
    conferir("'Rua X, 10, Joao Pinheiro' → R$ 8", r.resultado === "ATENDE" && r.bairro === "Joao Pinheiro" && r.taxa === 8, r);
    conferir("falas juntas: 'Av. João Pinheiro' e depois 'Joao Pinheiro' → bairro dito",
      bairroNoEndereco("Av. João Pinheiro\nJoao Pinheiro", loja)?.name === "Joao Pinheiro");
    conferir("rua com o nome do bairro, bairro de verdade depois → o de depois",
      bairroNoEndereco("Av. João Pinheiro, 2835, Ville de France", loja)?.name === "Country Club");
  }

  console.log("\n3) Bairro cujo nome começa como rua (\"Praça Seca\") continua sendo bairro");
  {
    conferir("'Rua X, 10, Praça Seca' → Praça Seca", bairroNoEndereco("Rua X, 10, Praça Seca", loja)?.name === "Praça Seca");
    conferir("'praca seca' sozinho → Praça Seca", bairroNoEndereco("praca seca", loja)?.name === "Praça Seca");
  }

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})();
