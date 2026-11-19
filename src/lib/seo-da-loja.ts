/**
 * Os dados estruturados (JSON-LD) do cardápio público /loja/<slug>: a loja
 * como FoodEstablishment e o cardápio como Menu, com os dados que a própria
 * página já mostra. Só leitura — nada aqui mexe no pedido.
 *
 * - Endereço só quando a loja mostra o endereço no cardápio (showAddressOnMenu):
 *   loja que trabalha de casa esconde, e o Google não pode ser o vazamento.
 * - Horário só quando a loja salvou um (sem storeHours, o painel mostra o
 *   padrão 18h–23h, que não é dela).
 * - Sem nota/avaliações: o Google não aceita a nota que a loja coleta sobre si.
 */
import { normalizeStoreHours } from "@/lib/store-hours";
import { SITE } from "@/lib/seo";

/** Teto de itens no JSON-LD: o HTML do cardápio é a página que vende, não pode engordar sem fim. */
const MAXIMO_DE_ITENS = 100;

const DIAS_SCHEMA = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const absoluta = (url: unknown): string | null => {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith("/")) return `${SITE}${url}`;
  return /^https:\/\//.test(url) ? url : null;
};

function horarios(storeHours: unknown) {
  const vazio = storeHours == null || storeHours === "" || (Array.isArray(storeHours) && storeHours.length === 0);
  if (vazio) return undefined;
  const dias = normalizeStoreHours(storeHours);
  const lista = dias.flatMap((d, i) =>
    d.active === false
      ? []
      : (d.shifts || [])
          .filter((s) => s.active !== false && /^\d{2}:\d{2}$/.test(s.open) && /^\d{2}:\d{2}$/.test(s.close))
          .map((s) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: DIAS_SCHEMA[i], opens: s.open, closes: s.close })),
  );
  return lista.length ? lista : undefined;
}

type Loja = {
  storeName?: string | null;
  name?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  storeLogo?: string | null;
  storeBanner?: string | null;
  storeHours?: unknown;
  city?: string | null;
  showAddressOnMenu?: boolean | null;
};

type Produto = { name?: string; description?: string | null; price?: number | string | null; imageUrl?: string | null; category?: string | null };

export function dadosEstruturadosDaLoja(loja: Loja, produtos: Produto[], url: string) {
  const nome = loja.storeName || loja.name || "Loja";
  const imagens = [absoluta(loja.storeLogo), absoluta(loja.storeBanner)].filter((x): x is string => !!x);

  // Seções na ordem em que a página mostra (a lista já vem ordenada do banco).
  const secoes = new Map<string, unknown[]>();
  for (const p of produtos.slice(0, MAXIMO_DE_ITENS)) {
    if (!p?.name) continue;
    const preco = Number(p.price);
    const item: Record<string, unknown> = { "@type": "MenuItem", name: p.name };
    if (p.description) item.description = String(p.description).slice(0, 300);
    const foto = absoluta(p.imageUrl);
    if (foto) item.image = foto;
    // Preço 0 é o "a partir de" do combo/pizza montada: sem preço em vez de R$ 0,00.
    if (Number.isFinite(preco) && preco > 0) item.offers = { "@type": "Offer", price: preco.toFixed(2), priceCurrency: "BRL" };
    const cat = p.category || "Cardápio";
    if (!secoes.has(cat)) secoes.set(cat, []);
    secoes.get(cat)!.push(item);
  }

  const mostraEndereco = loja.showAddressOnMenu !== false;
  const endereco =
    mostraEndereco && (loja.storeAddress || loja.city)
      ? {
          "@type": "PostalAddress",
          ...(loja.storeAddress ? { streetAddress: loja.storeAddress } : {}),
          ...(loja.city ? { addressLocality: loja.city } : {}),
          addressCountry: "BR",
        }
      : undefined;

  const funcionamento = horarios(loja.storeHours);

  return {
    "@context": "https://schema.org",
    "@type": "FoodEstablishment",
    "@id": `${url}#loja`,
    name: nome,
    url,
    ...(imagens.length ? { image: imagens } : {}),
    ...(loja.storePhone ? { telephone: loja.storePhone } : {}),
    ...(endereco ? { address: endereco } : {}),
    ...(funcionamento ? { openingHoursSpecification: funcionamento } : {}),
    hasMenu: {
      "@type": "Menu",
      name: `Cardápio ${nome}`,
      url,
      inLanguage: "pt-BR",
      hasMenuSection: [...secoes].map(([cat, itens]) => ({ "@type": "MenuSection", name: cat, hasMenuItem: itens })),
    },
  };
}
