package br.com.firehub.maquininha.pagamento

/**
 * Qual adquirente este APK cobra. Existe um arquivo destes por flavor, com o
 * mesmo nome e o mesmo pacote; o Gradle compila só o do flavor escolhido.
 */
object Adquirente {
    val cobrador: CobradorDaAdquirente = CobradorCielo
}
