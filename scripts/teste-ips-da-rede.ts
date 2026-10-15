/**
 * Os IPs que o supervisor da contingência manda no relato (o bilhete leva
 * nessa ordem, e a TV e o service worker vão só para o PRIMEIRO):
 * contingencia/supervisor/config.ts → escolherIpsDaRede.
 *
 *   npx tsx scripts/teste-ips-da-rede.ts
 */
import { escolherIpsDaRede, faixaDeVpn, ipsDaRede } from "../contingencia/supervisor/config";

let falhas = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` → ${JSON.stringify(obtido)} (esperado ${JSON.stringify(esperado)})`}`);
}

const v4 = (address: string) => ({ family: "IPv4", internal: false, address });

// Um PC de caixa "cheio": Wi-Fi da loja, Hyper-V/WSL, VirtualBox, Tailscale, Radmin, sem DHCP e loopback.
const placas = {
  "vEthernet (WSL)": [v4("172.25.48.1")],
  "VirtualBox Host-Only Network": [v4("192.168.56.1")],
  Tailscale: [v4("100.101.2.3")],
  "Radmin VPN": [v4("26.10.20.30")],
  "Ethernet 3": [v4("169.254.83.107")],
  "Loopback Pseudo-Interface 1": [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
  "Wi-Fi": [{ family: "IPv6", internal: false, address: "fe80::1" }, v4("192.168.15.106")],
};

confere("sem rota conhecida: só a rede da loja, sem virtual nem VPN", escolherIpsDaRede(placas, null), ["192.168.15.106"]);
confere("com a rota padrão: ela primeiro", escolherIpsDaRede(placas, "192.168.15.106"), ["192.168.15.106"]);
confere(
  "duas placas de verdade: a da rota primeiro, mesmo vindo depois",
  escolherIpsDaRede({ Ethernet: [v4("10.0.0.5")], "Wi-Fi": [v4("192.168.0.20")] }, "10.0.0.5"),
  ["10.0.0.5", "192.168.0.20"],
);
confere(
  "sem rota: 192.168 antes de 10 antes de 172.16",
  escolherIpsDaRede({ A: [v4("172.16.0.9")], B: [v4("10.1.1.1")], C: [v4("192.168.1.50")] }, null),
  ["192.168.1.50", "10.1.1.1", "172.16.0.9"],
);
confere(
  "switch externo do Hyper-V: o IP da loja numa vEthernet vale se for a rota",
  escolherIpsDaRede({ "vEthernet (Externa)": [v4("192.168.1.30")], "vEthernet (WSL)": [v4("172.20.0.1")] }, "192.168.1.30"),
  ["192.168.1.30", "172.20.0.1"],
);
confere("rota padrão pela VPN (túnel cheio): não vale", escolherIpsDaRede({ Tailscale: [v4("100.64.0.7")], "Wi-Fi": [v4("192.168.1.30")] }, "100.64.0.7"), [
  "192.168.1.30",
]);
confere("só VPN: nenhum endereço (a TV não pula para onde não alcança)", escolherIpsDaRede({ Tailscale: [v4("100.64.0.7")] }, null), []);
confere("família numérica (Node 18.0-18.3)", escolherIpsDaRede({ Ethernet: [{ family: 4, internal: false, address: "192.168.2.2" }] }, null), [
  "192.168.2.2",
]);
confere("faixas de VPN", [faixaDeVpn("100.64.0.1"), faixaDeVpn("100.127.255.1"), faixaDeVpn("100.128.0.1"), faixaDeVpn("26.1.1.1"), faixaDeVpn("192.168.1.1")], [
  true,
  true,
  false,
  true,
  false,
]);

// Neste PC de verdade: a função não quebra e não devolve nada de VPN/sem DHCP.
const aqui = ipsDaRede();
confere("neste PC: só IPv4 que a TV alcança", aqui.every((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith("169.254.") && !faixaDeVpn(ip)), true);
setTimeout(() => {
  console.log(`     neste PC agora: ${ipsDaRede().join(", ") || "sem rede"}`);
  console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
  process.exit(falhas ? 1 : 0);
}, 300);
