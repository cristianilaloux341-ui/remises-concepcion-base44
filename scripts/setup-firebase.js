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

if (fs.existsSync(sourceFile)) {
  fs.copyFileSync(sourceFile, destFile);
  console.log(`✅ Archivo google-services.json copiado exitosamente a ${destFolder}/app/`);
} else {
  console.log(`⚠️ Advertencia: No se encontró el archivo ${sourceFile}`);
  console.log(`Por favor, asegúrate de colocar el google-services.json en: /secrets/android/${target}/`);
  // Creamos los directorios para que el usuario sepa donde van
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
}