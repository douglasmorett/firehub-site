/**
 * A resposta do Google lida para a cotação (src/lib/geocodificacao-google.ts).
 * Formato: https://developers.google.com/maps/documentation/geocoding/requests-geocoding
 *
 *   npx tsx scripts/teste-geocodificacao-google.ts
 */
import { lerRespostaDoGoogle } from "../src/lib/geocodificacao-google";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` — ${JSON.stringify(detalhe)}` : ""}`); }
}

const comp = (long_name: string, ...types: string[]) => ({ long_name, short_name: long_name, types });
function resultado(o: { tipoDoPonto: string; tipos: string[]; numero?: string; rua?: string; bairro?: string; cidade?: string; parcial?: boolean }) {
  return {
    status: "OK",
    results: [
      {
        formatted_address: [o.rua, o.numero, o.bairro, o.cidade].filter(Boolean).join(", "),
        geometry: { location: { lat: -22.8371, lng: -42.033 }, location_type: o.tipoDoPonto },
        types: o.tipos,
        ...(o.parcial ? { partial_match: true } : {}),
        address_components: [
          ...(o.numero ? [comp(o.numero, "street_number")] : []),
          ...(o.rua ? [comp(o.rua, "route")] : []),
          ...(o.bairro ? [comp(o.bairro, "sublocality_level_1", "sublocality", "political")] : []),
          comp(o.cidade || "Cabo Frio", "administrative_area_level_2", "political"),
          comp("Rio de Janeiro", "administrative_area_level_1", "political"),
          comp("Brasil", "country", "political"),
        ],
      },
    ],
  };
}

const casa = lerRespostaDoGoogle(resultado({ tipoDoPonto: "ROOFTOP", tipos: ["street_address"], numero: "130", rua: "Travessa Pantanal", bairro: "Jardim Esperança" }), "Cabo Frio");
confere("número no telhado → a CASA", casa.ok && casa.valor?.precisao === "endereco" && casa.valor.rua === "Travessa Pantanal" && casa.valor.bairro === "Jardim Esperança", casa);

const interpolado = lerRespostaDoGoogle(resultado({ tipoDoPonto: "RANGE_INTERPOLATED", tipos: ["street_address"], numero: "130", rua: "Rua do Forno", bairro: "Jardim Esperança" }), "Cabo Frio");
confere("número interpolado entre números → a casa também", interpolado.ok && interpolado.valor?.precisao === "endereco");

const parcial = lerRespostaDoGoogle(resultado({ tipoDoPonto: "RANGE_INTERPOLATED", tipos: ["street_address"], numero: "130", rua: "Rua do Forno", parcial: true }), "Cabo Frio");
confere("casou só em parte → vale como RUA, não como casa", parcial.ok && parcial.valor?.precisao === "rua", parcial);

const rua = lerRespostaDoGoogle(resultado({ tipoDoPonto: "GEOMETRIC_CENTER", tipos: ["route"], rua: "Rua do Forno", bairro: "Jardim Esperança" }), "Cabo Frio");
confere("meio da rua → RUA", rua.ok && rua.valor?.precisao === "rua");

const bairro = lerRespostaDoGoogle(resultado({ tipoDoPonto: "APPROXIMATE", tipos: ["sublocality_level_1", "sublocality", "political"], bairro: "Jardim Esperança" }), "Cabo Frio");
confere("só o bairro → BAIRRO", bairro.ok && bairro.valor?.precisao === "bairro");

const cidade = lerRespostaDoGoogle(resultado({ tipoDoPonto: "APPROXIMATE", tipos: ["locality", "political"] }), "Cabo Frio");
confere("só a cidade não é ponto de entrega", cidade.ok && cidade.valor === null);

const outraCidade = lerRespostaDoGoogle(resultado({ tipoDoPonto: "ROOFTOP", tipos: ["street_address"], numero: "5", rua: "Rua das Flores", cidade: "São Pedro da Aldeia" }), "Cabo Frio");
confere("casa em OUTRA cidade é homônimo: não vale", outraCidade.ok && outraCidade.valor === null);

const municipio = lerRespostaDoGoogle(resultado({ tipoDoPonto: "ROOFTOP", tipos: ["street_address"], numero: "5", rua: "Rua A", cidade: "Município de Cabo Frio" }), "Cabo Frio");
confere("'Município de Cabo Frio' é Cabo Frio", municipio.ok && municipio.valor?.precisao === "endereco");

confere("sem resultado → não achou (não é erro)", (() => { const r = lerRespostaDoGoogle({ status: "ZERO_RESULTS", results: [] }, "Cabo Frio"); return r.ok && r.valor === null; })());
const negado = lerRespostaDoGoogle({ status: "REQUEST_DENIED", error_message: "The provided API key is invalid." }, "Cabo Frio");
confere("chave recusada → não deu para perguntar, com o motivo", !negado.ok && /REQUEST_DENIED/.test(negado.motivo), negado);
confere("cota estourada → não deu para perguntar", !lerRespostaDoGoogle({ status: "OVER_QUERY_LIMIT" }, "Cabo Frio").ok);
confere("resposta vazia → não deu para perguntar", !lerRespostaDoGoogle(null, "Cabo Frio").ok);

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
