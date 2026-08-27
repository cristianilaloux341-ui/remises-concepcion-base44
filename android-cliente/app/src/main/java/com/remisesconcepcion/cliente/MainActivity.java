package com.remisesconcepcion.cliente;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.Intent;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

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
        final String encodedOrderId = URLEncoder.encode(pendingOrderId, StandardCharsets.UTF_8);
        final String js = "window.location.href='/app-cliente/active-ride?orderId=" + encodedOrderId + "';";
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(js, null));
        pendingOrderId = null;
    }
}
