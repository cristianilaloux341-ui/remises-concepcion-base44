package com.remisesconcepcion.cliente;

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
    private static final String CHANNEL_ID = "client_arrival_v2";

    @Override public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String,String> data = remoteMessage.getData();
        String type = data.get("type");
        if ("bocina".equals(type) || "client_arrival".equals(type)) {
            showArrivalNotification(data);
            return;
        }
        super.onMessageReceived(remoteMessage);
    }

    private void showArrivalNotification(Map<String,String> data) {
        Context context = getApplicationContext();
        String orderId = data.get("orderId");
        String noticeNumberRaw = data.get("noticeNumber");
        int noticeNumber = 1;
        try { noticeNumber = Math.max(1, Integer.parseInt(noticeNumberRaw)); } catch (Exception ignored) {}

        String title = data.get("title");
        String body = data.get("body");
        if (title == null || title.isEmpty()) title = "Tu móvil está afuera";
        if (body == null || body.isEmpty()) {
            body = noticeNumber >= 2
                    ? "Segundo aviso: tu móvil te está esperando. Tocá YA VOY para avisarle al chofer."
                    : "Tu móvil llegó. Tocá YA VOY para avisarle al chofer.";
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        int hornResId = context.getResources().getIdentifier("horn", "raw", context.getPackageName());
        Uri sound = hornResId != 0
                ? Uri.parse("android.resource://" + context.getPackageName() + "/" + hornResId)
                : android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Avisos de llegada", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Bocina cuando el móvil está afuera");
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            channel.setSound(sound, attrs);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("orderId", orderId);
        int requestCode = ((orderId != null ? orderId.hashCode() : 7001) * 31) + noticeNumber;
        PendingIntent openPending = PendingIntent.getActivity(context, requestCode, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // YA VOY no recibe ni transporta credenciales. Solo marca la intención del usuario;
        // MainActivity entrega el orderId al WebView y la app confirma con su sesión local autenticada.
        Intent yaVoyIntent = new Intent(context, MainActivity.class);
        yaVoyIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        yaVoyIntent.putExtra("orderId", orderId);
        yaVoyIntent.putExtra("clientAction", "YA_VOY");
        PendingIntent yaVoyPending = PendingIntent.getActivity(context, requestCode + 100000, yaVoyIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

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
                .setOnlyAlertOnce(false)
                .setContentIntent(openPending)
                .addAction(0, "YA VOY", yaVoyPending);

        int notificationId = ((orderId != null ? orderId.hashCode() : 7001) * 31) + noticeNumber;
        manager.notify(notificationId, builder.build());
        Log.i(TAG, "Aviso de llegada " + noticeNumber + " mostrado para " + orderId + (hornResId != 0 ? " con horn.mp3" : " con sonido fallback"));
    }

    @Override public void onNewToken(@NonNull String token) {
        Log.i(TAG, "Nuevo token FCM de cliente");
        super.onNewToken(token);
    }
}
