# Guía de Configuración Nativa - Android Studio

Para que la app despierte la pantalla y suene fuerte cuando está bloqueada, tenés que agregar estas configuraciones en tu proyecto de Android Studio una vez que lo compiles.

## 1. Archivo `android/app/src/main/AndroidManifest.xml`

Agregá estos permisos justo arriba de la etiqueta `<application>`:

```xml
    <!-- Permisos para notificaciones y despertar la pantalla -->
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.DISABLE_KEYGUARD" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Dentro de `<activity android:name=".MainActivity" ...>` agregá estas propiedades para que la app pueda mostrarse sobre la pantalla de bloqueo:

```xml
    android:showWhenLocked="true"
    android:turnScreenOn="true"
```

## 2. Archivo `android/app/src/main/java/com/remisesconcepcion/driver/MainActivity.java`

Abrí tu `MainActivity.java` y agregá este código dentro del método `onCreate` para asegurar que el celular encienda la pantalla y rompa el reposo (Doze) cuando llega un viaje:

```java
package com.remisesconcepcion.driver;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Despertar pantalla y mostrar sobre el bloqueo
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );
    }
}
```

## Pasos para compilar:
1. En esta terminal (o en tu compu) ejecutá: `npm run build`
2. Luego: `npx cap sync android`
3. Abrí el proyecto en Android Studio: `npx cap open android`
4. Pegá los permisos y el código de arriba.
5. ¡Compilá el APK!