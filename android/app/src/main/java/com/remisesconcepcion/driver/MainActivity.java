package com.remisesconcepcion.driver;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.Intent;
import android.os.Build;
import android.view.WindowManager;
import android.app.KeyguardManager;
import android.content.Context;

public class MainActivity extends BridgeActivity {
    
    private String pendingAction = null;
    private String pendingOrderId = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(com.remisesconcepcion.driver.ForegroundServicePlugin.class);
        super.onCreate(savedInstanceState);
        
        // Forzar despertar la pantalla y mostrar sobre la pantalla de bloqueo
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) {
                keyguardManager.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        
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
            String incomingRide = intent.getStringExtra("radiocab_incoming_ride");
            if (incomingRide != null) {
                // El intent fue lanzado porque hay un nuevo viaje, forzar audio desde la actividad Foreground
                RideAlertController.getInstance().playAudioFallback(this);
                intent.removeExtra("radiocab_incoming_ride");
            }
            
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