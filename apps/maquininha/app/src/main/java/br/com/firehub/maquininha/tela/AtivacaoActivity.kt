package br.com.firehub.maquininha.tela

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.TrabalhoDeTela
import br.com.firehub.maquininha.pagamento.PagamentoNaMaquininha
import br.com.firehub.maquininha.servico.ServicoDeCobranca

/**
 * Ativa o terminal junto ao PagBank.
 *
 * Ativação do PagBank e pareamento com o FireHub são coisas distintas e a tela
 * não pode misturá-las: esta habilita o aparelho a passar cartão; a outra diz a
 * este app de qual loja ele é. Um terminal pode estar ativado e não pareado, e
 * o contrário também.
 *
 * Na prática o terminal costuma chegar à loja já ativado, e esta tela nunca
 * aparece. Ela existe para o caso em que não chegou.
 */
class AtivacaoActivity : AppCompatActivity() {

    private lateinit var campo: EditText
    private lateinit var botaoAtivar: Button
    private lateinit var botaoOnboarding: Button
    private lateinit var mensagem: TextView

    override fun onCreate(estadoSalvo: Bundle?) {
        super.onCreate(estadoSalvo)
        setContentView(R.layout.activity_ativacao)

        campo = findViewById(R.id.campoAtivacao)
        botaoAtivar = findViewById(R.id.botaoAtivar)
        botaoOnboarding = findViewById(R.id.botaoOnboarding)
        mensagem = findViewById(R.id.mensagemAtivacao)

        botaoAtivar.setOnClickListener { ativar() }
        botaoOnboarding.setOnClickListener { abrirOnboarding() }
    }

    override fun onStart() {
        super.onStart()
        conferirSeJaEstaAtivado()
    }

    /**
     * Se o terminal já estiver ativado, esta tela não tem o que fazer. Deixar um
     * campo de código aberto num terminal ativado é convite para alguém digitar
     * qualquer coisa e reativar o aparelho no meio do movimento.
     */
    private fun conferirSeJaEstaAtivado() {
        TrabalhoDeTela.fazer(
            tarefa = { PagamentoNaMaquininha.impedimentoParaCobrar() },
            aoTerminar = { resultado ->
                val impedimento = resultado.getOrNull() ?: return@fazer
                when (impedimento) {
                    is PagamentoNaMaquininha.Impedimento.Nenhum -> {
                        avisar(getString(R.string.ativacao_ja_ativado))
                        finish()
                    }
                    is PagamentoNaMaquininha.Impedimento.ServicoNaoInstalado -> {
                        avisar(getString(R.string.ativacao_sem_servico))
                        trabalhando(true)
                    }
                    else -> Unit
                }
            },
        )
    }

    private fun ativar() {
        val codigo = campo.text?.toString()?.trim().orEmpty()
        if (codigo.isEmpty()) {
            avisar(getString(R.string.ativacao_vazia))
            return
        }

        trabalhando(true)
        avisar(getString(R.string.ativacao_trabalhando))

        TrabalhoDeTela.fazer(
            tarefa = { PagamentoNaMaquininha.ativarComCodigo(codigo) },
            aoTerminar = { externo ->
                trabalhando(false)
                val interno = externo.getOrNull()
                when {
                    interno == null -> avisar(
                        getString(R.string.ativacao_falhou, externo.exceptionOrNull()?.message ?: ""),
                    )
                    interno.isSuccess -> {
                        avisar(getString(R.string.ativacao_ok))
                        // O serviço guarda por alguns minutos o resultado da
                        // última conferência de ativação. Sem este aviso, a
                        // maquininha ficaria recusando cobrança com "terminal
                        // não ativado" logo depois de ter sido ativada.
                        ServicoDeCobranca.acordar(this)
                        finish()
                    }
                    else -> avisar(
                        getString(R.string.ativacao_falhou, interno.exceptionOrNull()?.message ?: ""),
                    )
                }
            },
        )
    }

    private fun abrirOnboarding() {
        trabalhando(true)
        TrabalhoDeTela.fazer(
            tarefa = { PagamentoNaMaquininha.abrirAtivacaoDoPagBank() },
            aoTerminar = { externo ->
                trabalhando(false)
                val interno = externo.getOrNull()
                if (interno == null || interno.isFailure) {
                    avisar(getString(R.string.ativacao_falhou, "não foi possível abrir a ativação do PagBank."))
                }
            },
        )
    }

    private fun trabalhando(ocupado: Boolean) {
        botaoAtivar.isEnabled = !ocupado
        botaoOnboarding.isEnabled = !ocupado
        campo.isEnabled = !ocupado
    }

    private fun avisar(texto: String) {
        mensagem.text = texto
        mensagem.visibility = View.VISIBLE
    }
}
