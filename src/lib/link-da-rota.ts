/**
 * O link do Google Maps com as paradas da rota — o mesmo no botão COPIAR da
 * roteirização e no WhatsApp que o despacho manda ao motoboy.
 *
 * Sem ponto de partida: o Maps começa de onde o celular está, e o motoboy abre
 * o link na porta da loja. O WhatsApp do despacho partia de "Rio das Ostras,
 * RJ" fixo — na Frangoso (São Gonçalo) a rota abria a 150 km da loja, e era
 * por esse link que os motoboys dela saíam (13/10/2026). O COPIAR já fazia
 * certo; agora os dois saem daqui.
 *
 * Complemento e referência saem do endereço (o Maps não acha "apto 202"), e a
 * cidade da LOJA entra no fim quando o endereço não a traz — só se ela estiver
 * cadastrada: sem cidade, nada é colado (ver o histórico em RoteirizacaoModal).
 */
export function linkDaRotaNoMaps(enderecos: Array<string | null | undefined>, cidadeDaLoja?: string | null): string | null {
  const cidade = (cidadeDaLoja || "").trim();
  const paradas = enderecos
    .filter((e): e is string => !!e && !!e.trim())
    .map((e) => {
      const limpo = e
        .replace(/(-?\s*Comp(?:lemento)?:.*)/gi, "")
        .replace(/(-?\s*Ref(?:erencia)?:.*)/gi, "")
        .trim();
      const completo = !cidade || limpo.toLowerCase().includes(cidade.toLowerCase()) ? limpo : `${limpo}, ${cidade}`;
      return encodeURIComponent(completo);
    });
  if (paradas.length === 0) return null;
  if (paradas.length === 1) return `https://www.google.com/maps/dir/?api=1&destination=${paradas[0]}`;
  const ultima = paradas[paradas.length - 1];
  return `https://www.google.com/maps/dir/?api=1&destination=${ultima}&waypoints=${paradas.slice(0, -1).join("|")}`;
}
