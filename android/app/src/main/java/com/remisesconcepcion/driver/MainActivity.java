package com.remisesconcepcion.driver;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.Intent;

public class MainActivity extends BridgeActivity {
    
    private String pendingAction = null;
    private String pendingOrderId = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(com.remisesconcepcion.driver.ForegroundServicePlugin.class);
        super.onCreate(savedInstanceState);
        checkIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        checkIntent(intent);
    }

    private String pendingAttempt = null;

    private void checkIntent(Intent intent) {
        if (intent != null) {
            String action = intent.getStringExtra("radiocab_action");
            String orderId = intent.getStringExtra("orderId");
            if (action != null && orderId != null) {
                pendingAction = action;
                pendingOrderId = orderId;
                pendingAttempt = intent.getStringExtra("assignmentAttempt");
                intent.removeExtra("radiocab_action");
                executePendingAction();
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        executePendingAction();
    }

    private void executePendingAction() {
        if (pendingAction != null && pendingOrderId != null && bridge != null && bridge.getWebView() != null) {
            String attemptQuery = pendingAttempt != null ? "&attempt=" + pendingAttempt : "";
            final String js = String.format(
                "var checkInterval = setInterval(function() { " +
                "  if (document.readyState === 'complete') { " +
                "    clearInterval(checkInterval); " +
                "    window.location.href = '/driver-app?%s=%s%s'; " +
                "  } " +
                "}, 200);", pendingAction, pendingOrderId, attemptQuery);
                
            bridge.getWebView().post(() -> {
                bridge.getWebView().evaluateJavascript(js, null);
            });
            pendingAction = null;
            pendingOrderId = null;
            pendingAttempt = null;
        }
    }
}