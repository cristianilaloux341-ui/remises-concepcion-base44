package com.remisesconcepcion.driver;

import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ForegroundService")
public class ForegroundServicePlugin extends Plugin {

    @PluginMethod
    public void startService(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), DriverForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(getContext(), intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Error starting service", e);
        }
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), DriverForegroundService.class);
            getContext().stopService(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Error stopping service", e);
        }
    }
}