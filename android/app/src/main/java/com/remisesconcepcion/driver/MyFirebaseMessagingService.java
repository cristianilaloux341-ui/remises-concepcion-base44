package com.remisesconcepcion.driver;

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

        if (remoteMessage.getData().size() > 0) {
            Log.e(TAG, "Data Completa:");
            for (Map.Entry<String, String> entry : remoteMessage.getData().entrySet()) {
                Log.e(TAG, "   " + entry.getKey() + " = " + entry.getValue());
            }
        }
        Log.e(TAG, "Pasando mensaje al comportamiento original de Capacitor...");
        Log.e(TAG, "==========================================");

        // Llamamos al super de Capacitor para no alterar la lógica
        super.onMessageReceived(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String s) {
        Log.e(TAG, "==== NUEVO FCM TOKEN ==== " + s);
        super.onNewToken(s);
    }
}