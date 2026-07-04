import fs from 'fs';
import path from 'path';
import process from 'process';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'android');

console.log('Iniciando parcheo automático de Android...');

function findFile(dir, filenameRegex) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      const found = findFile(fullPath, filenameRegex);
      if (found) return found;
    } else if (filenameRegex.test(file)) {
      return fullPath;
    }
  }
  return null;
}

function patchManifest() {
  const manifestPath = findFile(androidDir, /^AndroidManifest\.xml$/);
  
  if (!manifestPath) {
    console.error('❌ AndroidManifest.xml no encontrado en la carpeta android/.');
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
    console.log('✅ AndroidManifest.xml parcheado correctamente.');
  } else {
    console.log('⚡ AndroidManifest.xml ya estaba parcheado.');
  }
}

function patchMainActivity() {
  // Buscamos tanto .java como .kt por si Capacitor o vos cambiaron el lenguaje base
  const mainActivityPath = findFile(androidDir, /^MainActivity\.(java|kt)$/);
  
  if (!mainActivityPath) {
    console.error('❌ MainActivity (Java o Kotlin) no encontrado en la carpeta android/.');
    console.log('Ruta base de búsqueda:', androidDir);
    return;
  }
  
  const isKotlin = mainActivityPath.endsWith('.kt');
  console.log('📄 Encontrado MainActivity (' + (isKotlin ? 'Kotlin' : 'Java') + ') en:', mainActivityPath);
  
  let content = fs.readFileSync(mainActivityPath, 'utf8');
  let modified = false;

  if (isKotlin) {
    // Parcheo para Kotlin
    if (!content.includes('ForegroundServicePlugin::class.java')) {
      if (!content.includes('import android.os.Bundle')) {
        content = content.replace('import com.getcapacitor.BridgeActivity', 'import com.getcapacitor.BridgeActivity\nimport android.os.Bundle');
      }
      const onCreateSnippet = `
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(com.remisesconcepcion.driver.ForegroundServicePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
`;
      if (content.includes('class MainActivity : BridgeActivity() {')) {
        content = content.replace('class MainActivity : BridgeActivity() {', 'class MainActivity : BridgeActivity() {' + onCreateSnippet);
        modified = true;
      }
    }
  } else {
    // Parcheo para Java
    if (!content.includes('ForegroundServicePlugin.class')) {
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
  }

  if (modified) {
    fs.writeFileSync(mainActivityPath, content);
    console.log('✅ MainActivity parcheado correctamente para registrar el plugin nativo.');
  } else {
    console.log('⚡ MainActivity ya estaba parcheado.');
  }
}

patchManifest();
patchMainActivity();