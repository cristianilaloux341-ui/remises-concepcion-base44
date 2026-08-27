package com.remisesconcepcion.driver;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class NotificationActionReceiver extends BroadcastReceiver {
    private static final String TAG = "ClientPush";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !"ACTION_CLIENT_YA_VOY".equals(intent.getAction())) return;

        final PendingResult pendingResult = goAsync();
        final String orderId = intent.getStringExtra("orderId");
        final String clientId = intent.getStringExtra("clientId");
        final String sessionToken = intent.getStringExtra("sessionToken");
        final String apiUrl = intent.getStringExtra("apiUrl");

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(orderId != null ? orderId.hashCode() : 7001);

        if (orderId == null || clientId == null || sessionToken == null || apiUrl == null || apiUrl.isEmpty()) {
            Log.w(TAG, "YA VOY incompleto; se abre la app para confirmar desde Cliente");
            openClientApp(context, orderId);
            pendingResult.finish();
            return;
        }

        new Thread(() -> {
            boolean ok = false;
            try {
                URL url = new URL(apiUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);

                String safeOrder = escape(orderId);
                String safeClient = escape(clientId);
                String safeToken = escape(sessionToken);
                String payload = "{\"orderId\":\"" + safeOrder + "\",\"clientId\":\"" + safeClient + "\",\"sessionToken\":\"" + safeToken + "\"}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.getBytes("UTF-8"));
                }
                int code = conn.getResponseCode();
                ok = code >= 200 && code < 300;
                Log.i(TAG, "YA VOY HTTP " + code);
                conn.disconnect();
            } catch (Exception e) {
                Log.e(TAG, "No se pudo confirmar YA VOY desde la notificación", e);
            } finally {
                if (!ok) openClientApp(context, orderId);
                pendingResult.finish();
            }
        }).start();
    }

    private static void openClientApp(Context context, String orderId) {
        Intent launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (orderId != null) launch.putExtra("orderId", orderId);
        context.startActivity(launch);
    }

    private static String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
