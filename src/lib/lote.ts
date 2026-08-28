import { randomInt } from "crypto";

/**
 * O código que vai dentro do QR da etiqueta.
 *
 * ── ALFABETO ────────────────────────────────────────────────────────────────
 * Sem I, L, O, U, 0 e 1. Os cinco primeiros porque se confundem entre si e com
 * dígitos numa etiqueta térmica borrada; o U porque some em fonte condensada e
 * porque tira palavrão do sorteio. Sobram 30 caracteres.
 *
 * 30^8 = 656 bilhões de códigos. Uma loja que imprima 500 etiquetas por dia
 * durante 20 anos usa 3,6 milhões — a chance de colisão é desprezível, e mesmo
 * assim a gravação confere contra o banco antes de aceitar.
 *
 * ── POR QUE MAIÚSCULAS ──────────────────────────────────────────────────────
 * O QR tem um modo alfanumérico que só aceita A-Z, dígitos e alguns símbolos, e
 * ele gasta MENOS módulos que o modo byte. Com a URL inteira em maiúsculas
 * (HTTPS://FIREHUBFOOD.COM.BR/E/K7F2M9QX, 37 caracteres) o símbolo cabe numa
 * versão pequena, que é o que permite imprimir 20 mm legíveis num rolo de
 * 60 mm. Em minúsculas cairia no modo byte e precisaria de um símbolo maior.
 * Hostname é insensível a caixa por definição, e o caminho é nosso — a rota
 * normaliza para maiúsculas na leitura.
 */
const ALFABETO = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export function gerarCodigoDeLote(tamanho = 8): string {
  let out = "";
  for (let i = 0; i < tamanho; i++) {
    // randomInt do módulo crypto, não Math.random: o código é a identidade da
    // etiqueta e vira endereço público em /e/<code>. Math.random é previsível
    // o bastante para alguém enumerar códigos de outra loja.
    out += ALFABETO[randomInt(0, ALFABETO.length)];
  }
  return out;
}

/**
 * Normaliza o que veio da URL ou do campo de digitação.
 *
 * O funcionário digita com o QR sujo de gordura, e digita errado: minúscula,
 * espaço no meio, hífen que ele achou que existia. Aceitar tudo isso é a
 * diferença entre "o sistema não acha" e "achou".
 *
 * As confusões visuais clássicas viram o caractere do alfabeto: O->0 não, ao
 * contrário — como 0 e 1 NÃO estão no alfabeto, quem digitou 0 quis dizer O, e
 * quem digitou 1 quis dizer I... mas I também não está. Então 1 e I viram J?
 * Não: mapear para o vizinho errado inventaria um código válido de OUTRO lote.
 * O certo é só limpar e deixar o banco decidir se existe.
 */
export function normalizarCodigo(bruto: string): string {
  return String(bruto || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

/** Um código só é plausível se tiver o tamanho certo e só letras do alfabeto. */
export function codigoPlausivel(codigo: string): boolean {
  if (codigo.length !== 8) return false;
  for (const c of codigo) if (!ALFABETO.includes(c)) return false;
  return true;
}

/**
 * A URL que vira QR. Em maiúsculas de ponta a ponta pelo motivo acima.
 *
 * O host vem de quem chama (o servidor sabe em qual domínio está respondendo),
 * porque loja com domínio próprio existe e um QR apontando para o domínio
 * errado é uma etiqueta impressa que nunca vai funcionar.
 */
export function urlDoLote(host: string, codigo: string): string {
  const limpo = String(host || "firehubfood.com.br").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return `HTTPS://${limpo.toUpperCase()}/E/${codigo.toUpperCase()}`;
}

/**
 * Em quantos dias vence — negativo quer dizer que já venceu.
 *
 * DUAS grandezas diferentes entram aqui, e tratar as duas igual é o erro:
 *
 *  - `validoAte` é um DIA DE CALENDÁRIO. Nasce de um <input type="date"> e fica
 *    gravado como meia-noite UTC. As partes têm que ser lidas EM UTC — passar
 *    isso por um fuso desloca o dia, que é exatamente o defeito que fazia a
 *    etiqueta imprimir a data de ontem em toda impressão.
 *  - `agora` é um INSTANTE. O "hoje" dele é o dia em São Paulo, senão quem
 *    olha às 22h já estaria no dia seguinte (em UTC é 01h) e uma etiqueta que
 *    vence hoje apareceria como vencida ontem.
 */
export function diasParaVencer(validoAte: Date | string | null | undefined, agora = new Date()): number | null {
  if (!validoAte) return null;

  const dia =
    typeof validoAte === "string" && /^\d{4}-\d{2}-\d{2}/.test(validoAte)
      ? validoAte.slice(0, 10)
      : new Date(validoAte).toISOString().slice(0, 10);

  const hojeEmSaoPaulo = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);

  const a = Date.parse(dia + "T00:00:00Z");
  const b = Date.parse(hojeEmSaoPaulo + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export type EstadoDePrazo = "vencido" | "hoje" | "atencao" | "emDia" | "semValidade";

/** A escala de prazo do sistema inteiro — a mesma no estoque, na lista e no scan. */
export function estadoDePrazo(validoAte: Date | string | null | undefined, agora = new Date()): EstadoDePrazo {
  const d = diasParaVencer(validoAte, agora);
  if (d === null) return "semValidade";
  if (d < 0) return "vencido";
  if (d === 0) return "hoje";
  if (d <= 3) return "atencao";
  return "emDia";
}

/** O texto que o lojista lê. Em português de gente, não "D-2". */
export function textoDePrazo(validoAte: Date | string | null | undefined, agora = new Date()): string {
  const d = diasParaVencer(validoAte, agora);
  if (d === null) return "Sem validade";
  if (d < -1) return `Venceu há ${Math.abs(d)} dias`;
  if (d === -1) return "Venceu ontem";
  if (d === 0) return "Vence hoje";
  if (d === 1) return "Vence amanhã";
  return `Vence em ${d} dias`;
}
