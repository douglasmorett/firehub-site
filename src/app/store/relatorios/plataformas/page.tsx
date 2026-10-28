import PlataformasClient from "./PlataformasClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function PlataformasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <PlataformasClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
