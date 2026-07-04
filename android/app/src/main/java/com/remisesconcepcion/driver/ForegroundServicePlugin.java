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
    public void startService(PluginCall call) {
        Log.e("PushDiagnostic", "ForegroundServicePlugin: startService ejecutado por JS");
        try {
            Intent intent = new Intent(getContext(), DriverForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(getContext(), intent);
            } else {
                getContext().startService(intent);
            }
            Log.e("PushDiagnostic", "ForegroundServicePlugin: startService exitoso");
            call.resolve();
        } catch (Exception e) {
            Log.e("PushDiagnostic", "ForegroundServicePlugin: startService ERROR - " + e.getMessage());
            call.reject("Error starting service", e);
        }
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Log.e("PushDiagnostic", "ForegroundServicePlugin: stopService ejecutado por JS");
        try {
            Intent intent = new Intent(getContext(), DriverForegroundService.class);
            getContext().stopService(intent);
            Log.e("PushDiagnostic", "ForegroundServicePlugin: stopService exitoso");
            call.resolve();
        } catch (Exception e) {
            Log.e("PushDiagnostic", "ForegroundServicePlugin: stopService ERROR - " + e.getMessage());
            call.reject("Error stopping service", e);
        }
    }
}