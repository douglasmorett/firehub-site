/**
 * As regras da Escala da equipe (lib/escala-da-equipe/regras.ts), sem banco.
 *
 *   npx tsx scripts/teste-escala-da-equipe.ts
 *
 * O caso: Lucas (Frangoso), motoboy freelancer combinado "de boca" — faltava
 * ou sobrava gente. Repetição por dia da semana, cópia da semana, turno que
 * vira a meia-noite, prazos do link, vagas e quem é quem pelo telefone.
 * E (12/11/2026) o Pix e o controle de pagamento: chave lida e escondida,
 * devido/pago/pendente por pessoa, turno futuro fora, dia pago no acerto do
 * motoboy e o "pagar tudo" dividido pela diária.
 */
import {
  acertoQueCobre, acharPeloTelefone, agoraDaLoja, chaveDaFuncao, copiarSemana, cpfValido, custoPrevisto, dataValida, datasDaRepeticao, desistenciaAberta,
  diaDaSemana, diaDoExpedienteDoTurno, diasDaSemanaDe, dividirValor, duracaoEmMinutos, fimDoMes, funcaoNoLink, horarioDoTurno, inicioDaSemana,
  inscricaoAberta, lerChavePix, lerConfigDaEscala, lerHora, minutosAteOTurno, navegar, normalizarFuncao, periodoDaVisao, pixFormatado, pixMascarado,
  pixParaCopiar, primeiroNome, resumoDosPagamentos, semanasDoMes, situacaoDasVagas, situacaoDoPagamento, tituloDoPeriodo, turnoJaTerminou,
  turnosSeSobrepoem, validarTurno, viraAMeiaNoite, type ItemDePagamento,
} from "../src/lib/escala-da-equipe/regras";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("\n— Datas do calendário —");
confere("16/11/2026 é segunda", diaDaSemana("2026-11-16"), 1);
confere("a semana começa na segunda (domingo 22/11 é da semana de 16/11)", inicioDaSemana("2026-11-22"), "2026-11-16");
confere("…e a segunda é dela mesma", inicioDaSemana("2026-11-16"), "2026-11-16");
confere("semana de 18/11: de 16 a 22", periodoDaVisao("semana", "2026-11-18"), { de: "2026-11-16", ate: "2026-11-22" });
confere("mês de fevereiro de 2028 (bissexto) vai até 29", periodoDaVisao("mes", "2028-02-10"), { de: "2028-02-01", ate: "2028-02-29" });
confere("fim do mês de novembro", fimDoMes("2026-11-11"), "2026-11-30");
confere("próximo mês a partir de 31/01 cai em fevereiro, não em março", navegar("mes", "2027-01-31", 1), "2027-02-01");
confere("semana anterior volta para a segunda de 7 dias antes", navegar("semana", "2026-11-19", -1), "2026-11-09");
confere("a grade de novembro/2026 tem 6 semanas (começa num domingo)", semanasDoMes("2026-11-01").length, 6);
confere("a grade começa na segunda antes do dia 1", semanasDoMes("2026-11-01")[0][0], "2026-10-26");
confere("7 dias na semana", diasDaSemanaDe("2026-11-11").length, 7);
confere("31/02 não é data", dataValida("2026-02-31"), false);
confere("título da semana", tituloDoPeriodo("semana", "2026-11-18"), "16/11 a 22/11");
confere("título do dia", tituloDoPeriodo("dia", "2026-11-16"), "segunda, 16/11");

