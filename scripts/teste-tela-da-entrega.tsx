/**
 * A tela de Entrega (src/components/customer/DeliveryZoneMap.tsx) renderizada
 * no servidor — sem navegador e sem Leaflet: o renderToStaticMarkup roda os
 * inicializadores de estado (é ali que o cadastro gravado é lido) e não roda
 * efeito nenhum (GET, mapa).
 *
 *   npx tsx scripts/teste-tela-da-entrega.tsx
 *
 * Trava o defeito da revisão do cluster D (25/09/2026): `deliveryZones`
 * gravado como TEXTO JSON — que o motor lê (lib/area-de-entrega.ts, zonas()) —
 * abria a tela com as faixas/bairros de EXEMPLO, e o primeiro Salvar os
 * gravava por cima do cadastro real.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DeliveryZoneMap from "../src/components/customer/DeliveryZoneMap";

// O `<style jsx global>` sem o compilador do Next vira atributo solto no SSR:
// o React reclama, e não é o que se testa aqui.
const erroOriginal = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("non-boolean attribute")) return;
  erroOriginal(...args);
};

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe).slice(0, 400)}` : ""}`); }
}

const LOJA = { lat: -22.854033, lng: -42.0296526 };
const html = (zonas: unknown, tipo: string) =>
  renderToStaticMarkup(
    <DeliveryZoneMap initialAddress="Tv Liberdade 11" initialLatLng={LOJA} initialZones={zonas} zoneType={tipo} onSave={async () => {}} />,
  );
/** O valor dos campos com este aria-label, na ordem da tela. */
const valores = (h: string, rotulo: string) =>
  [...h.matchAll(/<input[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes(`aria-label="${rotulo}"`))
    .map((tag) => tag.match(/value="([^"]*)"/)?.[1] ?? "");
const temAvisoDeIlegivel = (h: string) => h.includes("data-cadastro-ilegivel");

// ── Faixas da Divinos (ROTA) em lista e em TEXTO: a mesma tela ─────────────
const FAIXAS = [
  { km: 1, fee: 5, time: 30, motoboyFee: 4 },
  { km: 1.5, fee: 8, time: 30, motoboyFee: 7 },
  { km: 2, fee: 10, time: 35, motoboyFee: 9 },
];
{
  const lista = valores(html(FAIXAS, "ROTA"), "Até quantos km");
  const texto = valores(html(JSON.stringify(FAIXAS), "ROTA"), "Até quantos km");
  confere("ROTA em lista: as 3 faixas da loja", JSON.stringify(lista) === JSON.stringify(["1", "1,5", "2"]), lista);
  confere("ROTA em TEXTO: as mesmas 3 faixas (antes: 1/3/5 km de exemplo)", JSON.stringify(texto) === JSON.stringify(["1", "1,5", "2"]), texto);
  confere("ROTA em texto: sem aviso de ilegível", !temAvisoDeIlegivel(html(JSON.stringify(FAIXAS), "ROTA")));
}

// ── Bairros em TEXTO ───────────────────────────────────────────────────────
{
  const BAIRROS = [{ name: "Centro", fee: 6, time: 30 }, { name: "Braga", fee: 8, time: 40 }, { name: "Passagem", fee: 7, time: 35 }];
  const nomes = valores(html(JSON.stringify(BAIRROS), "NEIGHBORHOOD"), "Nome do bairro");
  confere("bairros em TEXTO: Centro/Braga/Passagem (antes: Centro/Bairro Vizinho de exemplo)",
    JSON.stringify(nomes) === JSON.stringify(["Centro", "Braga", "Passagem"]), nomes);
  const semTipo = valores(html(JSON.stringify(BAIRROS), "KM"), "Nome do bairro");
  confere("bairros em texto com o tipo padrão KM: a tela reconhece bairro (mesma leitura do motor)",
    JSON.stringify(semTipo) === JSON.stringify(["Centro", "Braga", "Passagem"]), semTipo);
}

// ── Área desenhada com o contorno em TEXTO ─────────────────────────────────
{
  const AREA = [{ nome: "Centro", fee: 5, time: 30, pontos: JSON.stringify([[-22.85, -42.02], [-22.86, -42.02], [-22.86, -42.03], [-22.85, -42.03]]) }];
  const h = html(AREA, "POLIGONO");
  confere("área com contorno em texto: aparece na lista (não some no próximo Salvar)", /Áreas desenhadas \((?:<!-- -->)?1\)/.test(h), h.match(/Áreas desenhadas[^<]*(<!-- -->)?[^<]*/)?.[0]);
  const h2 = html(JSON.stringify(AREA), "POLIGONO");
  confere("cadastro inteiro em texto com contorno em texto: também", /Áreas desenhadas \((?:<!-- -->)?1\)/.test(h2));
}

// ── Cadastro ilegível: abre com o exemplo, mas AVISA ───────────────────────
{
  const h = html("Centro R$5; Braga R$8", "NEIGHBORHOOD");
  confere("texto que não é JSON: aviso na tela", temAvisoDeIlegivel(h) && h.includes("Não consegui ler o cadastro de entrega gravado"));
  const h2 = html({ Centro: 5 }, "KM");
  confere("objeto solto: aviso na tela", temAvisoDeIlegivel(h2));
}

// ── Loja sem cadastro: exemplo, sem alarme ─────────────────────────────────
{
  const h = html(null, "KM");
  confere("loja nova: sem aviso de ilegível", !temAvisoDeIlegivel(h));
  const kms = valores(h, "Até quantos km");
  confere("loja nova: a tabela de exemplo 1/3/5 km", JSON.stringify(kms) === JSON.stringify(["1", "3", "5"]), kms);
  confere("loja nova com [] e {}: sem aviso", !temAvisoDeIlegivel(html([], "KM")) && !temAvisoDeIlegivel(html({}, "KM")));
}

console.log(`\n${ok} ok, ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
