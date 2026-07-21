package com.remisesconcepcion.driver;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class MyFirebaseMessagingService extends MessagingService {
    private static final String TAG = "PushDiagnostic";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Log.e(TAG, "==== LLEGO EL PUSH A ANDROID NATIVO ====");
        Log.e(TAG, "Timestamp recepción local: " + System.currentTimeMillis());
        Log.e(TAG, "Message ID: " + remoteMessage.getMessageId());
        Log.e(TAG, "From: " + remoteMessage.getFrom());
        Log.e(TAG, "Collapse Key: " + remoteMessage.getCollapseKey());
        Log.e(TAG, "Priority: " + remoteMessage.getPriority());
        Log.e(TAG, "Original Priority: " + remoteMessage.getOriginalPriority());
        Log.e(TAG, "Sent Time: " + remoteMessage.getSentTime());
        Log.e(TAG, "TTL: " + remoteMessage.getTtl());

        if (remoteMessage.getNotification() != null) {
            Log.e(TAG, "Notification Title: " + remoteMessage.getNotification().getTitle());
            Log.e(TAG, "Notification Body: " + remoteMessage.getNotification().getBody());
        } else {
            Log.e(TAG, "Notification object is NULL (Data-only push)");
        }

        Map<String, String> data = remoteMessage.getData();
        if (data.size() > 0) {
            Log.e(TAG, "Data Completa:");
            for (Map.Entry<String, String> entry : data.entrySet()) {
                Log.e(TAG, "   " + entry.getKey() + " = " + entry.getValue());
            }
        }
        
        String type = data.get("type");
        
        if ("cancelar".equals(type) || "ride_cancelled".equals(type) || "ride_reassigned".equals(type)) {
            Log.e(TAG, "=> RECIBIDA ORDEN REMOTA DE CIERRE: " + type);
            String orderId = data.get("orderId");
            if (orderId != null) {
                RideAlertController.getInstance().stopAlert(getApplicationContext(), orderId, "Comando remoto: " + type);
            }
            return;
        }
        
        if ("ofrecido".equals(type) || "broadcast".equals(type)) {
            Log.e(TAG, "Construyendo notificación interactiva nativa para viaje...");
            showInteractiveNotification(data);
        }

        Log.e(TAG, "Pasando mensaje al comportamiento original de Capacitor...");
        Log.e(TAG, "==========================================");

        // Llamamos al super de Capacitor para no alterar la lógica en la UI de React
        super.onMessageReceived(remoteMessage);
    }

    private void showInteractiveNotification(Map<String, String> data) {
        String orderId = data.get("orderId");
        String driverId = data.get("driverId");
        String driverName = data.get("driverName");
        String base = data.get("base");
        String apiUrl = data.get("apiUrl");
        String title = data.get("title");
        String body = data.get("body");

        if (title == null) title = "🚖 ¡NUEVO VIAJE!";
        if (body == null) body = "Tienes un viaje asignado";

        Context context = getApplicationContext();

        Intent acceptIntent = new Intent(context, NotificationActionReceiver.class);
        acceptIntent.setAction("ACTION_ACCEPT");
        acceptIntent.putExtra("orderId", orderId);
        acceptIntent.putExtra("driverId", driverId);
        acceptIntent.putExtra("driverName", driverName);
        acceptIntent.putExtra("base", base);
        acceptIntent.putExtra("apiUrl", apiUrl);

        Intent rejectIntent = new Intent(context, NotificationActionReceiver.class);
        rejectIntent.setAction("ACTION_REJECT");
        rejectIntent.putExtra("orderId", orderId);
        rejectIntent.putExtra("driverId", driverId);
        rejectIntent.putExtra("apiUrl", apiUrl);

        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        // Delegar la alerta al controlador centralizado
        RideAlertController.getInstance().startAlert(context, orderId, title, body, acceptIntent, rejectIntent, openAppIntent);
    }

    @Override
    public void onNewToken(@NonNull String s) {
        Log.e(TAG, "==== NUEVO FCM TOKEN ==== " + s);
        super.onNewToken(s);
    }
}