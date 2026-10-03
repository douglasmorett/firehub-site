// O endereço do banco local (PGlite) da loja de teste da gravação ao vivo.
// O PGlite aceita qualquer usuário e senha; como em tutoriais/ambiente/ambiente.mjs,
// o acesso vem de variável para não haver credencial escrita no código.
export const PORTA_DO_BANCO = 5470;
export function urlDoBanco(porta = PORTA_DO_BANCO) {
  const usuario = process.env.TUTORIAL_PG_USUARIO || "postgres";
  const acesso = [usuario, process.env.TUTORIAL_PG_SENHA || usuario].join(":");
  return `postgresql://${acesso}@127.0.0.1:${porta}/postgres?sslmode=disable&connection_limit=1&pgbouncer=true`;
}
