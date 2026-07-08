package com.remisesconcepcion.driver;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class NotificationActionReceiver extends BroadcastReceiver {
    private static final String TAG = "PushDiagnostic";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.e(TAG, "BroadcastReceiver onReceive: " + action);

        if ("ACTION_ACCEPT".equals(action) || "ACTION_REJECT".equals(action)) {
            final PendingResult pendingResult = goAsync();
            // Detener sonido inmediatamente
            MyFirebaseMessagingService.stopAlarmSound();

            String orderId = intent.getStringExtra("orderId");
            String driverId = intent.getStringExtra("driverId");
            String driverName = intent.getStringExtra("driverName");
            String base = intent.getStringExtra("base");
            String apiUrl = intent.getStringExtra("apiUrl");
            
            NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            int notificationId = orderId != null ? orderId.hashCode() : 0;

            if ("ACTION_ACCEPT".equals(action)) {
                Log.e(TAG, "Acción Aceptar recibida.");
                // Cerrar la notificación automáticamente para que no quede pendiente en la barra de estado
                notificationManager.cancel(notificationId);
                
                // Enviar al servidor invocando la misma función que usa la aplicación web
                String dName = driverName != null ? driverName.replace("\"", "\\\"") : "";
                String bName = base != null ? base.replace("\"", "\\\"") : "";
                String payload = String.format("{\"action\":\"native_accept\", \"orderId\":\"%s\", \"driverId\":\"%s\", \"driverName\":\"%s\", \"base\":\"%s\"}", 
                        orderId, driverId, dName, bName);
                sendToServer(apiUrl, payload, pendingResult);

                // Abrir la app y pasar el parámetro para que React también se entere
                Intent launchIntent = new Intent(context, MainActivity.class);
                launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                launchIntent.putExtra("radiocab_action", "accept");
                launchIntent.putExtra("orderId", orderId);
                context.startActivity(launchIntent);
                
            } else if ("ACTION_REJECT".equals(action)) {
                Log.e(TAG, "Acción Rechazar recibida.");
                // Cerrar la notificación
                notificationManager.cancel(notificationId);
                
                // Enviar al servidor
                String payload = String.format("{\"action\":\"native_reject\", \"orderId\":\"%s\", \"driverId\":\"%s\"}", orderId, driverId);
                sendToServer(apiUrl, payload, pendingResult);

                // Abrir la app y pasar el parámetro de rechazo
                Intent launchIntent = new Intent(context, MainActivity.class);
                launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                launchIntent.putExtra("radiocab_action", "reject");
                launchIntent.putExtra("orderId", orderId);
                context.startActivity(launchIntent);
            }
        }
    }

    private void sendToServer(String apiUrl, String jsonPayload, PendingResult pendingResult) {
        if (apiUrl == null || apiUrl.isEmpty()) {
            Log.e(TAG, "Error: apiUrl es null o vacío");
            if (pendingResult != null) pendingResult.finish();
            return;
        }
        new Thread(() -> {
            try {
                URL url = new URL(apiUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                
                try(OutputStream os = conn.getOutputStream()) {
                    byte[] input = jsonPayload.getBytes("utf-8");
                    os.write(input, 0, input.length);
                }
                
                int code = conn.getResponseCode();
                Log.e(TAG, "Respuesta del servidor para acción nativa: " + code);
            } catch (Exception e) {
                Log.e(TAG, "Error enviando acción al servidor", e);
            } finally {
                if (pendingResult != null) {
                    pendingResult.finish();
                }
            }
        }).start();
    }
}