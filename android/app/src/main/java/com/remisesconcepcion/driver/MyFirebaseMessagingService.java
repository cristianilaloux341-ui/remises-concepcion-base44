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
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class MyFirebaseMessagingService extends MessagingService {
    private static final String TAG = "PushDiagnostic";
    public static MediaPlayer mediaPlayer;
    public static Vibrator vibrator;

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
        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        String channelId = "ride-alerts-urgent-native";

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    channelId,
                    "Alertas Nativas de Viaje",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setSound(null, null); // Sin sonido del sistema, manejamos el MediaPlayer propio para cortarlo al aceptar/rechazar
            channel.enableVibration(false); // Manejo manual
            notificationManager.createNotificationChannel(channel);
        }

        int reqCode = orderId != null ? orderId.hashCode() : 0;

        Intent acceptIntent = new Intent(context, NotificationActionReceiver.class);
        acceptIntent.setAction("ACTION_ACCEPT");
        acceptIntent.putExtra("orderId", orderId);
        acceptIntent.putExtra("driverId", driverId);
        acceptIntent.putExtra("driverName", driverName);
        acceptIntent.putExtra("base", base);
        acceptIntent.putExtra("apiUrl", apiUrl);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent acceptPendingIntent = PendingIntent.getBroadcast(context, reqCode, acceptIntent, flags);

        Intent rejectIntent = new Intent(context, NotificationActionReceiver.class);
        rejectIntent.setAction("ACTION_REJECT");
        rejectIntent.putExtra("orderId", orderId);
        rejectIntent.putExtra("driverId", driverId);
        rejectIntent.putExtra("apiUrl", apiUrl);
        PendingIntent rejectPendingIntent = PendingIntent.getBroadcast(context, reqCode + 1, rejectIntent, flags);

        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppPendingIntent = PendingIntent.getActivity(context, reqCode + 2, openAppIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setOngoing(true) // Persistente hasta que responda
                .setAutoCancel(false)
                .setContentIntent(openAppPendingIntent)
                .addAction(0, "✅ ACEPTAR", acceptPendingIntent)
                .addAction(0, "❌ RECHAZAR", rejectPendingIntent);

        notificationManager.notify(reqCode, builder.build());

        playAlarmSound(context);
    }

    private void playAlarmSound(Context context) {
        stopAlarmSound();
        try {
            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (soundUri == null) soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setDataSource(context, soundUri);
            mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.start();
            
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null) {
                long[] pattern = {0, 500, 200, 500, 200, 1000};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error reproduciendo sonido nativo", e);
        }
    }

    public static void stopAlarmSound() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception e) {}
            mediaPlayer = null;
        }
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception e) {}
            vibrator = null;
        }
    }

    @Override
    public void onNewToken(@NonNull String s) {
        Log.e(TAG, "==== NUEVO FCM TOKEN ==== " + s);
        super.onNewToken(s);
    }
}