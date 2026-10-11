/**
 * Quem vê o anúncio do Tráfego pago — a mesma regra na tela e no servidor.
 *
 * O lojista que não entende de Facebook escolhe três coisas, em português:
 * até onde (raio em volta da loja), que idade e que gênero. O resto da
 * segmentação da Meta (interesses, posicionamentos, públicos personalizados)
 * fica de fora de propósito: para delivery de bairro quem decide é a
 * distância, e cada opção a mais é um jeito novo de errar.
 *
 * O CENTRO é sempre a loja. Não há pino para arrastar: anúncio de delivery
 * centrado em outro lugar só paga clique de quem não recebe o pedido.
 *
 * Arquivo puro (sem Prisma, sem fetch) porque a tela importa as mesmas
 * listas que o servidor valida — opção que só existe de um lado é o tipo de
 * divergência que faz a tela mostrar uma coisa e a Meta veicular outra.
 */

export const RAIO_MINIMO_KM = 1;
export const RAIO_MAXIMO_KM = 50;
/** Quando a loja entrega por bairro (sem raio) e o lojista não mexeu. */
export const RAIO_PADRAO_KM = 3;

export type FaixaDeIdade = "todas" | "18-34" | "25-54" | "35+";
export type GeneroDoPublico = "todos" | "mulheres" | "homens";

/**
 * 65 na Meta quer dizer "65 ou mais". "todas" é o padrão e o recomendado:
 * deixa o Facebook achar quem mais pede.
 */
export const FAIXAS_DE_IDADE: Record<FaixaDeIdade, { rotulo: string; detalhe: string; min: number; max: number }> = {
  todas: { rotulo: "Todas as idades", detalhe: "18 anos ou mais", min: 18, max: 65 },
  "18-34": { rotulo: "Jovens", detalhe: "18 a 34 anos", min: 18, max: 34 },
  "25-54": { rotulo: "Adultos", detalhe: "25 a 54 anos", min: 25, max: 54 },
  "35+": { rotulo: "35 ou mais", detalhe: "35 anos ou mais", min: 35, max: 65 },
};

/** Códigos da Meta: 1 = homens, 2 = mulheres; sem `genders` = todos. */
export const GENEROS: Record<GeneroDoPublico, { rotulo: string; codigos: number[] | null }> = {
  todos: { rotulo: "Todos", codigos: null },
  mulheres: { rotulo: "Mulheres", codigos: [2] },
  homens: { rotulo: "Homens", codigos: [1] },
};

export type PublicoDoAnuncio = {
  radiusKm: number;
  faixaDeIdade: FaixaDeIdade;
  genero: GeneroDoPublico;
};

/**
 * Coordenada da loja, tolerante ao formato.
 *
 * `storeLatLng` é Json? e o único escritor é o mapa de zona de entrega, mas
 * geocoding.ts registra que o campo pode ter sido gravado como STRING JSON em
 * dados antigos. Lido só como objeto, `?.lat` dava undefined e a campanha caía
 * no fallback mesmo para quem tinha preenchido o mapa.
 */
export function lerCoordenadaDaLoja(valor: unknown): { lat: number; lng: number } | null {
  let bruto: any = valor;
  if (typeof bruto === "string") {
    try {
      bruto = JSON.parse(bruto);
    } catch {
      return null;
    }
  }
  const lat = Number(bruto?.lat);
  const lng = Number(bruto?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // (0,0) é o Atlântico: dado de teste, não loja.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Maior raio que a loja realmente entrega, a partir das zonas já desenhadas
 * em Minha Loja. Zonas por bairro não têm raio — nesse caso devolve null e o
 * chamador usa o padrão.
 */
export function raioDasZonasDeEntrega(zonas: unknown): number | null {
  if (!Array.isArray(zonas)) return null;
  const raios = zonas
    .map((z: any) => Number(z?.km ?? z?.radius))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!raios.length) return null;
  return Math.max(...raios);
}

/** Raio que a tela já mostra marcado: a área de entrega da loja, em km inteiros. */
export function raioSugerido(zonas: unknown): number {
  const bruto = raioDasZonasDeEntrega(zonas) ?? RAIO_PADRAO_KM;
  return Math.min(RAIO_MAXIMO_KM, Math.max(RAIO_MINIMO_KM, Math.ceil(bruto)));
}

/**
 * Segmentação que vai para o conjunto de anúncios da Meta.
 *
 * `advantage_audience` é OBRIGATÓRIO desde a v23 ao criar conjunto: sem ele a
 * Meta assume 1, e com 1 ela recusa idade máxima abaixo de 65 e idade mínima
 * acima de 25 ("setup is not either default or relaxed"). Por isso:
 *   - público aberto (todas as idades, todos os gêneros) → 1: a Meta acha
 *     sozinha quem pede, dentro do raio — o local nunca é relaxado;
 *   - o lojista restringiu idade ou gênero → 0: ele pediu um público e é esse
 *     público que veicula, sem a Meta "expandir" por cima da escolha dele.
 */
export function segmentacaoDaMeta(
  publico: PublicoDoAnuncio,
  centro: { lat: number; lng: number },
) {
  const idade = FAIXAS_DE_IDADE[publico.faixaDeIdade] ?? FAIXAS_DE_IDADE.todas;
  const genero = GENEROS[publico.genero] ?? GENEROS.todos;
  const publicoAberto = publico.faixaDeIdade === "todas" && publico.genero === "todos";
  return {
    geo_locations: {
      custom_locations: [{
        latitude: centro.lat,
        longitude: centro.lng,
        radius: publico.radiusKm,
        distance_unit: "kilometer",
      }],
    },
    age_min: idade.min,
    age_max: idade.max,
    ...(genero.codigos ? { genders: genero.codigos } : {}),
    targeting_automation: { advantage_audience: publicoAberto ? 1 : 0 },
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "story"],
    instagram_positions: ["stream", "story"],
  };
}

/** Frase do resumo: "Até 5 km da loja · todas as idades · todos". */
export function descreverPublico(publico: PublicoDoAnuncio): string {
  const idade = FAIXAS_DE_IDADE[publico.faixaDeIdade] ?? FAIXAS_DE_IDADE.todas;
  const genero = GENEROS[publico.genero] ?? GENEROS.todos;
  const quem = publico.genero === "todos" ? "homens e mulheres" : genero.rotulo.toLowerCase();
  return `Até ${publico.radiusKm} km da loja · ${idade.detalhe} · ${quem}`;
}