console.log("\n— Horas e o turno que vira a meia-noite —");
confere("18:00 = 1080 min", lerHora("18:00"), 1080);
confere("24:00 não existe (meia-noite é 00:00)", lerHora("24:00"), null);
confere("18:00–02:00 vira a meia-noite", viraAMeiaNoite("18:00", "02:00"), true);
confere("…e dura 8 h", duracaoEmMinutos("18:00", "02:00"), 480);
confere("11:00–15:00 não vira", viraAMeiaNoite("11:00", "15:00"), false);
confere("19:00–00:00 vira (termina à meia-noite)", viraAMeiaNoite("19:00", "00:00"), true);
confere("horário falado com +1", horarioDoTurno("18:00", "02:00"), "18:00 às 02:00 (+1)");
confere("turno que vira a meia-noite cruza com o da madrugada do outro dia",
  turnosSeSobrepoem({ data: "2026-11-16", inicio: "18:00", fim: "02:00" }, { data: "2026-11-17", inicio: "01:00", fim: "05:00" }), true);
confere("turnos que só encostam não cruzam",
  turnosSeSobrepoem({ data: "2026-11-16", inicio: "11:00", fim: "15:00" }, { data: "2026-11-16", inicio: "15:00", fim: "18:00" }), false);
confere("almoço e jantar do mesmo dia não cruzam",
  turnosSeSobrepoem({ data: "2026-11-16", inicio: "11:00", fim: "15:00" }, { data: "2026-11-16", inicio: "18:00", fim: "23:30" }), false);

console.log("\n— Validar o turno —");
const v = validarTurno({ data: "2026-11-16", inicio: "18:00", fim: "02:00", funcao: "  motoboy ", vagas: "2", obs: "levar bag" });
confere("turno válido, função na grafia da lista", v.ok && v.turno, { data: "2026-11-16", inicio: "18:00", fim: "02:00", funcao: "Motoboy", vagas: 2, obs: "levar bag" });
confere("início igual ao fim é recusado", validarTurno({ data: "2026-11-16", inicio: "18:00", fim: "18:00", funcao: "Caixa", vagas: 1 }).ok, false);
confere("zero vaga é recusado", validarTurno({ data: "2026-11-16", inicio: "18:00", fim: "23:00", funcao: "Caixa", vagas: 0 }).ok, false);
confere("sem função é recusado", validarTurno({ data: "2026-11-16", inicio: "18:00", fim: "23:00", funcao: "", vagas: 1 }).ok, false);
confere("função livre (Outro) passa", validarTurno({ data: "2026-11-16", inicio: "18:00", fim: "23:00", funcao: "Pizzaiolo", vagas: 1 }).ok, true);
confere("'garcom' vira 'Garçom'", normalizarFuncao("garcom"), "Garçom");

console.log("\n— Repetir por dia da semana —");
const segSex = datasDaRepeticao("2026-11-16", "2026-11-30", [1, 2, 3, 4, 5]);
confere("seg–sex de 16/11 até o fim do mês: 11 turnos", segSex.ok && segSex.datas.length, 11);
confere("…sem sábado nem domingo", segSex.ok && segSex.datas.some((d) => [0, 6].includes(diaDaSemana(d))), false);
confere("…começando no dia 16 e terminando no 30", segSex.ok && [segSex.datas[0], segSex.datas.at(-1)], ["2026-11-16", "2026-11-30"]);
const soSexta = datasDaRepeticao("2026-11-16", "2026-12-31", [5]);
confere("só sexta até o fim do ano", soSexta.ok && soSexta.datas, ["2026-11-20", "2026-11-27", "2026-12-04", "2026-12-11", "2026-12-18", "2026-12-25"]);
confere("sem dia marcado = todo dia", (datasDaRepeticao("2026-11-16", "2026-11-22", []) as any).datas.length, 7);
confere("'até' antes da data é recusado", datasDaRepeticao("2026-11-16", "2026-11-10", [1]).ok, false);
confere("mais de 3 meses é recusado", datasDaRepeticao("2026-11-16", "2027-06-01", [1]).ok, false);
confere("período sem nenhum dia marcado é recusado", datasDaRepeticao("2026-11-16", "2026-11-17", [5]).ok, false);

