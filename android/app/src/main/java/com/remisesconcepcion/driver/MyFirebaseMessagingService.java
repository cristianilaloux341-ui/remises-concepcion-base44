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
        Log.e(TAG, "Tipo: " + (remoteMessage.getNotification() != null ? "Notification+Data" : "Data-only"));
        Log.e(TAG, "From: " + remoteMessage.getFrom());
        Log.e(TAG, "Message ID: " + remoteMessage.getMessageId());
        Log.e(TAG, "Timestamp: " + System.currentTimeMillis());

        if (remoteMessage.getNotification() != null) {
            Log.e(TAG, "Titulo: " + remoteMessage.getNotification().getTitle());
            Log.e(TAG, "Body: " + remoteMessage.getNotification().getBody());
        }

        if (remoteMessage.getData().size() > 0) {
            Log.e(TAG, "Data Completa:");
            for (Map.Entry<String, String> entry : remoteMessage.getData().entrySet()) {
                Log.e(TAG, "   " + entry.getKey() + " = " + entry.getValue());
            }
        }
        Log.e(TAG, "==========================================");

        // Llamamos al super de Capacitor para que el push siga su curso normal
        super.onMessageReceived(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String s) {
        Log.e(TAG, "==== NUEVO FCM TOKEN ==== " + s);
        super.onNewToken(s);
    }
}