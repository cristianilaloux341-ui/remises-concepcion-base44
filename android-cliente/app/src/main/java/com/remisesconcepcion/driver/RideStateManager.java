package com.remisesconcepcion.driver;

import android.content.Context;
import android.content.SharedPreferences;

public class RideStateManager {
    private static final String PREF_NAME = "RideStatePrefs";
    private static final String KEY_PREFIX = "order_";
    private static final String TIMESTAMP_PREFIX = "ts_";
    private static final long TTL_MILLIS = 30 * 60 * 1000;

    public static boolean markResolved(Context context, String orderId, int attempt, String resolution) {
        if (orderId == null || orderId.trim().isEmpty()) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        
        String key = KEY_PREFIX + orderId;
        String tsKey = TIMESTAMP_PREFIX + orderId;
        
        int currentStoredAttempt = prefs.getInt(key, -1);
        
        if (attempt >= currentStoredAttempt) {
            return prefs.edit()
                    .putInt(key, attempt)
                    .putString("res_" + orderId, resolution)
                    .putLong(tsKey, System.currentTimeMillis())
                    .commit();
        }
        return false;
    }

    public static boolean isResolved(Context context, String orderId, int attempt) {
        if (orderId == null || orderId.trim().isEmpty()) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        
        String tsKey = TIMESTAMP_PREFIX + orderId;
        long ts = prefs.getLong(tsKey, 0);
        
        if (System.currentTimeMillis() - ts > TTL_MILLIS) {
            cleanup(context, orderId);
            return false;
        }
        
        String key = KEY_PREFIX + orderId;
        int currentStoredAttempt = prefs.getInt(key, -1);
        
        return currentStoredAttempt >= attempt;
    }
    
    private static void cleanup(Context context, String orderId) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        prefs.edit()
             .remove(KEY_PREFIX + orderId)
             .remove(TIMESTAMP_PREFIX + orderId)
             .remove("res_" + orderId)
             .apply();
    }
}