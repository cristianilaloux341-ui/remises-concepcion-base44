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
        // Log.d(TAG, message);
    }

    public synchronized void startAlert(final Context context, final String orderId, final String title, final String body, final Intent acceptIntent, final Intent rejectIntent, final Intent openAppIntent) {
        logDebug("startAlert: Intentando iniciar alerta para orderId=" + orderId);
        
        // Si ya hay algo sonando, detenerlo primero
        stopAllAlerts(context, "Nuevo viaje entrante reemplaza al anterior");

        currentOrderId = orderId;
        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        String channelId = "ride_alerts_urgent_v7"; // v7 para forzar recreación de canal con Alarma

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
                Uri channelSoundUri;
                if (soundResId != 0) {
                    channelSoundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + soundResId);
                } else {
                    channelSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                    if (channelSoundUri == null) channelSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                }
                
                if (channelSoundUri != null) {
                    AudioAttributes audioAttributes = new AudioAttributes.Builder()
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .setUsage(AudioAttributes.USAGE_ALARM) // Usar categoría de alarma para saltar restricciones
                            .build();
                    channel.setSound(channelSoundUri, audioAttributes);
                }
                
                channel.enableVibration(true); 
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                channel.setBypassDnd(true); // Intentar saltar el "No Molestar"
                notificationManager.createNotificationChannel(channel);
            } else {
                Log.e(TAG, "Canal " + channelId + " encontrado. Importance: " + existingChannel.getImportance());
            }
        }

        int reqCode = orderId != null ? orderId.hashCode() : 0;
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) { // Android 12 (S)
            flags |= 33554432; // PendingIntent.FLAG_MUTABLE
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

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
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
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
            android.os.PowerManager pm = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isInteractive()) {
                android.os.PowerManager.WakeLock wl = pm.newWakeLock(android.os.PowerManager.FULL_WAKE_LOCK | android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP | android.os.PowerManager.ON_AFTER_RELEASE, TAG + ":WakeLock");
                wl.acquire(5000);
                
                // Forzar el lanzamiento de la actividad. Como el MainActivity tiene showWhenLocked y turnScreenOn,
                // esto encenderá la pantalla de forma confiable aunque Android bloquee el fullScreenIntent por estar en Foreground.
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
        logDebug("startAlert: Notificación mostrada con ID " + reqCode);

        // Sonido y Vibración
        try {
            int soundResId = context.getResources().getIdentifier("horn", "raw", context.getPackageName());
            Uri soundUri;
            if (soundResId != 0) {
                soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + soundResId);
            } else {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (soundUri == null) soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (soundUri == null) soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            
            final Uri finalSoundUri = soundUri;
            android.media.AudioManager audioManager = (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                try {
                    // Forzar volumen de ALARMA agresivamente (salta Do Not Disturb)
                    int maxAlarmVol = audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM);
                    int targetAlarmVol = (int) (maxAlarmVol * 0.85);
                    int currentAlarmVol = audioManager.getStreamVolume(android.media.AudioManager.STREAM_ALARM);
                    
                    if (currentAlarmVol < targetAlarmVol) {
                        audioManager.setStreamVolume(android.media.AudioManager.STREAM_ALARM, targetAlarmVol, 0);
                        Log.e(TAG, "Volumen ALARM subido a " + targetAlarmVol + " (estaba en " + currentAlarmVol + ")");
                    }
                    
                    // Pedir el foco de audio para alarma
                    audioManager.requestAudioFocus(null, android.media.AudioManager.STREAM_ALARM, android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE);
                } catch (Exception e) {
                    Log.e(TAG, "No se pudo forzar volumen (posible Do Not Disturb o permisos)", e);
                }
            }

            try {
                mediaPlayer = new MediaPlayer();
                mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM) // Categoría de Alarma (salta Do Not Disturb en Android 11+)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                mediaPlayer.setDataSource(context, soundUri);
                mediaPlayer.setLooping(true);
                mediaPlayer.setVolume(1.0f, 1.0f);
                
                mediaPlayer.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                    @Override
                    public boolean onError(MediaPlayer mp, int what, int extra) {
                        Log.e(TAG, "MediaPlayer error: " + what + " extra: " + extra);
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
                        } catch(Exception e2) {}
                        return true;
                    }
                });
                // Preparar síncronamente porque estamos en el background thread de FCM (sin Looper)
                mediaPlayer.prepare();
                mediaPlayer.start();
                logDebug("startAlert: MediaPlayer iniciado exitosamente");
            } catch (Exception ex) {
                Log.e(TAG, "Excepcion critica en MediaPlayer, usando Ringtone fallback", ex);
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
                } catch(Exception e3) {
                    Log.e(TAG, "Fallback Ringtone tambien fallo", e3);
                }
            }
            
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
        timeoutRunnable = new Runnable() {
            @Override
            public void run() {
                logDebug("startAlert: Temporizador vencido para orderId=" + orderId);
                stopAlert(context, orderId, "Vencimiento de temporizador nativo");
            }
        };
        timeoutHandler.postDelayed(timeoutRunnable, 60000);
        logDebug("startAlert: Temporizador de 60s iniciado");
    }

    private String getBaseId(String orderId) {
        if (orderId == null) return null;
        if (orderId.contains("_att_")) {
            return orderId.split("_att_")[0];
        }
        return orderId;
    }

    public synchronized void stopAlert(Context context, String orderId, String reason) {
        if (orderId == null || currentOrderId == null) return;
        
        String baseInput = getBaseId(orderId);
        String baseCurrent = getBaseId(currentOrderId);

        if (!baseInput.equals(baseCurrent)) {
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
        if (orderId == null || currentOrderId == null) return false;
        return getBaseId(orderId).equals(getBaseId(currentOrderId)) && mediaPlayer != null;
    }

    public synchronized void playOneShotSound(Context context, String type) {
        try {
            String fileName = "message";
            if ("cancel".equals(type) || "cancelar".equals(type)) fileName = "cancel";
            if ("bocina".equals(type)) fileName = "horn";
            if ("viaje_iniciado".equals(type)) fileName = "trip_started";
            
            int soundResId = context.getResources().getIdentifier(fileName, "raw", context.getPackageName());
            Uri soundUri;
            if (soundResId != 0) {
                soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + soundResId);
            } else {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            if (soundUri == null) return;
            
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            mp.setDataSource(context, soundUri);
            mp.setVolume(1.0f, 1.0f);
            mp.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override
                public void onCompletion(MediaPlayer mediaPlayerObj) {
                    mediaPlayerObj.release();
                }
            });
            mp.prepare();
            mp.start();
        } catch (Exception e) {
            Log.e(TAG, "Error reproduciendo sonido one-shot", e);
        }
    }
}