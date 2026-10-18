/**
 * Uma cidade FALSA para testar a varredura sem gastar o Google
 * (scripts/teste-varredura.ts). Lugares concentrados no centro, uma praça
 * de alimentação com 30 no mesmo ponto e o resto espalhado — e o Nearby
 * Search falso, que se comporta como o de verdade: círculo, tipos, no
 * máximo 20, os mais populares primeiro, sem página seguinte.
 */
import { metrosEntre } from "../src/lib/prospeccao/regras";

export type LugarFalso = {
  id: string;
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
  tipos: string[];
  popularidade: number;
  fechado?: boolean;
};

const TIPOS = [
  "pizza_restaurant", "hamburger_restaurant", "fast_food_restaurant", "snack_bar", "bakery", "acai_shop", "bar",
  "japanese_restaurant", "brazilian_restaurant", "ice_cream_shop", "cafe", "sandwich_shop", "barbecue_restaurant",
  "seafood_restaurant", "chinese_restaurant", "dessert_shop", "meal_delivery", "chicken_restaurant",
];
const NOMES = ["Pizzaria", "Lanchonete", "Hamburgueria", "Açaí", "Restaurante", "Bar", "Padaria", "Sushi", "Espetinho", "Sorveteria"];
const SOBRENOMES = ["do Zé", "Bella", "Sabor da Praia", "da Esquina", "Boa Mesa", "do Porto", "Família", "Central", "da Vila", "Ostras"];

/** 1 m em graus de latitude. */
const GRAU = 1 / 111_320;

export function cidadeFalsa(o: { centro: { lat: number; lng: number }; total?: number; semente?: number; pracaDeAlimentacao?: number }): LugarFalso[] {
  const total = o.total ?? 600;
  const praca = o.pracaDeAlimentacao ?? 30;
  let semente = o.semente ?? 42;
  const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const cos = Math.cos((o.centro.lat * Math.PI) / 180);
  const saida: LugarFalso[] = [];
  for (let i = 0; i < total; i++) {
    let dy: number, dx: number;
    if (i < praca) { dy = gauss() * 5; dx = gauss() * 5; } // o shopping: todos no mesmo ponto
    else if (i < total * 0.6) { dy = gauss() * 400; dx = gauss() * 400; } // o centro
    else if (i < total * 0.88) { dy = gauss() * 1500; dx = gauss() * 1500; } // os bairros
    else { dy = (rnd() - 0.5) * 9000; dx = (rnd() - 0.5) * 9000; } // a beira da cidade
    const tipo = TIPOS[Math.floor(rnd() * TIPOS.length)];
    // Na praça de alimentação o tipo é só o da loja (o "food_court" é o shopping, não cada loja).
    const tipos = i < praca ? [tipo] : rnd() < 0.6 ? [tipo, "restaurant"] : [tipo];
    saida.push({
      id: `ChIJfalso${String(i).padStart(5, "0")}`,
      nome: `${NOMES[Math.floor(rnd() * NOMES.length)]} ${SOBRENOMES[Math.floor(rnd() * SOBRENOMES.length)]} ${i}`,
      endereco: `Rua ${1 + Math.floor(rnd() * 80)}, ${10 + Math.floor(rnd() * 900)} - Centro`,
      lat: o.centro.lat + dy * GRAU,
      lng: o.centro.lng + (dx * GRAU) / cos,
      tipos,
      popularidade: rnd(),
      fechado: i % 97 === 50,
    });
  }
  return saida;
}

/** O Nearby Search (New) falso: dentro do círculo, de um dos tipos, os 20 mais populares (ou os mais perto, com DISTANCE). */
export function nearbyFalso(
  cidade: LugarFalso[],
  pedido: { centro: { lat: number; lng: number }; raio: number; tipos: string[]; maximo: number; porDistancia?: boolean },
): LugarFalso[] {
  const tipos = new Set(pedido.tipos);
  return cidade
    .filter((l) => l.tipos.some((t) => tipos.has(t)) && metrosEntre(pedido.centro, l) <= pedido.raio)
    .sort((a, b) => (pedido.porDistancia ? metrosEntre(pedido.centro, a) - metrosEntre(pedido.centro, b) : b.popularidade - a.popularidade))
    .slice(0, pedido.maximo);
}
