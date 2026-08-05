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

    public synchronized void startAlert(final Context context, final String orderId, String title, String body, Intent acceptIntent, Intent rejectIntent, final Intent openAppIntent) {
        currentAlertInstanceId = java.util.UUID.randomUUID().toString();
        Log.e(TAG, "==== START ALERT INVOCADO ====\n" +
                "Instancia: " + currentAlertInstanceId + "\n" +
                "OrderID: " + orderId + "\n" +
                "Hilo: " + Thread.currentThread().getName());
        stopAllAlerts(context, "Nuevo viaje entrante");
        currentOrderId = orderId;
        
        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        String channelId = "ride_alerts_urgent_v19"; 

        int soundResId = context.getResources().getIdentifier("horn", "raw", context.getPackageName());
        Uri soundUri;
        if (soundResId != 0) {
            soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + soundResId);
        } else {
            soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    channelId,
                    "Alertas de Viaje",
                    NotificationManager.IMPORTANCE_HIGH
            );
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build();
            if (soundUri != null) {
                channel.setSound(soundUri, audioAttributes);
            }
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 1000});
            channel.setBypassDnd(true);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(channel);
        }

        int reqCode = orderId != null ? orderId.hashCode() : 0;
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;

        PendingIntent acceptPendingIntent = PendingIntent.getBroadcast(context, reqCode, acceptIntent, flags);
        PendingIntent rejectPendingIntent = PendingIntent.getBroadcast(context, reqCode + 1, rejectIntent, flags);
        PendingIntent openAppPendingIntent = PendingIntent.getActivity(context, reqCode + 2, openAppIntent, flags);
        
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

        if (soundUri != null) {
            builder.setSound(soundUri);
        }
        builder.setVibrate(new long[]{0, 500, 200, 500, 200, 1000});

        // Despertar la pantalla explícitamente
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
            }
        } catch (Exception e) {}

        android.app.Notification notification = builder.build();
        notification.flags |= android.app.Notification.FLAG_INSISTENT;
        notificationManager.notify(reqCode, notification);

        // --- MANEJO DE AUDIO ROBUSTO (Híbrido Cliente + Delay) ---
        try {
            final Uri finalSoundUri = soundUri;
            android.media.AudioManager audioManager = (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                try {
                    int maxAlarmVol = audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM);
                    audioManager.setStreamVolume(android.media.AudioManager.STREAM_ALARM, maxAlarmVol, 0);
                    // Adquirir AudioFocus
                    audioManager.requestAudioFocus(null, android.media.AudioManager.STREAM_ALARM, android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE);
                } catch (Exception e) {
                    Log.e(TAG, "Error configurando AudioManager", e);
                }
            }

            try {
                Log.d(TAG, "1. INICIO FLUJO AUDIO - Hilo: " + Thread.currentThread().getName());
                if (mediaPlayer != null) {
                    try { 
                        Log.d(TAG, "1a. Liberando mediaPlayer anterior. Hilo: " + Thread.currentThread().getName());
                        if (mediaPlayer.isPlaying()) mediaPlayer.stop(); 
                        mediaPlayer.release(); 
                    } catch(Exception e){
                        Log.e(TAG, "Error liberando mediaPlayer anterior", e);
                    }
                }
                
                Log.d(TAG, "2. new MediaPlayer(). Hilo: " + Thread.currentThread().getName());
                mediaPlayer = new MediaPlayer();
                mediaPlayer.setWakeMode(context, android.os.PowerManager.PARTIAL_WAKE_LOCK);
                mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                
                Log.d(TAG, "3. setDataSource(). Hilo: " + Thread.currentThread().getName());
                mediaPlayer.setDataSource(context, finalSoundUri);
                mediaPlayer.setLooping(true);
                mediaPlayer.setVolume(1.0f, 1.0f);
                
                Log.d(TAG, "4. prepare(). Hilo: " + Thread.currentThread().getName());
                mediaPlayer.prepare();
                Log.d(TAG, "5. prepare() EXITOSO. Hilo: " + Thread.currentThread().getName());
                
                final MediaPlayer pendingPlayer = mediaPlayer;
                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        // CRÍTICO: Evitar condición de carrera con executeStop
                        synchronized (RideAlertController.this) {
                            Log.d(TAG, "6. Ejecutando delay (200ms). Hilo: " + Thread.currentThread().getName());
                            if (mediaPlayer == pendingPlayer && mediaPlayer != null) {
                                try {
                                    Log.d(TAG, "7. start(). Hilo: " + Thread.currentThread().getName());
                                    mediaPlayer.start();
                                    Log.d(TAG, "8. start() EXITOSO.");
                                } catch (IllegalStateException e) {
                                    Log.e(TAG, "9. FALLO CRÍTICO: IllegalStateException en start().", e);
                                } catch (Exception e) {
                                    Log.e(TAG, "9. FALLO: Excepción general en start().", e);
                                }
                            } else {
                                Log.w(TAG, "7. Cancelando start(). Motivo: mediaPlayer cambió o es null.");
                            }
                        }
                    }
                }, 200);
            } catch (Exception ex) {
                Log.e(TAG, "FALLO en flujo principal de audio, usando Ringtone fallback", ex);
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
                    Log.e(TAG, "Error en Ringtone fallback", e3);
                }
            }
            
            // Vibración explícita (Estaba en cliente, faltaba en chofer)
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null) {
                long[] pattern = {0, 500, 200, 500, 200, 1000};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception e) {}

        timeoutRunnable = new Runnable() {
            @Override
            public void run() {
                stopAlert(context, orderId, "Vencimiento");
            }
        };
        timeoutHandler.postDelayed(timeoutRunnable, 60000);
    }

    private String currentAlertInstanceId;

    public synchronized void stopAlert(Context context, String orderId, String reason) {
        Log.e(TAG, "==== STOP ALERT INVOCADO ====\n" +
                "Instancia: " + currentAlertInstanceId + "\n" +
                "OrderID: " + orderId + "\n" +
                "Motivo: " + reason + "\n" +
                "Hilo: " + Thread.currentThread().getName() + "\n" +
                Log.getStackTraceString(new Throwable()));
                
        if (orderId == null || !orderId.equals(currentOrderId)) return;
        executeStop(context, orderId);
    }

    public synchronized void stopAllAlerts(Context context, String reason) {
        Log.e(TAG, "==== STOP ALL ALERTS INVOCADO ====\n" +
                "Instancia: " + currentAlertInstanceId + "\n" +
                "Motivo: " + reason + "\n" +
                "Hilo: " + Thread.currentThread().getName() + "\n" +
                Log.getStackTraceString(new Throwable()));
                
        if (currentOrderId != null) {
            executeStop(context, currentOrderId);
        }
    }

    private void executeStop(Context context, String orderId) {
        Log.e(TAG, "==== EXECUTE STOP INVOCADO ====\n" +
                "Instancia: " + currentAlertInstanceId + "\n" +
                "OrderID: " + orderId + "\n" +
                "Hilo: " + Thread.currentThread().getName() + "\n" +
                Log.getStackTraceString(new Throwable()));
        if (timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
            timeoutRunnable = null;
        }

        if (mediaPlayer != null) {
            try {
                Log.d(TAG, "executeStop: Deteniendo mediaPlayer. Hilo: " + Thread.currentThread().getName());
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                Log.d(TAG, "executeStop: Liberando mediaPlayer.");
                mediaPlayer.release();
                Log.d(TAG, "executeStop: mediaPlayer liberado exitosamente.");
            } catch (Exception e) {
                Log.e(TAG, "executeStop: Error al detener/liberar mediaPlayer.", e);
            } finally {
                mediaPlayer = null;
            }
        }

        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception e) {
                Log.e(TAG, "executeStop: Error al cancelar vibración.", e);
            }
            vibrator = null;
        }

        if (orderId != null) {
            NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            notificationManager.cancel(orderId.hashCode());
        }
        currentOrderId = null;
    }

    public synchronized boolean isAlertActive(String orderId) {
        return orderId != null && orderId.equals(currentOrderId);
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
        } catch (Exception e) {}
    }
}