console.log("\n— Copiar a semana anterior —");
const anterior = [
  { data: "2026-11-09", inicio: "18:00", fim: "23:30", funcao: "Motoboy", vagas: 2, obs: null },
  { data: "2026-11-13", inicio: "18:00", fim: "02:00", funcao: "Atendente", vagas: 1, obs: "fechar caixa" },
  { data: "2026-11-15", inicio: "11:00", fim: "15:00", funcao: "Cozinha", vagas: 1, obs: null },
  { data: "2026-11-16", inicio: "11:00", fim: "15:00", funcao: "Cozinha", vagas: 1, obs: null }, // fora da semana de origem
];
const copiados = copiarSemana(anterior, "2026-11-09", "2026-11-16", []);
confere("3 turnos copiados (o de fora da semana não vai)", copiados.length, 3);
confere("segunda vai para segunda", copiados[0].data, "2026-11-16");
confere("sexta vai para sexta, com a observação", [copiados[1].data, copiados[1].obs], ["2026-11-20", "fechar caixa"]);
confere("domingo vai para domingo", copiados[2].data, "2026-11-22");
const deNovo = copiarSemana(anterior, "2026-11-09", "2026-11-16", copiados);
confere("copiar de novo não duplica", deNovo.length, 0);
const parcial = copiarSemana(anterior, "2026-11-09", "2026-11-16", [{ data: "2026-11-16", inicio: "18:00", fim: "23:30", funcao: "motoboy", vagas: 5 }]);
confere("o turno igual que já existe (mesma função, outra grafia) fica de fora", parcial.length, 2);

console.log("\n— Vagas —");
confere("ninguém inscrito", situacaoDasVagas(0, 2).estado, "vazio");
confere("1 de 2: falta 1", [situacaoDasVagas(1, 2).estado, situacaoDasVagas(1, 2).faltam], ["falta", 1]);
confere("2 de 2: completo", situacaoDasVagas(2, 2).estado, "completo");
confere("3 de 2: gente a mais", [situacaoDasVagas(3, 2).estado, situacaoDasVagas(3, 2).sobram], ["excedido", 1]);

console.log("\n— Prazos no relógio da loja —");
// 16/11/2026 15:00 em Brasília = 18:00Z.
const agora = agoraDaLoja("America/Sao_Paulo", new Date("2026-11-16T18:00:00Z"));
confere("agora da loja é 16/11 às 15:00 (não o UTC do servidor)", agora, { data: "2026-11-16", minutos: 900 });
const noite = { data: "2026-11-16", inicio: "18:00", fim: "02:00" };
confere("faltam 3 h para o turno das 18:00", minutosAteOTurno(noite, agora), 180);
confere("inscrição até 2 h antes: aberta às 15:00", inscricaoAberta(noite, agora, { prazoInscricaoHoras: 2 }), true);
confere("inscrição até 4 h antes: fechada às 15:00", inscricaoAberta(noite, agora, { prazoInscricaoHoras: 4 }), false);
const asDezoito = agoraDaLoja("America/Sao_Paulo", new Date("2026-11-16T21:30:00Z")); // 18:30
confere("prazo 0: depois que começou, fecha", inscricaoAberta(noite, asDezoito, { prazoInscricaoHoras: 0 }), false);
confere("desistir até 24 h antes: às 15:00 do dia já não dá", desistenciaAberta(noite, agora, { permiteDesistir: true, prazoDesistenciaHoras: 24 }), false);
confere("desistir até 2 h antes: às 15:00 ainda dá", desistenciaAberta(noite, agora, { permiteDesistir: true, prazoDesistenciaHoras: 2 }), true);
confere("loja que não deixa desistir: nunca pelo link", desistenciaAberta(noite, agora, { permiteDesistir: false, prazoDesistenciaHoras: 0 }), false);
confere("turno da véspera (18:00–02:00) ainda não terminou à 01:00",
  turnoJaTerminou({ data: "2026-11-15", inicio: "18:00", fim: "02:00" }, agoraDaLoja("America/Sao_Paulo", new Date("2026-11-16T04:00:00Z"))), false);
