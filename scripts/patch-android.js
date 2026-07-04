import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'android');

console.log('Iniciando parcheo automático de Android...');

function findFile(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      const found = findFile(fullPath, filename);
      if (found) return found;
    } else if (file === filename) {
      return fullPath;
    }
  }
  return null;
}

function patchManifest() {
  const manifestPath = findFile(androidDir, 'AndroidManifest.xml');
  
  if (!manifestPath) {
    console.error('❌ AndroidManifest.xml no encontrado en la carpeta android/. Asegurate de haber ejecutado "npx cap sync android" antes.');
    return;
  }
  console.log('📄 Encontrado AndroidManifest.xml en:', manifestPath);
  let content = fs.readFileSync(manifestPath, 'utf8');
  let modified = false;

  // Inyectar Permisos de forma idempotente
  if (!content.includes('android.permission.FOREGROUND_SERVICE')) {
    content = content.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n</manifest>`
    );
    modified = true;
  }

  // Inyectar Servicio de forma idempotente
  if (!content.includes('android:name=".DriverForegroundService"')) {
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
  const mainActivityPath = findFile(androidDir, 'MainActivity.java');
  
  if (!mainActivityPath) {
    console.error('❌ MainActivity.java no encontrado en la carpeta android/.');
    return;
  }
  console.log('📄 Encontrado MainActivity.java en:', mainActivityPath);
  
  let content = fs.readFileSync(mainActivityPath, 'utf8');
  let modified = false;

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
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(mainActivityPath, content);
    console.log('✅ MainActivity.java parcheado correctamente para registrar el plugin nativo.');
  } else {
    console.log('⚡ MainActivity.java ya estaba parcheado.');
  }
}

patchManifest();
patchMainActivity();