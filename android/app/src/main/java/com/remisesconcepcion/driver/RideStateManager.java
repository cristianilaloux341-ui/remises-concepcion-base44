package com.remisesconcepcion.driver;

import android.content.Context;
import android.content.SharedPreferences;

public class RideStateManager {
    private static final String PREF_NAME = "RideStatePrefs";
    private static final String KEY_PREFIX = "order_";
    private static final String TIMESTAMP_PREFIX = "ts_";
    private static final long TTL_MILLIS = 30 * 60 * 1000;

    private static String getBaseId(String orderId) {
        if (orderId == null) return null;
        if (orderId.contains("_att_")) {
            return orderId.split("_att_")[0];
        }
        return orderId;
    }

    public static boolean markResolved(Context context, String orderId, int attempt, String resolution) {
        if (orderId == null || orderId.trim().isEmpty()) return false;
        String baseId = getBaseId(orderId);
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        
        String key = KEY_PREFIX + baseId;
        String tsKey = TIMESTAMP_PREFIX + baseId;
        
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
        String baseId = getBaseId(orderId);
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        
        String tsKey = TIMESTAMP_PREFIX + baseId;
        long ts = prefs.getLong(tsKey, 0);
        
        if (System.currentTimeMillis() - ts > TTL_MILLIS) {
            cleanup(context, baseId);
            return false;
        }
        
        String key = KEY_PREFIX + baseId;
        int currentStoredAttempt = prefs.getInt(key, -1);
        
        return currentStoredAttempt >= attempt;
    }
    
    private static void cleanup(Context context, String orderId) {
        String baseId = getBaseId(orderId);
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        prefs.edit()
             .remove(KEY_PREFIX + baseId)
             .remove(TIMESTAMP_PREFIX + baseId)
             .remove("res_" + baseId)
             .apply();
    }
}