confere("…e terminou às 03:00", turnoJaTerminou({ data: "2026-11-15", inicio: "18:00", fim: "02:00" }, agoraDaLoja("America/Sao_Paulo", new Date("2026-11-16T06:00:00Z"))), true);
confere("na virada do dia UTC (22:00 em Brasília = 01:00Z) ainda é o dia da loja", agoraDaLoja("America/Sao_Paulo", new Date("2026-11-17T01:00:00Z")).data, "2026-11-16");

console.log("\n— Configuração do link —");
const cfg = lerConfigDaEscala({ prazoInscricaoHoras: 999, prazoDesistenciaHoras: -3, funcoesNoLink: ["motoboy", "Motoboy", "garcom"] });
confere("prazos ficam entre 0 e 168 h", [cfg.prazoInscricaoHoras, cfg.prazoDesistenciaHoras], [168, 0]);
confere("funções do link sem repetir, na grafia da lista", cfg.funcoesNoLink, ["Motoboy", "Garçom"]);
confere("lista vazia = todas as funções", funcaoNoLink("Cozinha", []), true);
confere("só Motoboy no link: Cozinha não aparece", funcaoNoLink("Cozinha", ["Motoboy"]), false);
confere("…e motoboy (minúsculo) aparece", funcaoNoLink("motoboy", ["Motoboy"]), true);
confere("sem nada gravado vale o padrão (desistir até 24 h antes)", lerConfigDaEscala(null).prazoDesistenciaHoras, 24);

console.log("\n— Quem é quem pelo telefone —");
const pessoas = [
  { tipo: "motoboy", id: "m1", nome: "João Carlos Silva", telefone: "(22) 99876-5432" },
  { tipo: "equipe", id: "u1", nome: "Maria", telefone: "+55 21 98765-4321" },
  { tipo: "freelancer", id: "f1", nome: "Zé", telefone: null },
];
confere("mesmo número com +55 e sem máscara acha o motoboy", acharPeloTelefone("5522998765432", pessoas)?.id, "m1");
confere("sem o nono dígito também acha (cadastro antigo)", acharPeloTelefone("22 9876-5432", pessoas)?.id, "m1");
confere("mesmos 8 dígitos em OUTRO DDD não é a mesma pessoa", acharPeloTelefone("11 99876-5432", pessoas), null);
confere("sem DDD não identifica ninguém", acharPeloTelefone("99876-5432", pessoas), null);
confere("vazio não identifica ninguém (nem quem não tem telefone)", acharPeloTelefone("", pessoas), null);
confere("o link mostra só o primeiro nome", primeiroNome("  João Carlos Silva "), "João");
confere("chave da função ignora acento e maiúscula", chaveDaFuncao("GARÇOM"), "garcom");

console.log("\n— Custo previsto —");
const custo = custoPrevisto([
  { inscritos: [{ pessoaTipo: "freelancer", pessoaId: "f1", nome: "Zé", diaria: 80 }, { pessoaTipo: "motoboy", pessoaId: "m1", nome: "João", diaria: 60 }] },
  { inscritos: [{ pessoaTipo: "freelancer", pessoaId: "f1", nome: "Zé", diaria: 80 }, { pessoaTipo: "equipe", pessoaId: "u1", nome: "Maria", diaria: null }] },
]);
confere("soma as diárias de quem está inscrito", custo.total, 220);
confere("quem não tem diária fica contado à parte", custo.semValor, 1);
confere("por pessoa, do maior para o menor", custo.porPessoa, [{ nome: "Zé", turnos: 2, total: 160 }, { nome: "João", turnos: 1, total: 60 }]);

