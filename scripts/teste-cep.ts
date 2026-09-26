/**
 * O CEP no checkout (src/lib/cep.ts): formato, leitura do ViaCEP e o aviso.
 *
 *   npx tsx scripts/teste-cep.ts           (sem rede: o ViaCEP é simulado)
 *   npx tsx scripts/teste-cep.ts --rede    (pergunta ao ViaCEP de verdade)
 */
import { avisoDoCep, buscarCep, cepFormatado, cidadeComparavel, digitosDoCep, lerRespostaDoViaCep, type ConsultaDoCep } from "../src/lib/cep";

export {};

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe ?? ""); }
}

// ── Formato ──────────────────────────────────────────────────────────────
confere("só dígitos, no máximo 8", digitosDoCep("28.905-080 extra 99") === "28905080");
confere("formata enquanto digita: 5 dígitos", cepFormatado("28905") === "28905");
confere("formata enquanto digita: 6 dígitos ganha o traço", cepFormatado("289050") === "28905-0");
confere("CEP colado com ponto e traço", cepFormatado("28.905-080") === "28905-080");
confere("vazio", cepFormatado(null) === "" && digitosDoCep(undefined) === "");

// ── A resposta do ViaCEP ─────────────────────────────────────────────────
const cabofrio = { cep: "28905-080", logradouro: "Rua do Forno", bairro: "Jardim Esperança", localidade: "Cabo Frio", uf: "RJ" };
confere("lê rua, bairro, cidade e UF", JSON.stringify(lerRespostaDoViaCep(cabofrio)) === JSON.stringify({ rua: "Rua do Forno", bairro: "Jardim Esperança", cidade: "Cabo Frio", uf: "RJ" }));
confere("{ erro: true } é CEP que não existe", lerRespostaDoViaCep({ erro: true }) === null);
confere("{ erro: \"true\" } também (o ViaCEP manda assim às vezes)", lerRespostaDoViaCep({ erro: "true" }) === null);
confere("sem cidade não vale", lerRespostaDoViaCep({ logradouro: "Rua X" }) === null);
confere("lixo não vale", lerRespostaDoViaCep("oi") === null && lerRespostaDoViaCep(null) === null);

// ── A cidade ─────────────────────────────────────────────────────────────
confere("'CABO FRIO' e 'Cabo Frio - RJ' são a mesma cidade", cidadeComparavel("CABO FRIO") === cidadeComparavel("Cabo Frio - RJ"));
confere("'Armação dos Búzios/RJ' sem acento", cidadeComparavel("Armação dos Búzios/RJ") === "armacao dos buzios");

// ── O aviso ──────────────────────────────────────────────────────────────
const achou = (e: Partial<{ rua: string; bairro: string; cidade: string; uf: string }>): ConsultaDoCep =>
  ({ ok: true, endereco: { rua: "", bairro: "", cidade: "Cabo Frio", uf: "RJ", ...e } });
confere("rua e bairro da cidade da loja: nada a dizer", avisoDoCep(achou({ rua: "Rua do Forno", bairro: "Jardim Esperança" }), "CABO FRIO") === "");
confere("CEP de outra cidade: diz qual", /São Pedro da Aldeia-RJ/.test(avisoDoCep(achou({ rua: "Rua A", bairro: "B", cidade: "São Pedro da Aldeia" }), "Cabo Frio")));
confere("CEP da cidade toda: pede rua e bairro", /cidade toda/.test(avisoDoCep(achou({}), "Cabo Frio")));
confere("só o bairro: pede a rua", /Preencha a rua/.test(avisoDoCep(achou({ bairro: "Centro" }), "Cabo Frio")));
confere("não existe", /não encontrado/.test(avisoDoCep({ ok: false, motivo: "nao-existe" })));
confere("não respondeu", /Não consegui consultar/.test(avisoDoCep({ ok: false, motivo: "falhou" })));
confere("incompleto não diz nada", avisoDoCep({ ok: false, motivo: "incompleto" }) === "");
confere("loja sem cidade cadastrada: não acusa 'outra cidade'", avisoDoCep(achou({ rua: "R", bairro: "B", cidade: "Macaé" }), "") === "");

// ── A consulta (fetch simulado) ──────────────────────────────────────────
const responde = (status: number, corpo: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

async function consultas() {
  let urlPedida = "";
  const espiao = (async (u: unknown) => { urlPedida = String(u); return new Response(JSON.stringify(cabofrio), { status: 200 }); }) as unknown as typeof fetch;
  const a = await buscarCep("28905-080", { fetch: espiao });
  confere("pergunta ao ViaCEP só com os dígitos", urlPedida === "https://viacep.com.br/ws/28905080/json/", urlPedida);
  confere("devolve o endereço", a.ok && a.endereco.rua === "Rua do Forno" && a.endereco.bairro === "Jardim Esperança", a);
  confere("7 dígitos nem pergunta", (await buscarCep("2890508", { fetch: responde(200, cabofrio) })).ok === false);
  const b = await buscarCep("00000000", { fetch: responde(200, { erro: "true" }) });
  confere("CEP inexistente", !b.ok && b.motivo === "nao-existe", b);
  const c = await buscarCep("28905080", { fetch: responde(400, {}) });
  confere("400 (mal formado) é 'não existe'", !c.ok && c.motivo === "nao-existe", c);
  const d = await buscarCep("28905080", { fetch: responde(503, {}) });
  confere("503 é 'não respondeu'", !d.ok && d.motivo === "falhou", d);
  const e = await buscarCep("28905080", { fetch: (async () => { throw new Error("rede"); }) as unknown as typeof fetch });
  confere("rede caiu: não lança, 'não respondeu'", !e.ok && e.motivo === "falhou", e);
  const lento = (async (_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_, rejeita) => init?.signal?.addEventListener("abort", () => rejeita(new Error("abortado"))))) as unknown as typeof fetch;
  const f = await buscarCep("28905080", { fetch: lento, prazoMs: 30 });
  confere("ViaCEP pendurado: desiste no prazo", !f.ok && f.motivo === "falhou", f);

  if (process.argv.includes("--rede")) {
    const real = await buscarCep("28905080");
    console.log("ViaCEP de verdade (28905-080):", JSON.stringify(real));
    confere("rede: o ViaCEP responde com cidade", real.ok && !!real.endereco.cidade, real);
  }
}

consultas()
  .catch((e) => { falhas++; console.log("✖ estourou", e); })
  .finally(() => {
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
  });
