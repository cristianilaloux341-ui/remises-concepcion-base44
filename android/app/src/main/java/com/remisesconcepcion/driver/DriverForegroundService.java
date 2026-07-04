package com.remisesconcepcion.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;

public class DriverForegroundService extends Service {

    private static final String CHANNEL_ID = "DriverServiceChannel";
    private static final int NOTIFICATION_ID = 1001;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.e("PushDiagnostic", "DriverForegroundService: Service onCreate");
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.e("PushDiagnostic", "DriverForegroundService: Service onStartCommand - Retornando START_STICKY");

        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this,
                0, notificationIntent, PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Remises Concepción")
                .setContentText("Conectado a la base - Esperando viajes")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.e("PushDiagnostic", "DriverForegroundService: Service onTaskRemoved - Aplicación cerrada de recientes");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.e("PushDiagnostic", "DriverForegroundService: Service onDestroy - Destruido por el usuario, el plugin o el OS");
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        Log.e("PushDiagnostic", "DriverForegroundService: Service onTrimMemory - Nivel de memoria: " + level);
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        Log.e("PushDiagnostic", "DriverForegroundService: Service onLowMemory - Memoria crítica");
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "Conexión de la Base",
                    NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription("Mantiene la aplicación conectada a la base.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
}