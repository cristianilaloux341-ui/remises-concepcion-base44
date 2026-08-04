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

    public synchronized void startAlert(final Context context, final String orderId, String title, String body, Intent acceptIntent, Intent rejectIntent, final Intent openAppIntent) {
        logDebug("startAlert: Intentando iniciar alerta para orderId=" + orderId);
        
        // Si ya hay algo sonando, detenerlo primero
        stopAllAlerts(context, "Nuevo viaje entrante reemplaza al anterior");

        currentOrderId = orderId;
        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        String channelId = "ride_alerts_urgent_v13"; // v13 para forzar la recreación del canal

        // Verificar si existe el canal de Capacitor o crearlo manual si es necesario
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    channelId,
                    "Alertas de Viaje",
                    NotificationManager.IMPORTANCE_HIGH
            );
            int soundResId = context.getResources().getIdentifier("horn", "raw", context.getPackageName());
            Uri channelSoundUri;
            if (soundResId != 0) {
                channelSoundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + soundResId);
            } else {
                channelSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            }
            if (channelSoundUri != null) {
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .build();
                channel.setSound(channelSoundUri, audioAttributes);
            }
            channel.enableVibration(true);
            channel.setBypassDnd(true);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(channel);
        }

        int reqCode = orderId != null ? orderId.hashCode() : 0;
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;

        final PendingIntent acceptPendingIntent = PendingIntent.getBroadcast(context, reqCode, acceptIntent, flags);
        PendingIntent rejectPendingIntent = PendingIntent.getBroadcast(context, reqCode + 1, rejectIntent, flags);
        final PendingIntent openAppPendingIntent = PendingIntent.getActivity(context, reqCode + 2, openAppIntent, flags);
        
        // DeleteIntent para cuando se desliza
        Intent dismissIntent = new Intent(context, NotificationActionReceiver.class);
        dismissIntent.setAction("ACTION_DISMISS");
        dismissIntent.putExtra("orderId", orderId);
        PendingIntent dismissPendingIntent = PendingIntent.getBroadcast(context, reqCode + 3, dismissIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setOngoing(true)
                .setAutoCancel(false)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openAppPendingIntent)
                .setFullScreenIntent(openAppPendingIntent, true)
                .setDeleteIntent(dismissPendingIntent)
                .addAction(0, "✅ ACEPTAR", acceptPendingIntent)
                .addAction(0, "❌ RECHAZAR", rejectPendingIntent);

        // --- SOLUCIÓN CRÍTICA DE WAKE LOCK Y PANTALLA ---
        try {
            android.os.PowerManager pm = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isInteractive()) {
                @SuppressWarnings("deprecation")
                android.os.PowerManager.WakeLock wl = pm.newWakeLock(
                        android.os.PowerManager.FULL_WAKE_LOCK | 
                        android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP | 
                        android.os.PowerManager.ON_AFTER_RELEASE, 
                        TAG + ":WakeLock"
                );
                wl.acquire(5000);
                
                // Forzar el lanzamiento de la actividad. Como el MainActivity tiene showWhenLocked y turnScreenOn,
                // esto encenderá la pantalla de forma confiable e invocará el sonido desde la vista principal.
                try {
                    context.startActivity(openAppIntent);
                } catch (Exception ex) {
                    Log.e(TAG, "No se pudo lanzar Activity directamente", ex);
                    try { openAppPendingIntent.send(); } catch(Exception e2) {}
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error adquiriendo WakeLock", e);
        }

        notificationManager.notify(reqCode, builder.build());
        Log.e(TAG, "FCM_NOTIFICATION_CREATED - ID " + reqCode);

        // --- SOLUCIÓN CRÍTICA DE SONIDO EN MAIN THREAD ---
        try {
            int soundResId = context.getResources().getIdentifier("horn", "raw", context.getPackageName());
            Uri soundUri;
            if (soundResId != 0) {
                soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + soundResId);
            } else {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            }
            
            final Uri finalSoundUri = soundUri;

            // --- FORZAR FOCO DE AUDIO Y VOLUMEN AL MÁXIMO ---
            android.media.AudioManager audioManager = (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                try {
                    int maxAlarmVol = audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM);
                    audioManager.setStreamVolume(android.media.AudioManager.STREAM_ALARM, maxAlarmVol, 0);
                    audioManager.requestAudioFocus(null, android.media.AudioManager.STREAM_ALARM, android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE);
                } catch (Exception e) {
                    Log.e(TAG, "No se pudo forzar volumen de audio", e);
                }
            }

            try {
                if (mediaPlayer != null) {
                    try { mediaPlayer.stop(); mediaPlayer.release(); } catch(Exception ignored){}
                }
                mediaPlayer = new MediaPlayer();
                mediaPlayer.setWakeMode(context, android.os.PowerManager.PARTIAL_WAKE_LOCK);
                mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                mediaPlayer.setDataSource(context, finalSoundUri);
                mediaPlayer.setLooping(true);
                mediaPlayer.setVolume(1.0f, 1.0f);
                mediaPlayer.prepare();
                mediaPlayer.start();
                Log.e(TAG, "ÉXITO: MediaPlayer INICIADO correctamente de forma directa");
            } catch (Exception ex) {
                Log.e(TAG, "Fallo MediaPlayer, usando Ringtone fallback", ex);
                try {
                    android.media.Ringtone r = RingtoneManager.getRingtone(context, finalSoundUri);
                    if (r != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            r.setAudioAttributes(new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_ALARM)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .build());
                        }
                        r.play();
                    }
                } catch(Exception e3) {}
            }
            
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

        // Temporizador de vencimiento (60s)
        timeoutRunnable = new Runnable() {
            @Override
            public void run() {
                stopAlert(context, orderId, "Vencimiento de temporizador nativo");
            }
        };
        timeoutHandler.postDelayed(timeoutRunnable, 60000);
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