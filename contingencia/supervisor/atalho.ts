/**
 * O atalho "FireHub" na área de trabalho do computador do caixa. Pedido do
 * Douglas (14/10/2026): "no modo contingência ele já pode instalar
 * automaticamente esse ícone" — o jeito de abrir o sistema que sempre dá
 * certo, como no Consumer.
 *
 * Aponta para o FireHub de sempre (a nuvem, /store), no navegador padrão:
 *   - com internet, abre a nuvem, como sempre;
 *   - sem internet, a rede de segurança do navegador (public/sw-contingencia.js)
 *     leva ao FireHub deste computador já com a entrada guardada, sem senha.
 * Não aponta para 127.0.0.1:7890 de propósito: a entrada guardada (o bilhete)
 * mora no navegador junto com o endereço da nuvem, e o endereço local cairia
 * na tela de entrar.
 *
 * Quem cria é o supervisor, a cada subida: chega pelo pacote do FireHub, sem
 * Assistente novo, e se o dono apagar volta na próxima. Só mexe no atalho que
 * ele mesmo criou (a seção [FireHub] no arquivo); se a loja já tem um atalho
 * "FireHub" dela, fica o dela — qualquer atalho para o FireHub abre sem
 * internet do mesmo jeito.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const NOME = "FireHub";
const MARCA = "[FireHub]\r\nCriadoPor=Modo Contingencia\r\n";

function areaDeTrabalho(): Promise<string | null> {
  // GetFolderPath acha a área de trabalho de verdade, inclusive a que o
  // OneDrive levou para outra pasta (o "Desktop" do perfil fica vazio).
  return new Promise((ok) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('Desktop')"],
      { windowsHide: true, timeout: 20_000 },
      (e, saida) => {
        const pasta = String(saida || "").trim();
        if (!e && pasta && fs.existsSync(pasta)) return ok(pasta);
        const reserva = path.join(process.env.USERPROFILE || "", "Desktop");
        ok(fs.existsSync(reserva) ? reserva : null);
      },
    );
  });
}

/**
 * Os endereços em que o painel pode estar: o da nuvem e o mesmo com/sem
 * "www". Cada um guarda a própria entrada (bilhete e rede de segurança) — o
 * atalho tem de abrir o que a loja usa (visto em 14/10/2026: o "www" não
 * redireciona).
 */
export function origensDaNuvem(nuvem: string): string[] {
  try {
    const u = new URL(nuvem);
    const outro = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    return [`${u.protocol}//${u.host}`, `${u.protocol}//${outro}${u.port ? `:${u.port}` : ""}`];
  } catch {
    return [];
  }
}

/** O conteúdo do atalho (.url: abre no navegador padrão, com o ícone do FireHub). */
export function conteudoDoAtalho(endereco: string, icone: string | null): string {
  return [
    "[InternetShortcut]",
    `URL=${endereco}`,
    ...(icone ? [`IconFile=${icone}`, "IconIndex=0"] : []),
    "",
  ].join("\r\n") + MARCA;
}

export async function garantirAtalho(
  o: { nuvem: string; appDir: string; pasta: string },
  registro: (linha: string) => void,
): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    const pasta = await areaDeTrabalho();
    if (!pasta) return registro("Atalho: área de trabalho não encontrada.");

    // O ícone fica numa pasta que não muda com a versão (a do pacote é trocada
    // a cada atualização e o atalho ficaria sem desenho).
    let icone: string | null = path.join(o.pasta, "FireHub.ico");
    const origem = path.join(o.appDir, "public", "favicon.ico");
    if (fs.existsSync(origem)) fs.copyFileSync(origem, icone);
    else if (!fs.existsSync(icone)) icone = null;

    const arquivo = path.join(pasta, `${NOME}.url`);
    const conteudo = conteudoDoAtalho(`${o.nuvem}/store`, icone);
    if (fs.existsSync(arquivo)) {
      const atual = fs.readFileSync(arquivo, "latin1");
      if (!atual.includes(MARCA.trim().split("\r\n")[0])) return; // atalho da própria loja: fica o dela
      if (atual === conteudo) return;
    } else if (fs.existsSync(path.join(pasta, `${NOME}.lnk`))) {
      return; // a loja já tem um atalho "FireHub" (do navegador): não duplica
    }
    // latin1: o Windows lê o .url na página de código da máquina, e o caminho
    // do ícone pode ter acento (nome do usuário).
    fs.writeFileSync(arquivo, conteudo, "latin1");
    registro(`Atalho "${NOME}" na área de trabalho (${arquivo}).`);
  } catch (e: any) {
    registro(`Atalho: não deu para criar (${e?.message || e}).`);
  }
}
