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
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.PowerManager;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;

public class RideAlertController {
    public static final boolean DEBUG = BuildConfig.DEBUG;
    private static final String TAG = "RideAlertController";
    
    private static RideAlertController instance;
    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private String currentOrderId;
    private Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private Runnable timeoutRunnable;

    private RideAlertController() {}

    public static synchronized RideAlertController getInstance() {
        if (instance == null) {
            instance = new RideAlertController();
        }
        return instance;
    }

    private void logDebug(String message) {
        if (DEBUG) {
            Log.d(TAG, message);
        }
    }

    public synchronized void startAlert(Context context, String orderId, String title, String body, Intent acceptIntent, Intent rejectIntent, Intent openAppIntent) {
        logDebug("startAlert: Intentando iniciar alerta para orderId=" + orderId);
        
        // Si ya hay algo sonando, detenerlo primero
        stopAllAlerts(context, "Nuevo viaje entrante reemplaza al anterior");

        currentOrderId = orderId;
        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        String channelId = "ride_alerts_urgent_v4"; // Nuevo ID para forzar Android a recrear el canal en silencio

        // Verificar si existe el canal de Capacitor o crearlo manual si es necesario
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel existingChannel = notificationManager.getNotificationChannel(channelId);
            if (existingChannel == null) {
                Log.e(TAG, "FCM_CHANNEL_NOT_FOUND - Creando canal: " + channelId);
                NotificationChannel channel = new NotificationChannel(
                        channelId,
                        "Alertas de Viaje",
                        NotificationManager.IMPORTANCE_HIGH
                );
                int soundResId = context.getResources().getIdentifier("horn", "raw", context.getPackageName());
                if (soundResId != 0) {
                    Uri soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + soundResId);
                    AudioAttributes audioAttributes = new AudioAttributes.Builder()
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .build();
                    channel.setSound(soundUri, audioAttributes);
                }
                channel.enableVibration(true); 
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                notificationManager.createNotificationChannel(channel);
            } else {
                Log.e(TAG, "Canal " + channelId + " encontrado. Importance: " + existingChannel.getImportance());
            }
        }

        int reqCode = orderId != null ? orderId.hashCode() : 0;
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;

        PendingIntent acceptPendingIntent = PendingIntent.getBroadcast(context, reqCode, acceptIntent, flags);
        PendingIntent rejectPendingIntent = PendingIntent.getBroadcast(context, reqCode + 1, rejectIntent, flags);
        PendingIntent openAppPendingIntent = PendingIntent.getActivity(context, reqCode + 2, openAppIntent, flags);
        
        // DeleteIntent para cuando se desliza
        Intent dismissIntent = new Intent(context, NotificationActionReceiver.class);
        dismissIntent.setAction("ACTION_DISMISS");
        dismissIntent.putExtra("orderId", orderId);
        PendingIntent dismissPendingIntent = PendingIntent.getBroadcast(context, reqCode + 3, dismissIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(openAppPendingIntent)
                .setFullScreenIntent(openAppPendingIntent, true)
                .setDeleteIntent(dismissPendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(0, "✅ ACEPTAR", acceptPendingIntent)
                .addAction(0, "❌ RECHAZAR", rejectPendingIntent);

        // Check POST_NOTIFICATIONS permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                Log.e(TAG, "FCM_PERMISSION_DENIED - Permiso POST_NOTIFICATIONS no concedido");
            }
        }

        // Despertar la pantalla explícitamente
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isInteractive()) {
                PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, TAG + ":WakeLock");
                wl.acquire(5000);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error adquiriendo WakeLock", e);
        }

        notificationManager.notify(reqCode, builder.build());
        Log.e(TAG, "FCM_NOTIFICATION_CREATED - ID " + reqCode);
        logDebug("startAlert: Notificación mostrada con ID " + reqCode);

        // Sonido y Vibración
        try {
            // Intentar primero con el sonido personalizado horn, si no existe usar el tono de llamada (ringtone)
            int soundResId = context.getResources().getIdentifier("horn", "raw", context.getPackageName());
            Uri soundUri;
            if (soundResId != 0) {
                soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + soundResId);
            } else {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (soundUri == null) soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (soundUri == null) soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setDataSource(context, soundUri);
            mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.start();
            logDebug("startAlert: MediaPlayer iniciado");
            
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null) {
                long[] pattern = {0, 500, 200, 500, 200, 1000};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
                logDebug("startAlert: Vibrador iniciado");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error reproduciendo sonido nativo", e);
        }

        // Temporizador de vencimiento (60s)
        timeoutRunnable = () -> {
            logDebug("startAlert: Temporizador vencido para orderId=" + orderId);
            stopAlert(context, orderId, "Vencimiento de temporizador nativo");
            
            // Opcional: Podríamos emitir un Broadcast a React, pero React ya tiene su propio timer
            // y el backend igual auto-reasigna. El propósito principal aquí es el SILENCIO.
        };
        timeoutHandler.postDelayed(timeoutRunnable, 60000);
        logDebug("startAlert: Temporizador de 60s iniciado");
    }

    public synchronized void stopAlert(Context context, String orderId, String reason) {
        if (orderId == null || !orderId.equals(currentOrderId)) {
            logDebug("stopAlert: Ignorado para orderId=" + orderId + " (actual=" + currentOrderId + "). Motivo recibido: " + reason);
            return;
        }
        logDebug("stopAlert: Deteniendo alerta para orderId=" + orderId + ". Motivo: " + reason);
        executeStop(context, orderId);
    }

    public synchronized void stopAllAlerts(Context context, String reason) {
        logDebug("stopAllAlerts: Deteniendo todas las alertas. Motivo: " + reason);
        if (currentOrderId != null) {
            executeStop(context, currentOrderId);
        }
    }

    private void executeStop(Context context, String orderId) {
        if (timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
            timeoutRunnable = null;
            logDebug("executeStop: Temporizador cancelado");
        }

        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.release();
                logDebug("executeStop: MediaPlayer detenido y liberado");
            } catch (Exception e) {
                Log.e(TAG, "Error liberando MediaPlayer", e);
            }
            mediaPlayer = null;
        }

        if (vibrator != null) {
            try { vibrator.cancel(); logDebug("executeStop: Vibración cancelada"); } catch (Exception e) {}
            vibrator = null;
        }

        if (orderId != null) {
            NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            notificationManager.cancel(orderId.hashCode());
            logDebug("executeStop: Notificación cancelada (ID=" + orderId.hashCode() + ")");
        }
        
        currentOrderId = null;
    }

    public synchronized boolean isAlertActive(String orderId) {
        return orderId != null && orderId.equals(currentOrderId) && mediaPlayer != null;
    }

    public synchronized void playOneShotSound(Context context, String type) {
        try {
            String fileName = "message";
            if ("cancel".equals(type)) fileName = "cancel";
            if ("bocina".equals(type)) fileName = "horn";
            if ("viaje_iniciado".equals(type)) fileName = "trip_started";
            
            int soundResId = context.getResources().getIdentifier(fileName, "raw", context.getPackageName());
            if (soundResId == 0) return;
            
            Uri soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + soundResId);
            MediaPlayer mp = new MediaPlayer();
            mp.setDataSource(context, soundUri);
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            mp.setOnCompletionListener(MediaPlayer::release);
            mp.prepare();
            mp.start();
        } catch (Exception e) {
            Log.e(TAG, "Error reproduciendo sonido one-shot", e);
        }
    }
}