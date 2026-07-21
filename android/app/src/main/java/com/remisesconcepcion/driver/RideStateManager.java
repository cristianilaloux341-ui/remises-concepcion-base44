package com.remisesconcepcion.driver;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.util.Map;

public class RideStateManager {
    private static final String PREF_NAME = "RideStatePrefs";
    private static final long TTL_MILLIS = 10 * 60 * 1000; // 10 minutos

    public static synchronized boolean markResolved(Context context, String orderId, int attempt, String resolution) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        cleanup(prefs); // Evitar crecimiento indefinido

        try {
            JSONObject obj = new JSONObject();
            obj.put("attempt", attempt);
            obj.put("resolution", resolution);
            obj.put("timestamp", System.currentTimeMillis());
            return prefs.edit().putString(orderId, obj.toString()).commit();
        } catch (Exception e) {
            return false;
        }
    }

    public static synchronized boolean isResolved(Context context, String orderId, int incomingAttempt) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        String data = prefs.getString(orderId, null);
        if (data == null) return false;

        try {
            JSONObject obj = new JSONObject(data);
            long timestamp = obj.getLong("timestamp");

            // Validar vigencia (TTL)
            if (System.currentTimeMillis() - timestamp > TTL_MILLIS) {
                return false;
            }

            int storedAttempt = obj.getInt("attempt");
            // Si el push corresponde a un intento igual o anterior al resuelto, lo descartamos
            return incomingAttempt <= storedAttempt;
        } catch (Exception e) {
            return false;
        }
    }

    private static void cleanup(SharedPreferences prefs) {
        long now = System.currentTimeMillis();
        SharedPreferences.Editor editor = prefs.edit();
        boolean changed = false;

        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            try {
                JSONObject obj = new JSONObject(entry.getValue().toString());
                if (now - obj.getLong("timestamp") > TTL_MILLIS) {
                    editor.remove(entry.getKey());
                    changed = true;
                }
            } catch (Exception e) {
                editor.remove(entry.getKey());
                changed = true;
            }
        }
        if (changed) editor.commit();
    }
}