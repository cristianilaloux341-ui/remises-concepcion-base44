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
        Log.e(TAG, "FCM_MESSAGE_RECEIVED");
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
        String orderId = data.get("orderId");

        if ("cancelar".equals(type) || "ride_cancelled".equals(type) || "ride_reassigned".equals(type)) {
            Log.e(TAG, "=> RECIBIDA ORDEN REMOTA DE CIERRE: " + type);
            if (orderId != null) {
                // Registrar resolución para evitar que un push 'ofrecido' demorado suene
                RideStateManager.markResolved(getApplicationContext(), orderId, 999, "CANCELLED");
                RideAlertController.getInstance().stopAlert(getApplicationContext(), orderId, "Comando remoto: " + type);
                
                // Mostrar notificación breve para satisfacer el requisito de FCM (evita penalización de prioridad)
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    NotificationChannel ch = new NotificationChannel("ride_alerts_cancel", "Cancelaciones", NotificationManager.IMPORTANCE_DEFAULT);
                    nm.createNotificationChannel(ch);
                }
                androidx.core.app.NotificationCompat.Builder b = new androidx.core.app.NotificationCompat.Builder(this, "ride_alerts_cancel")
                        .setSmallIcon(R.mipmap.ic_launcher)
                        .setContentTitle("❌ Viaje ya no disponible")
                        .setContentText("El viaje fue cancelado o asignado a otro móvil.")
                        .setAutoCancel(true);
                nm.notify(orderId.hashCode(), b.build());
            }
            RideAlertController.getInstance().playOneShotSound(getApplicationContext(), "cancel");
            return;
        }

        // Parsear assignmentAttempt con try/catch (default 1)
        int incomingAttempt = 1;
        try {
            String attemptStr = data.get("assignmentAttempt");
            if (attemptStr != null && !attemptStr.isEmpty()) {
                incomingAttempt = Integer.parseInt(attemptStr);
            }
        } catch (NumberFormatException e) {
            Log.e(TAG, "assignmentAttempt inválido, usando default 1.");
        }

        boolean isOfferPush = "ofrecido".equals(type) || "broadcast".equals(type);
        
        if (isOfferPush) {
            // 1. La validación de antigüedad por sentAt se removió debido a desincronizaciones de reloj en Android.

            // 2. Validar contra el Gatekeeper de resoluciones locales
            if (orderId != null && RideStateManager.isResolved(getApplicationContext(), orderId, incomingAttempt)) {
                Log.e(TAG, "=> PUSH DE OFERTA DESCARTADO: viaje ya resuelto (intento " + incomingAttempt + ").");
                return;
            }
            
            Log.e(TAG, "Construyendo notificación interactiva nativa para viaje...");
            showInteractiveNotification(data);
        }

        if ("mensaje".equals(type) || "chat".equals(type)) {
            RideAlertController.getInstance().playOneShotSound(getApplicationContext(), "message");
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            androidx.core.app.NotificationCompat.Builder b = new androidx.core.app.NotificationCompat.Builder(this, "ride_alerts_cancel")
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle("📩 Nuevo Mensaje")
                    .setContentText("Tienes un nuevo mensaje de la central.")
                    .setAutoCancel(true);
            nm.notify((int)System.currentTimeMillis(), b.build());
        } else if ("bocina".equals(type) || "viaje_iniciado".equals(type)) {
            RideAlertController.getInstance().playOneShotSound(getApplicationContext(), type);
        }

        Log.e(TAG, "Pasando mensaje al comportamiento original de Capacitor...");
        Log.e(TAG, "==========================================");

        // Evitamos pasar el mensaje a Capacitor si es una oferta de viaje
        // para evitar que la WebApp corte el sonido nativo en segundo plano
        if (!isOfferPush) {
            super.onMessageReceived(remoteMessage);
        }
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