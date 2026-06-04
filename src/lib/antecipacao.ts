export type BaseFlavor = 'carne' | 'calabresa' | 'queijo' | 'queijo temperado' | 'quatro queijos' | 'massa vazia' | 'outros';

export const BASE_FLAVORS_LABELS: Record<BaseFlavor, string> = {
  carne: "Carne",
  calabresa: "Calabresa",
  queijo: "Queijo",
  "queijo temperado": "Queijo Temperado",
  "quatro queijos": "Quatro Queijos",
  "massa vazia": "Massa Vazia (Doces)",
  outros: "Outros"
};

export function classifyProduct(name: string): BaseFlavor {
  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remove accents

  if (normalized.includes("quatro queijos") || normalized.includes("4 queijos")) {
    return "quatro queijos";
  }
  if (normalized.includes("queijo temperado") || normalized.includes("q. temperado")) {
    return "queijo temperado";
  }
  if (
    normalized.includes("queijo") ||
    normalized.includes("mussarela") ||
    normalized.includes("mucarela") ||
    normalized.includes("margherita") ||
    normalized.includes("marguerita") ||
    normalized.includes("napolitana")
  ) {
    return "queijo";
  }
  if (normalized.includes("carne")) {
    return "carne";
  }
  if (normalized.includes("calabresa") || normalized.includes("calabres")) {
    return "calabresa";
  }
  // Sweet esfihas use "massa vazia"
  if (
    normalized.includes("chocolate") ||
    normalized.includes("doce") ||
    normalized.includes("brigadeiro") ||
    normalized.includes("nutella") ||
    normalized.includes("ninho") ||
    normalized.includes("banana") ||
    normalized.includes("romeu") ||
    normalized.includes("vazia") ||
    normalized.includes("massa") ||
    normalized.includes("morango") ||
    normalized.includes("beijinho") ||
    normalized.includes("ovomaltine") ||
    normalized.includes("sensacao")
  ) {
    return "massa vazia";
  }

  return "outros";
}
