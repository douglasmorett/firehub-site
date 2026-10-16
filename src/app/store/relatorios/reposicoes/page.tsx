import ReposicoesClient from "./ReposicoesClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function ReposicoesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <ReposicoesClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
