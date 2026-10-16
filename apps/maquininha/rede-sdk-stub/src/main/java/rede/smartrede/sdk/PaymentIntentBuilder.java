package rede.smartrede.sdk;

import android.content.Intent;

/** ESQUELETO (compileOnly). Devolvido por RedePayments.intentForPaymentBuilder. */
public class PaymentIntentBuilder {
    /** 2 a 99. Lança exceção em tipo que não parcela (o app nunca chama: cobra à vista). */
    public PaymentIntentBuilder setInstallments(int installments) {
        throw new UnsupportedOperationException("Esqueleto do SDK da Rede");
    }

    public Intent build() {
        throw new UnsupportedOperationException("Esqueleto do SDK da Rede");
    }
}