console.log("\n— Chave Pix —");
const pix = (b: unknown, t?: unknown) => { const l = lerChavePix(b, t); return l.ok ? [l.tipo, l.chave] : ["erro"]; };
confere("CPF com pontos é CPF, gravado só com dígitos", pix("529.982.247-25"), ["cpf", "52998224725"]);
confere("CPF com dígito trocado é recusado", cpfValido("529.982.247-26"), false);
confere("11 dígitos que não são CPF mas têm o 9 depois do DDD = celular", pix("22998765432"), ["telefone", "+5522998765432"]);
confere("celular com máscara e +55", pix("+55 (22) 99876-5432"), ["telefone", "+5522998765432"]);
confere("11 dígitos que não são CPF nem celular: erro (não chuta)", pix("12345678901"), ["erro"]);
confere("o tipo escolhido manda: 'CPF' com número de celular é recusado", pix("22998765432", "cpf"), ["erro"]);
confere("e-mail vai em minúsculas", pix("  Joao.Silva@Gmail.com "), ["email", "joao.silva@gmail.com"]);
confere("e-mail sem domínio é recusado", pix("joao@gmail", "email"), ["erro"]);
confere("chave aleatória sem hífens ganha os hífens", pix("123E4567E89B12D3A456426614174000"), ["aleatoria", "123e4567-e89b-12d3-a456-426614174000"]);
confere("CNPJ válido", pix("11.222.333/0001-81"), ["cnpj", "11222333000181"]);
confere("vazio pede a chave", lerChavePix("").ok, false);
confere("texto qualquer não é chave", pix("meu pix é o celular"), ["erro"]);
confere("o link mostra o CPF escondido", pixMascarado("52998224725", "cpf"), "***.982.247-**");
confere("…o celular escondido", pixMascarado("+5522998765432", "telefone"), "(22) *****-5432");
confere("…o e-mail escondido", pixMascarado("joao.silva@gmail.com", "email"), "jo***@gmail.com");
confere("…a aleatória escondida", pixMascarado("123e4567-e89b-12d3-a456-426614174000", "aleatoria"), "123e…4000");
confere("o dono vê o CPF formatado", pixFormatado("52998224725", "cpf"), "529.982.247-25");
confere("copiar o celular dá DDD + número (o app do banco põe o +55)", pixParaCopiar("+5522998765432", "telefone"), "22998765432");
confere("chave antiga sem tipo gravado: o tipo é adivinhado", pixFormatado("52998224725", null), "529.982.247-25");

