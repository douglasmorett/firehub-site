/**
 * O mapa "Onde fica a sua casa?" (src/components/customer/ConfirmarPontoNoMapa.tsx)
 * renderizado no servidor — sem navegador e sem Leaflet (o mapa em si só nasce
 * no efeito, que o renderToStaticMarkup não roda). Trava o que o cliente LÊ e
 * o que ele pode apertar antes de tocar no mapa.
 *
 *   npx tsx scripts/teste-confirmar-ponto-no-mapa.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ConfirmarPontoNoMapa from "../src/components/customer/ConfirmarPontoNoMapa";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` → ${String(detalhe).slice(0, 400)}` : ""}`); }
}

const LOJA = { lat: -22.854033, lng: -42.0296526 };
const BAIRRO = { lat: -22.8518, lng: -42.0353 };
const nada = () => {};
const html = (p: Partial<React.ComponentProps<typeof ConfirmarPontoNoMapa>>) =>
  renderToStaticMarkup(
    <ConfirmarPontoNoMapa centro={LOJA} aoConfirmar={nada} aoFechar={nada} enderecoEscrito="Travessa Canaã 6, Boca do Mato" {...p} />,
  );
const botaoConfirmar = (h: string) => {
  const m = h.match(/<button[^>]*>(?:(?!<\/button>).)*(É aqui, confirmar|Toque no mapa onde você mora)<\/button>/);
  return m ? m[0] : "";
};

// Endereço não achado: o pino nasce na LOJA e o botão só libera depois do toque.
{
  const h = html({ motivo: "nao-achou" });
  confere("não achou: título", h.includes("Onde fica a sua casa?"));
  confere("não achou: explica que a distância decide a taxa", h.includes("Não achamos esse endereço no mapa") && h.includes("quanto custa"), h);
  const b = botaoConfirmar(h);
  confere("não achou: botão desabilitado até tocar (pino na loja não é a casa do cliente)", b.includes("disabled") && b.includes("Toque no mapa onde você mora"), b);
  confere("mostra o que o cliente escreveu", h.includes("Travessa Canaã 6, Boca do Mato"));
}

// Ponto aproximado (centro do bairro): abre no palpite, mas EXIGE o toque.
{
  const h = html({ motivo: "aproximado", pontoInicial: BAIRRO, exigirToque: true });
  confere("aproximado: texto do ponto aproximado", h.includes("ponto aproximado") && h.includes("distância até a sua porta"), h);
  const b = botaoConfirmar(h);
  confere("aproximado: confirmar o centro do bairro sem tocar NÃO é possível", b.includes("disabled"), b);
}

// GPS APROXIMADO ("Localização precisa" desligada, ~3 km): abre no ponto do
// aparelho, diz por quê, e o centro do círculo NÃO vira a casa sem o toque.
{
  const h = html({ motivo: "gps-aproximado", pontoInicial: BAIRRO, exigirToque: true, enderecoEscrito: "" });
  confere("GPS aproximado: título de 'onde fica a sua casa'", h.includes("Onde fica a sua casa?"));
  confere("GPS aproximado: explica que o celular deu só a localização aproximada",
    h.includes("localização aproximada") && h.includes("Localização precisa") && h.includes("toque no lugar exato"), h);
  const b = botaoConfirmar(h);
  confere("GPS aproximado: confirmar sem tocar NÃO é possível", b.includes("disabled"), b);
  confere("formulário vazio: não mostra 'Você escreveu' em branco", !h.includes("Você escreveu"));
}

// Conferir um ponto preciso: pode confirmar direto.
{
  const h = html({ motivo: "conferir", pontoInicial: BAIRRO, exigirToque: false });
  confere("conferir: título próprio", h.includes("O pino está na sua porta?"));
  const b = botaoConfirmar(h);
  confere("conferir: botão já liberado", !!b && !b.includes("disabled") && b.includes("É aqui, confirmar"), b);
}

// Compatibilidade: sem `exigirToque`, palpite libera e ausência de palpite trava (como antes).
{
  confere("padrão com palpite: liberado", !botaoConfirmar(html({ pontoInicial: BAIRRO })).includes("disabled"));
  confere("padrão sem palpite: travado", botaoConfirmar(html({})).includes("disabled"));
}

// Sem loja e sem palpite: não desenha nada.
confere("sem loja e sem palpite: não renderiza", html({ centro: null, pontoInicial: null }) === "");
// Sem pino da loja mas com palpite: abre no palpite.
confere("sem loja, com palpite: renderiza", html({ centro: null, pontoInicial: BAIRRO }).includes("Onde fica a sua casa?"));

console.log(`\n${ok} ok, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
