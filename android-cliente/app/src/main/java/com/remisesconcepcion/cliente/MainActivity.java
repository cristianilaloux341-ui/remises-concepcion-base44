package com.remisesconcepcion.cliente;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.Intent;

public class MainActivity extends BridgeActivity {
    private String pendingOrderId = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        checkIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        checkIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        openPendingClientRide();
    }

    private void checkIntent(Intent intent) {
        if (intent == null) return;
        String orderId = intent.getStringExtra("orderId");
        if (orderId != null && !orderId.isEmpty()) {
            pendingOrderId = orderId;
            intent.removeExtra("orderId");
            openPendingClientRide();
        }
    }

    private void openPendingClientRide() {
        if (pendingOrderId == null || bridge == null || bridge.getWebView() == null) return;
        final String safeOrderId = pendingOrderId.replace("'", "");
        final String js = "window.location.href='/client-app?orderId=" + safeOrderId + "';";
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(js, null));
        pendingOrderId = null;
    }
}
