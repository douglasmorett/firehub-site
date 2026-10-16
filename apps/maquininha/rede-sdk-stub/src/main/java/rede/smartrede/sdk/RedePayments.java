package rede.smartrede.sdk;

import android.content.Context;
import android.content.Intent;

/**
 * ESQUELETO (compileOnly). Porta de entrada do SDK 3.0 da Rede.
 *
 * Todas as Intents daqui se abrem com startActivityForResult; o resultado
 * volta em onActivityResult.
 */
public class RedePayments {
    public static RedePayments getInstance(Context context) {
        throw new UnsupportedOperationException("Esqueleto do SDK da Rede");
    }

    /** amount = valor em centavos ("multiplicado por 100", diz o manual). */
    public PaymentIntentBuilder intentForPaymentBuilder(FlexTipoPagamento paymentType, long amount) {
        throw new UnsupportedOperationException("Esqueleto do SDK da Rede");
    }

    /**
     * O manual escreve "RedePayments.getPaymentFromIntent(Intent data)" sem
     * dizer se é estático. O cobrador chama por reflexão e aceita os dois.
     */
    public static Payment getPaymentFromIntent(Intent data) {
        throw new UnsupportedOperationException("Esqueleto do SDK da Rede");
    }

    public Intent intentForReversal() {
        throw new UnsupportedOperationException("Esqueleto do SDK da Rede");
    }

    public Intent intentForReprint() {
        throw new UnsupportedOperationException("Esqueleto do SDK da Rede");
    }
}