console.log("\n— Pagamentos —");
const item = (o: Partial<ItemDePagamento> & Pick<ItemDePagamento, "inscricaoId" | "data" | "pessoaId">): ItemDePagamento => ({
  turnoId: "t", inicio: "18:00", fim: "23:00", funcao: "Atendente", pessoaTipo: "freelancer", nome: o.pessoaId, diaria: 80, pagamento: null, acerto: null, ...o,
});
const pago = (valor: number) => ({ id: "p", valor, forma: "pix" as const, obs: null, pagoEm: "2026-11-10T22:00:00.000Z", pagoPor: "Dono" });
const hojeDaLoja = "2026-11-12";
confere("turno de amanhã não é 'a pagar'", situacaoDoPagamento(item({ inscricaoId: "a", data: "2026-11-13", pessoaId: "zé" }), hojeDaLoja), "futuro");
confere("turno de hoje já é 'a pagar'", situacaoDoPagamento(item({ inscricaoId: "a", data: "2026-11-12", pessoaId: "zé" }), hojeDaLoja), "pendente");
const itens: ItemDePagamento[] = [
  item({ inscricaoId: "1", data: "2026-11-10", pessoaId: "ana", nome: "Ana", diaria: 80, pagamento: pago(80) }),
  item({ inscricaoId: "2", data: "2026-11-11", pessoaId: "ana", nome: "Ana", diaria: 80 }),
  item({ inscricaoId: "3", data: "2026-11-12", pessoaId: "ana", nome: "Ana", diaria: 80 }),
  item({ inscricaoId: "4", data: "2026-11-14", pessoaId: "ana", nome: "Ana", diaria: 80 }), // futuro
  item({ inscricaoId: "5", data: "2026-11-11", pessoaId: "bia", nome: "Bia", diaria: null }), // sem diária
  item({ inscricaoId: "6", data: "2026-11-10", pessoaId: "bia", nome: "Bia", diaria: null, pagamento: pago(70) }),
  item({ inscricaoId: "7", data: "2026-11-11", pessoaTipo: "motoboy", pessoaId: "joão", nome: "João", diaria: 60, acerto: { id: "ac", em: "2026-11-12T03:00:00.000Z", dia: "2026-11-11" } }),
  item({ inscricaoId: "8", data: "2026-11-12", pessoaTipo: "motoboy", pessoaId: "joão", nome: "João", diaria: 60 }),
];
const r = resumoDosPagamentos(itens, hojeDaLoja);
const ana = r.porPessoa.find((p) => p.pessoaId === "ana")!, bia = r.porPessoa.find((p) => p.pessoaId === "bia")!, joao = r.porPessoa.find((p) => p.pessoaId === "joão")!;
confere("Ana: 3 turnos trabalhados (o de sábado ainda não)", ana.turnos, 3);
confere("Ana: pago 80, pendente 160, devido 240", [ana.pago, ana.pendente, ana.devido], [80, 160, 240]);
confere("Bia sem diária: o pendente fica 'sem valor', não R$ 0", [bia.pago, bia.pendente, bia.semValor], [70, 0, 1]);
confere("João: o dia do acerto sai do devido (o acerto já pagou)", [joao.turnos, joao.noAcerto, joao.pendente, joao.devido], [2, 1, 60, 60]);
confere("total do período", [r.devido, r.pago, r.pendente, r.semValor, r.noAcerto, r.turnos], [370, 150, 220, 1, 1, 7]);
confere("quem deve mais vem primeiro", r.porPessoa.map((p) => p.nome), ["Ana", "João", "Bia"]);

console.log("\n— Motoboy: dia pago no acerto —");
confere("turno das 18:00 é do expediente do mesmo dia", diaDoExpedienteDoTurno({ data: "2026-11-11", inicio: "18:00" }), "2026-11-11");
confere("turno que começa 01:00 é do expediente da véspera (vira às 5h)", diaDoExpedienteDoTurno({ data: "2026-11-12", inicio: "01:00" }), "2026-11-11");
const acertos = [{ id: "ac1", dias: ["2026-11-10", "2026-11-11"] }];
confere("o acerto que pagou 10 e 11 cobre o turno de 11 à noite", acertoQueCobre(acertos, { data: "2026-11-11", inicio: "18:00" })?.id, "ac1");
confere("…e a madrugada de 12 (ainda é o dia 11)", acertoQueCobre(acertos, { data: "2026-11-12", inicio: "01:30" })?.id, "ac1");
confere("…mas não o turno de 12 à noite", acertoQueCobre(acertos, { data: "2026-11-12", inicio: "18:00" }), null);
confere("sem acerto, não cobre", acertoQueCobre([], { data: "2026-11-11", inicio: "18:00" }), null);

console.log("\n— Pagar tudo: o total dividido —");
confere("diárias iguais: partes iguais", dividirValor(240, [80, 80, 80]), [80, 80, 80]);
confere("pagou menos: proporcional, e a soma bate", dividirValor(100, [80, 80, 80]), [33.33, 33.33, 33.34]);
confere("diárias diferentes: proporcional à diária", dividirValor(150, [100, 50]), [100, 50]);
confere("sem diária no meio: pesa a média das outras", dividirValor(240, [80, null, 80]), [80, 80, 80]);
confere("ninguém com diária: partes iguais", dividirValor(100, [null, null]), [50, 50]);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
