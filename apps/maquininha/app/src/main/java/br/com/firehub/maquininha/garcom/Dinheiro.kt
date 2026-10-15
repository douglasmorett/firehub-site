package br.com.firehub.maquininha.garcom

import kotlin.math.roundToLong

/**
 * Dinheiro do modo garçom.
 *
 * As rotas de mesa falam em REAIS com casas decimais (é o formato que a tela web
 * do garçom usa), então o app recebe Double. Ele vira centavos assim que chega
 * e só volta a ser Double no corpo dos POSTs, que esperam reais. Conta e
 * comparação são sempre em centavos inteiros.
 */
object Dinheiro {

    fun centavos(reais: Double): Long = (reais * 100.0).roundToLong()

    fun reais(centavos: Long): Double = centavos / 100.0

    /** O mesmo arredondamento de lib/preco-combo.ts (`arredondar`). */
    fun arredondar(reais: Double): Double = Math.round(reais * 100.0) / 100.0

    /** "R$ 1.234,56". Feito na mão pelo mesmo motivo de Cobranca.valorFormatado. */
    fun formatar(centavos: Long): String {
        val negativo = centavos < 0
        val absoluto = if (negativo) -centavos else centavos
        val reais = absoluto / 100
        val resto = absoluto % 100

        val digitos = reais.toString()
        val comMilhar = StringBuilder()
        for ((posicao, digito) in digitos.withIndex()) {
            if (posicao > 0 && (digitos.length - posicao) % 3 == 0) comMilhar.append('.')
            comMilhar.append(digito)
        }
        val centavosTexto = if (resto < 10) "0$resto" else resto.toString()
        return (if (negativo) "-R$ " else "R$ ") + comMilhar + "," + centavosTexto
    }

    fun formatarReais(reais: Double): String = formatar(centavos(reais))

    /** "45,90" para o campo de valor (sem o R$). */
    fun paraCampo(centavos: Long): String {
        val reais = centavos / 100
        val resto = centavos % 100
        return reais.toString() + "," + (if (resto < 10) "0$resto" else resto.toString())
    }

    /**
     * Lê o que o garçom digitou: "45,9", "45,90", "1.234,56", "45.90".
     * Devolve nulo se não for um valor.
     */
    fun lerCampo(texto: String): Long? {
        var t = texto.trim().replace("R$", "").replace(" ", "")
        if (t.isEmpty()) return null
        if (t.contains(',')) {
            // Vírgula é o decimal; ponto, se houver, é milhar.
            t = t.replace(".", "").replace(',', '.')
        } else if (t.count { it == '.' } > 1) {
            t = t.replace(".", "")
        }
        val valor = t.toDoubleOrNull() ?: return null
        if (valor.isNaN() || valor.isInfinite() || valor < 0) return null
        return centavos(valor)
    }
}
