// Script para copiar el google-services.json adecuado antes de compilar
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const target = process.argv[2]; // 'driver' o 'cliente'

if (!target) {
  console.error("Por favor, especifica 'driver' o 'cliente'. Ej: node setup-firebase.js driver");
  process.exit(1);
}

const sourceFile = path.join(__dirname, '..', 'secrets', 'android', target, 'google-services.json');
const destFolder = target === 'driver' ? 'android' : 'android-cliente';
const destFile = path.join(__dirname, '..', destFolder, 'app', 'google-services.json');

console.log(`Configurando Firebase para: ${target.toUpperCase()}`);

// Aceptar cualquiera de las dos formas de trabajo:
// 1) archivo maestro en secrets/android/<target>/ (se copia al proyecto Android)
// 2) archivo ya colocado directamente en <android>/app/google-services.json
if (fs.existsSync(sourceFile)) {
  fs.copyFileSync(sourceFile, destFile);
  console.log(`✅ Archivo google-services.json copiado exitosamente a ${destFolder}/app/`);
} else if (fs.existsSync(destFile)) {
  console.log(`✅ google-services.json ya está presente en ${destFolder}/app/; se conserva sin copiar.`);
} else {
  console.log(`⚠️ Advertencia: No se encontró google-services.json para ${target}.`);
  console.log(`Podés colocarlo en ${sourceFile} o directamente en ${destFile}.`);
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
}