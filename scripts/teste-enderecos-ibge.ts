/**
 * A base de endereços do IBGE (lib/enderecos-ibge.ts) e o nível I da cascata
 * (verifyStoreDeliveryAddress com `opcoes.ibge`). Trechos montados à mão com
 * os casos reais da Divinos Burger (Cabo Frio, simulação de 02/11/2026). Sem
 * banco e sem rede: o mapa é um geocodificador falso que conta as perguntas.
 *
 *   npx tsx scripts/teste-enderecos-ibge.ts
 */
export {};
process.env.DATABASE_URL ||= "teste-sem-banco";

let ok = 0;
let falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) {
    ok++;
    console.log(`  ok   ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe === undefined ? "" : ` — ${JSON.stringify(detalhe)}`}`);
  }
}

(async () => {
  const ib = await import("../src/lib/enderecos-ibge");
  const { verifyStoreDeliveryAddress } = await import("../src/lib/geocoding");

  console.log("Nome da rua");
  confere("título abreviado e ligação", ib.chaveDoNome("Dr. Cardoso da Fonseca") === "doutor cardoso fonseca", ib.chaveDoNome("Dr. Cardoso da Fonseca"));
  confere("número por extenso vira algarismo", ib.chaveDoNome("Doze de Maio") === "12 maio" && ib.chaveDoNome("12 DE MAIO") === "12 maio");
  confere("vinte e cinco", ib.chaveDoNome("Vinte e Cinco de Março") === "25 marco", ib.chaveDoNome("Vinte e Cinco de Março"));
  confere("sem título", ib.semTitulo("doutor cardoso fonseca") === "cardoso fonseca" && ib.semTitulo("cardoso fonseca") === null);
  const tr = ib.separarLogradouro("Rua travessa Monte Horebe");
  confere("tipo repetido fica com o de dentro", tr.tipo === "travessa" && tr.chave === "monte horebe", tr);
  const cb = ib.separarLogradouro("Avenida Caminho de Búzios");
  confere("'Caminho' depois do tipo é nome", cb.tipo === "avenida" && cb.chave === "caminho buzios", cb);
  confere("abreviação do tipo", ib.separarLogradouro("R. Paraná").tipo === "rua" && ib.separarLogradouro("Tv. José Gonçalves").tipo === "travessa");

  console.log("Casamento do nome");
  confere("igual", ib.casamentoDoNome("parana", "parana") === 3);
  confere("uma letra (plural)", ib.casamentoDoNome("andorinha", "andorinhas") === 2);
  confere("número diferente é outra rua", ib.casamentoDoNome("13 maio", "12 maio") === 0);
  confere("Rua Marina ≠ Marina do Canal Palmer", ib.casamentoDoNome("marina", "marina canal palmer") === 0);
  confere("abreviado pelo cliente vale (Getúlio → Getúlio Vargas)", ib.casamentoDoNome("getulio", "getulio vargas") === 1);
  confere("IBGE curto dentro do escrito não vale (Agenor Medeiros × Medeiros)", ib.casamentoDoNome("agenor medeiros", "medeiros") === 0);
  confere("duas palavras em comum valem", ib.casamentoDoNome("moacir moreira", "moacir santos moreira") === 1);

  console.log("Bairro");
  confere("prefixo Vila sai", ib.mesmoBairro("Monte Alegre", "VILA MONTE ALEGRE"));
  confere("acento e caixa", ib.mesmoBairro("jardim peró", "JARDIM PERO"));
  confere("Jardim Esperança ≠ Vila Esperança? (os dois sem prefixo: iguais — a régua é do nome)", ib.mesmoBairro("Jardim Esperança", "Esperanca"));
  confere("bairros diferentes", !ib.mesmoBairro("Boca do Mato", "MONTE ALEGRE"));

  console.log("Número da casa");
  confere("vírgula", ib.numeroDaCasa("Rua Diamante, 53, Monte Alegre") === 53);
  confere("colado na rua", ib.numeroDaCasa("Rua Rui dos anjos Cruz n36, Monte Alegre") === 36);
  confere("nº", ib.numeroDaCasa("Rua doze de maio, nº 14, Boca do Mato") === 14);
  confere("número no nome não é o da casa", ib.numeroDaCasa("Rua 12 de maio, número 06, monte alegre") === 6);
  confere("casa 2 não é o número", ib.numeroDaCasa("Beco do idrometro, Casa 2, Brasília") === null);
  confere("primeiro pedaço sem o número", ib.primeiroPedaco("Maria José 10, boca do mato") === "Maria José" && ib.primeiroPedaco("Rua 13 de Maio, 47") === "Rua 13 de Maio");

  // ── Trechos de mentira, em linha reta (0,0001° ≈ 11 m por número) ─────────
  const rua = (tipo: string, nome: string, bairro: string, lat0: number, lng0: number, numeros: number[]): any => ({
    tipo, nome, chave: ib.chaveDoNome(nome), chaveSemTitulo: ib.semTitulo(ib.chaveDoNome(nome)), bairro,
    numeros, lats: numeros.map((n) => lat0 + n * 0.00001), lngs: numeros.map(() => lng0),
  });
  const LOJA = { lat: -22.8544, lng: -42.0296 };

  console.log("Número mais perto");
  const r1 = rua("rua", "PARANA", "JARDIM PERO", -22.84, -42.017, [2, 4, 10, 12, 100, 200, 358, 360]);
  const casa = ib.pontoDoNumero(r1, 358);
  confere("número que existe → a casa", casa.precisao === "casa" && Math.abs(casa.lat - (-22.84 + 358 * 0.00001)) < 1e-9, casa);
  confere("vizinho até ±30", ib.pontoDoNumero(r1, 20).precisao === "vizinho" && ib.pontoDoNumero(r1, 20).numero === 12);
  const entre = ib.pontoDoNumero(r1, 150);
  confere("entre dois números → interpolado", entre.precisao === "entre" && Math.abs(entre.lat - (-22.84 + 150 * 0.00001)) < 1e-9, entre);
  confere("sem número → meio da rua", ib.pontoDoNumero(r1, null).precisao === "rua");

  console.log("Qual trecho vale");
  const paranas = [
    rua("rua", "PARANA", "JARDIM ESPERANCA", -22.838, -42.0258, [13, 24, 151, 175]),
    rua("beco", "PARANA", "JARDIM ESPERANCA", -22.8398, -42.0239, [1, 2, 3, 35]),
    rua("rua", "PARANA", "JARDIM PERO", -22.8397, -42.0168, [2, 100, 358, 360]),
    rua("rua", "PARANA", "JARDIM CAICARA", -22.8828, -42.0424, [501, 519, 1011]),
    rua("rua", "PARANA", "UNAMAR", -22.6205, -42.031, [10, 20]),
  ];
  const centros: Record<string, { lat: number; lng: number }> = {
    "JARDIM PERO": { lat: -22.839, lng: -42.016 }, "JARDIM ESPERANCA": { lat: -22.84, lng: -42.025 }, "MONTE ALEGRE": { lat: -22.851, lng: -42.03 },
    "BOCA DO MATO": { lat: -22.852, lng: -42.035 }, "PORTO DO CARRO": { lat: -22.855, lng: -42.037 }, GAMBOA: { lat: -22.858, lng: -42.03 },
  };
  const regua = {
    centroDoBairro: (b: string) => Object.entries(centros).find(([n]) => ib.mesmoBairro(b, n))?.[1] ?? null,
    loja: LOJA,
    limiteKm: 5.5,
  };
  const pr = ib.acharNoIbge({ logradouros: ["rua paraná"], numero: 358, bairro: "jardim peró" }, paranas, regua);
  confere("Rua Paraná, 358 - Jardim Peró → a casa no Jardim Peró", pr?.porque === "bairro" && pr?.precisao === "casa" && pr?.bairro === "JARDIM PERO", pr && { ...pr, rua: undefined });
  const beco = ib.acharNoIbge({ logradouros: ["Beco Paraná"], numero: 3, bairro: "Jardim Esperança" }, paranas, regua);
  confere("o tipo escrito decide entre Rua e Beco do mesmo bairro", beco?.rua.tipo === "beco" && beco?.precisao === "casa");
  confere("Rua Paraná sem bairro (4 lugares) → null", ib.acharNoIbge({ logradouros: ["Rua Paraná"], numero: 358, bairro: null }, paranas, regua) === null);

  const marina = [rua("rua", "MARINA", "MONTE ALEGRE", -22.8584, -42.0313, [4, 5, 14, 17, 50]), rua("rua", "DA MARINA", "PRAIA DO SIQUEIRA", -22.8701, -42.0522, [1, 9])];
  const m1 = ib.acharNoIbge({ logradouros: ["Rua Marina"], numero: 5, bairro: "Gamboa" }, marina, regua);
  confere("homônima: vale a perto do bairro escrito quando a outra fica no dobro", m1?.porque === "perto" && m1?.bairro === "MONTE ALEGRE", m1 && { ...m1, rua: undefined });

  const bomPastor = [rua("rua", "BOM PASTOR", "UNAMAR", -22.62, -42.0, [2, 4])];
  confere("rua única do outro lado do município (rua nova que o Censo não pegou) → null", ib.acharNoIbge({ logradouros: ["Rua Bom Pastor"], numero: 2, bairro: "Porto do Carro" }, bomPastor, regua) === null);

  const brasilia = [rua("rua", "BRASILIA", "JARDIM EXCELSIOR", -22.875, -42.03, [1, 2, 3])];
  confere("Beco Brasília (Gamboa) não é a Rua Brasília a 2 km", ib.acharNoIbge({ logradouros: ["Beco Brasília"], numero: 2, bairro: "Gamboa" }, brasilia, regua) === null);
  const horebe = [rua("rua", "MONTE HOREBE", "MONTE ALEGRE", -22.85, -42.028, [2, 4, 102])];
  const h = ib.acharNoIbge({ logradouros: ["Travessa Monte Horebe"], numero: 4, bairro: null }, horebe, regua);
  confere("tipo diferente sem bairro, rua única perto da loja → vale", h?.porque === "unica" && h?.precisao === "casa");
  confere("nome genérico ('Rua sem saída') nunca casa", ib.acharNoIbge({ logradouros: ["Rua sem saída"], numero: null, bairro: "Gamboa" }, [rua("rua", "SEM SAIDA", "GAMBOA", -22.858, -42.03, [1])], regua) === null);
  confere("nome curto só no bairro escrito", ib.acharNoIbge({ logradouros: ["Beco 1"], numero: null, bairro: null }, [rua("beco", "1", "PERO", -22.86, -41.99, [1])], regua) === null);

  console.log("Trechos da mesma rua em dois bairros");
  const longa = [
    rua("avenida", "CAMINHO DE BUZIOS", "TANGARA", -22.8296, -42.0042, [1, 3, 5, 7]),
    rua("avenida", "CAMINHO DE BUZIOS", "GURIRI", -22.8296 + 0.003, -42.0042, [100, 102]),
    rua("avenida", "CAMINHO DE BUZIOS", "CAMINHO DE BUZIOS", -22.8296 + 0.0015, -42.0042, [300]),
  ];
  confere("encadeados a ≤0,5 km são um lugar só", ib.lugaresDaRua(longa).length === 1);
  const cb1 = ib.acharNoIbge({ logradouros: ["Avenida Caminho de Buzios"], numero: 1, bairro: "Caminho de búzios" }, longa, regua);
  confere("o número fora do trecho do bairro vem do resto da rua", cb1?.precisao === "casa" && cb1?.bairro === "TANGARA", cb1 && { ...cb1, rua: undefined });

  console.log("Polígono do bairro");
  const quadrado: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const buraco: [number, number][] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  confere("dentro", ib.dentroDoPoligono({ lat: 2, lng: 2 }, [quadrado]));
  confere("fora", !ib.dentroDoPoligono({ lat: 12, lng: 2 }, [quadrado]));
  confere("no buraco é fora", !ib.dentroDoPoligono({ lat: 5, lng: 5 }, [quadrado, buraco]));
  confere("bairroDoPonto pelo bbox e polígono", ib.bairroDoPonto({ lat: 2, lng: 2 }, [{ nome: "Centro", bbox: [0, 0, 10, 10], aneis: [quadrado] }]) === "Centro");
  const lado = (a: [number, number], b: [number, number]) => Array.from({ length: 50 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 50, a[1] + ((b[1] - a[1]) * i) / 50] as [number, number]);
  const cheio: [number, number][] = [...lado([0, 0], [1, 0]), ...lado([1, 0], [1, 1]), ...lado([1, 1], [0, 1]), ...lado([0, 1], [0, 0]), [0, 0]];
  const simples = ib.simplificar(cheio, 0.0001);
  confere("simplificar tira os pontos no meio dos lados e guarda os cantos", simples.length === 5 && ib.dentroDoPoligono({ lat: 0.5, lng: 0.5 }, [simples]), simples.length);

  console.log("Nome exibido");
  confere("acento pelo texto do cliente", ib.nomeComAcento("JARDIM PERO", "rua paraná,358, jardim peró") === "Jardim Peró");
  confere("acento pelo dicionário", ib.nomeComAcento("RUA SAO JOAO", "") === "Rua São João");
  confere("de/da minúsculo", ib.nomeComAcento("BOCA DO MATO", "") === "Boca do Mato");

  console.log("Nível I na cascata da taxa");
  let perguntasAoMapa = 0;
  const mapaFalso: any = {
    livre: async () => { perguntasAoMapa++; return { ok: true, valor: null }; },
    estruturada: async () => { perguntasAoMapa++; return { ok: true, valor: [] }; },
  };
  const zonas = [{ km: 1, fee: 5 }, { km: 2, fee: 10 }, { km: 5.5, fee: 22 }];
  let pedidoAoIbge: any = null;
  const comIbge = await verifyStoreDeliveryAddress(
    "Travessa Liberdade, 11", LOJA, "CABO FRIO", zonas, "KM", "Rua Paraná, 358 - Jardim Peró", null, {}, undefined,
    {
      geocodificador: mapaFalso,
      ibge: async (p) => { pedidoAoIbge = p; return { lat: -22.8397 + 358 * 0.00001, lng: -42.0168, displayName: "Rua Paraná, 358 - Jardim Peró, Cabo Frio", precisao: "endereco" }; },
    },
  );
  confere("o IBGE achou → o mapa não é perguntado", perguntasAoMapa === 0, perguntasAoMapa);
  confere("ponto do IBGE, origem 'mapa', precisão endereço", comIbge?.addressFound === true && comIbge?.origemDoPonto === "mapa" && comIbge?.precisao === "endereco" && Math.abs((comIbge?.clienteLat ?? 0) - (-22.8397 + 358 * 0.00001)) < 1e-9, comIbge);
  confere("o nome do IBGE vai como o endereço no mapa", comIbge?.matchedAddress === "Rua Paraná, 358 - Jardim Peró, Cabo Frio", comIbge?.matchedAddress);
  confere("o IBGE recebe bairro, número e a loja", pedidoAoIbge?.bairro === "Jardim Peró" && pedidoAoIbge?.cidade === "CABO FRIO" && pedidoAoIbge?.raioKm === 5.5 && pedidoAoIbge?.loja?.lat === LOJA.lat, pedidoAoIbge);
  perguntasAoMapa = 0;
  const semIbge = await verifyStoreDeliveryAddress(
    "Travessa Liberdade, 11", LOJA, "CABO FRIO", zonas, "KM", "Rua Paraná, 358 - Jardim Peró", null, {}, undefined,
    { geocodificador: mapaFalso, ibge: async () => null },
  );
  confere("o IBGE não achou → a cascata do mapa segue", perguntasAoMapa > 0 && semIbge?.addressFound === false, { perguntasAoMapa, semIbge });
  perguntasAoMapa = 0;
  await verifyStoreDeliveryAddress("Travessa Liberdade, 11", LOJA, "CABO FRIO", zonas, "KM", "Rua Paraná, 358 - Jardim Peró", null, {}, undefined, {
    geocodificador: mapaFalso,
    ibge: async () => { throw new Error("banco fora"); },
  });
  confere("o IBGE falhou → a cascata do mapa segue", perguntasAoMapa > 0);
  let chamouComGps = false;
  await verifyStoreDeliveryAddress("Travessa Liberdade, 11", LOJA, "CABO FRIO", zonas, "KM", "Rua Paraná, 358", { lat: -22.85, lng: -42.03 }, {}, undefined, {
    geocodificador: mapaFalso,
    ibge: async () => { chamouComGps = true; return null; },
  });
  confere("com o GPS do cliente o IBGE nem é perguntado", !chamouComGps);

  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
