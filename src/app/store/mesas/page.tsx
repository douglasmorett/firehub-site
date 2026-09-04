/**
 * /store/mesas — módulo de mesa visto pelo painel (dono, funcionário, admin).
 *
 * A tela em si mora em src/components/mesas/MesasApp.tsx porque o garçom a
 * usa também, pelo link próprio (/garcom/<slug>/mesas), sem o resto do painel.
 */
import MesasApp from "@/components/mesas/MesasApp";

export default function MesasPage() {
  return <MesasApp modo="loja" />;
}
