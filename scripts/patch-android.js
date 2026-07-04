import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.resolve(__dirname, '../android/app/src/main/AndroidManifest.xml');
const mainActivityPath = path.resolve(__dirname, '../android/app/src/main/java/com/remisesconcepcion/driver/MainActivity.java');

console.log('Iniciando parcheo automático de Android...');

function patchManifest() {
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ AndroidManifest.xml no encontrado. Asegurate de haber ejecutado "npx cap add android" o "npx cap sync android" antes.');
    return;
  }
  let content = fs.readFileSync(manifestPath, 'utf8');

  let modified = false;

  // Inyectar Permisos
  if (!content.includes('android.permission.FOREGROUND_SERVICE')) {
    content = content.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n</manifest>`
    );
    modified = true;
  }

  // Inyectar Servicio
  if (!content.includes('DriverForegroundService')) {
    content = content.replace(
      '</application>',
      `    <service
        android:name=".DriverForegroundService"
        android:exported="false"
        android:foregroundServiceType="location" />\n    </application>`
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(manifestPath, content);
    console.log('✅ AndroidManifest.xml parcheado correctamente con los permisos y el ForegroundService.');
  } else {
    console.log('⚡ AndroidManifest.xml ya tenía los permisos, no se requirieron cambios.');
  }
}

function patchMainActivity() {
  if (!fs.existsSync(mainActivityPath)) {
    console.error('❌ MainActivity.java no encontrado.');
    return;
  }
  let content = fs.readFileSync(mainActivityPath, 'utf8');

  if (!content.includes('ForegroundServicePlugin.class')) {
    // Agregar Bundle import si no existe
    if (!content.includes('import android.os.Bundle;')) {
      content = content.replace('import com.getcapacitor.BridgeActivity;', 'import com.getcapacitor.BridgeActivity;\nimport android.os.Bundle;');
    }
    
    const onCreateSnippet = `
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(com.remisesconcepcion.driver.ForegroundServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
`;

    if (content.includes('public class MainActivity extends BridgeActivity {')) {
      content = content.replace('public class MainActivity extends BridgeActivity {', 'public class MainActivity extends BridgeActivity {' + onCreateSnippet);
      fs.writeFileSync(mainActivityPath, content);
      console.log('✅ MainActivity.java parcheado correctamente para registrar el plugin nativo.');
    } else {
      console.error('❌ No se encontró la firma de MainActivity para parchear.');
    }
  } else {
    console.log('⚡ MainActivity.java ya estaba parcheado.');
  }
}

patchManifest();
patchMainActivity();