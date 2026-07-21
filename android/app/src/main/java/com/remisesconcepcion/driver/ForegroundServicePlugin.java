package com.remisesconcepcion.driver;

import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ForegroundService")
public class ForegroundServicePlugin extends Plugin {

    @PluginMethod
    public void stopRideAlert(PluginCall call) {
        String orderId = call.getString("orderId");
        if (orderId != null) {
            RideAlertController.getInstance().stopAlert(getContext(), orderId, "Comando puente desde ReactJS (stopRideAlert)");
        }
        call.resolve();
    }

    @PluginMethod
    public void startService(PluginCall call) {
        Log.e("PushDiagnostic", "ForegroundServicePlugin: startService() llamado desde React JS");
        try {
            Intent intent = new Intent(getContext(), DriverForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(getContext(), intent);
            } else {
                getContext().startService(intent);
            }
            Log.e("PushDiagnostic", "ForegroundServicePlugin: Android aceptó e inició el servicio correctamente");
            call.resolve();
        } catch (Exception e) {
            Log.e("PushDiagnostic", "ForegroundServicePlugin: ERROR al iniciar servicio - " + e.getMessage());
            call.reject("Error starting service", e);
        }
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Log.e("PushDiagnostic", "ForegroundServicePlugin: stopService() llamado desde React JS");
        try {
            Intent intent = new Intent(getContext(), DriverForegroundService.class);
            getContext().stopService(intent);
            Log.e("PushDiagnostic", "ForegroundServicePlugin: Android detuvo el servicio");
            call.resolve();
        } catch (Exception e) {
            Log.e("PushDiagnostic", "ForegroundServicePlugin: ERROR al detener servicio - " + e.getMessage());
            call.reject("Error stopping service", e);
        }
    }
}