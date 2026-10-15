package br.com.firehub.maquininha.garcom

import br.com.firehub.maquininha.estado.EstadoDoTerminal

/**
 * A passagem de bastão entre o modo garçom e a tela de cobrança.
 *
 * O modo garçom NÃO cobra. Quem cobra continua sendo o serviço de cobrança, pelo
 * caminho de sempre (fila no servidor, marcador em disco, fila de resultados,
 * recuperação depois de queda) — e quem mostra a cobrança continua sendo a
 * OperacaoActivity. O garçom só manda a cobrança da mesa para a fila (a mesma
 * rota que o garçom web usa) e acorda o serviço.
 *
 * Quando chega cobrança — a do garçom ou uma do totem, que tem prioridade na
 * fila do servidor — o serviço traz a OperacaoActivity para a frente como
 * sempre. A tela do garçom mora numa task própria (taskAffinity no manifesto),
 * então não é destruída por isso: fica atrás, esperando. Esta flag é o recado
 * para a OperacaoActivity devolver a frente ao garçom quando a cobrança acabar.
 */
object ModoGarcom {

    /** O garçom estava na tela quando a cobrança apareceu: devolver a ele no fim. */
    @Volatile
    var voltarAoGarcom: Boolean = false

    /** Situações em que a tela de cobrança precisa estar na frente. */
    fun ehCobranca(situacao: EstadoDoTerminal.Situacao): Boolean =
        situacao is EstadoDoTerminal.Situacao.Escolhendo ||
            situacao is EstadoDoTerminal.Situacao.Cobrando ||
            situacao is EstadoDoTerminal.Situacao.Aprovado ||
            situacao is EstadoDoTerminal.Situacao.Recusado
}
