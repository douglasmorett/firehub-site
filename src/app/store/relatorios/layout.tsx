/**
 * Todo relatório leva no PDF o logo e o nome da loja (o padrão de PDF de
 * components/relatorios/ModeloDoRelatorio.tsx). Os dois vêm daqui, uma vez,
 * para a moldura — sem passar por cada página e cada tela. A consulta é a
 * mesma da página (`acessoAoRelatorio` tem `cache`): não pesa nada a mais.
 */
import { acessoAoRelatorio } from "@/lib/relatorios/pagina";
import { LojaDoRelatorio } from "@/components/relatorios/ModeloDoRelatorio";

export default async function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  const { nomeDaLoja, logo, fuso } = await acessoAoRelatorio();
  return <LojaDoRelatorio loja={{ nomeDaLoja, logo, fuso }}>{children}</LojaDoRelatorio>;
}
