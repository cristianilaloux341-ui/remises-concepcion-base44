package com.remisesconcepcion.driver;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class MyFirebaseMessagingService extends MessagingService {
    private static final String TAG = "ClientPush";
    private static final String CHANNEL_ID = "client_arrival";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");
        String orderId = data.get("orderId");

        if ("bocina".equals(type) || "client_arrival".equals(type)) {
            showArrivalNotification(data);
            super.onMessageReceived(remoteMessage);
            return;
        }

        // El resto de mensajes conserva el manejo normal de Capacitor/FCM.
        super.onMessageReceived(remoteMessage);
    }

    private void showArrivalNotification(Map<String, String> data) {
        Context context = getApplicationContext();
        String orderId = data.get("orderId");
        String clientId = data.get("clientId");
        String sessionToken = data.get("sessionToken");
        String apiUrl = data.get("apiUrl");
        String title = data.get("title");
        String body = data.get("body");

        if (title == null || title.isEmpty()) title = "Tu móvil llegó";
        if (body == null || body.isEmpty()) body = "El remis está afuera. Tocá YA VOY para avisarle al chofer.";

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        Uri sound = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Avisos de llegada", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Avisos cuando el móvil está afuera");
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            channel.setSound(sound, attrs);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent ackIntent = new Intent(context, NotificationActionReceiver.class);
        ackIntent.setAction("ACTION_CLIENT_YA_VOY");
        ackIntent.putExtra("orderId", orderId);
        ackIntent.putExtra("clientId", clientId);
        ackIntent.putExtra("sessionToken", sessionToken);
        ackIntent.putExtra("apiUrl", apiUrl);
        PendingIntent ackPending = PendingIntent.getBroadcast(
                context,
                orderId != null ? orderId.hashCode() : 1,
                ackIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("orderId", orderId);
        PendingIntent openPending = PendingIntent.getActivity(
                context,
                orderId != null ? orderId.hashCode() + 1 : 2,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(context.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setSound(sound)
                .setVibrate(new long[]{0, 250, 150, 250})
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openPending)
                .addAction(0, "YA VOY", ackPending);

        int notificationId = orderId != null ? orderId.hashCode() : 7001;
        manager.notify(notificationId, builder.build());
        Log.i(TAG, "Aviso de llegada mostrado una sola vez para " + orderId);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        Log.i(TAG, "Nuevo token FCM de cliente");
        super.onNewToken(token);
    }
}
