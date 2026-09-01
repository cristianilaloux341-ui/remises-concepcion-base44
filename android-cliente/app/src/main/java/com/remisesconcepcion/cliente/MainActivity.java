package com.remisesconcepcion.cliente;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.Intent;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    private String pendingOrderId = null;
    private boolean pendingYaVoy = false;

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
        String clientAction = intent.getStringExtra("clientAction");
        if (orderId != null && !orderId.isEmpty()) {
            pendingOrderId = orderId;
            pendingYaVoy = "YA_VOY".equals(clientAction);
            intent.removeExtra("orderId");
            intent.removeExtra("clientAction");
            openPendingClientRide();
        }
    }

    private void openPendingClientRide() {
        if (pendingOrderId == null || bridge == null || bridge.getWebView() == null) return;
        final String encodedOrderId = URLEncoder.encode(pendingOrderId, StandardCharsets.UTF_8);
        final String action = pendingYaVoy ? "&clientAction=YA_VOY" : "";
        final String js = "window.location.href='/app-cliente/active-ride?orderId=" + encodedOrderId + action + "';";
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(js, null));
        pendingOrderId = null;
        pendingYaVoy = false;
    }
}
