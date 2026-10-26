/**
 * PUT /api/integracoes/evopdv/config  (Authorization: Bearer <chave da loja>)
 *   { razaoSocial?, nomeFantasia?, inscricaoEstadual?, regimeTributario?, logradouro?, numero?, complemento?,
 *     bairro?, municipio?, codigoMunicipio?, uf?, cep?, telefone?, ambiente?: "homologacao"|"producao",
 *     serie?, numeroInicial?, qrVersao?: 2|3, contingenciaOffline?: boolean, pixEstatico?: boolean,
 *     csc?: { homologacao?: { id, codigo } | null, producao?: { id, codigo } | null } }
 *
 * Só os campos enviados mudam (lib/evopdv/conta → alterarConfigDaConta): o CSC
 * vai cifrado, série e número inicial não mudam depois da primeira nota, e o
 * ambiente não muda com nota em andamento.
 */
import { alterarConfigDaConta } from "@/lib/evopdv/conta";
import { comConta, corpoJson } from "@/lib/evopdv/rota";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  return comConta(req, "config", async (conta) => alterarConfigDaConta(conta, await corpoJson(req)));
}
