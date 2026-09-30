import { NextRequest, NextResponse } from "next/server";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { nomesDaEquipe, quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { ContatoDeOutraCarteira, criarContatoManual } from "@/lib/crm/contatos";
import { origemValida } from "@/lib/crm/etapas";
import { contatoParaLista } from "@/lib/crm/serializar";
import { chaveDoTelefone } from "@/lib/crm/telefone";

export const dynamic = "force-dynamic";

/**
 * POST: contato cadastrado à mão — o lead que veio do Instagram, da palestra,
 * da indicação. O vendedor que cadastra fica com ele; o admin escolhe (ou
 * deixa sem ninguém). Número que já existe devolve o contato existente com
 * `jaExistia` — a tela abre ele em vez de duplicar.
 */
export async function POST(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });

  const b = await req.json().catch(() => ({}));
  const telefone = typeof b.telefone === "string" ? b.telefone : "";
  const nome = typeof b.nome === "string" ? b.nome : "";
  const nomeDaLoja = typeof b.nomeDaLoja === "string" ? b.nomeDaLoja : "";
  if (!chaveDoTelefone(telefone) && !nome.trim() && !nomeDaLoja.trim()) {
    return NextResponse.json({ error: "Informe pelo menos o telefone (com DDD) ou o nome." }, { status: 400 });
  }
  if (telefone.trim() && !chaveDoTelefone(telefone)) {
    return NextResponse.json({ error: "Telefone inválido: use DDD + número." }, { status: 400 });
  }

  const vendedorId = quem.tipo === "VENDEDOR" ? quem.id : typeof b.vendedorId === "string" && b.vendedorId ? b.vendedorId : null;
  try {
    const { contato, jaExistia } = await criarContatoManual(
      {
        telefone, nome, nomeDaLoja,
        cidade: typeof b.cidade === "string" ? b.cidade : null,
        email: typeof b.email === "string" ? b.email : null,
        notas: typeof b.notas === "string" ? b.notas : null,
        origem: origemValida(b.origem) || "MANUAL",
        vendedorId,
      },
      { tipo: quem.tipo, id: quem.id, nome: quem.nome },
    );
    if (!contato) return NextResponse.json({ error: "Não foi possível cadastrar." }, { status: 500 });
    if (jaExistia && quem.tipo === "VENDEDOR" && contato.vendedorId !== quem.id) {
      return NextResponse.json({ error: "Esse número já está no CRM e não é da sua carteira. Fale com o admin." }, { status: 409 });
    }
    return NextResponse.json({ contato: contatoParaLista(contato, await nomesDaEquipe()), jaExistia });
  } catch (err: any) {
    if (err instanceof ContatoDeOutraCarteira) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: err?.message || "Erro ao cadastrar." }, { status: 500 });
  }
}
