import DadosSensiveisClient from "./DadosSensiveisClient";
import { acessoAoRelatorio } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Dados sensíveis" };

/**
 * /store/dados-sensiveis — CMV real, CMO e custo primário da loja.
 * O funcionário só chega aqui com a caixinha "Dados sensíveis" (proxy +
 * lib/permissao-da-tela.ts); a rota da API confere de novo (lib/cmv/acesso.ts).
 */
export default async function DadosSensiveisPage() {
  const { hoje, nomeDaLoja } = await acessoAoRelatorio();
  return <DadosSensiveisClient hoje={hoje} nomeDaLoja={nomeDaLoja} />;
}
