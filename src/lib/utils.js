import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

export function getDriverDisplay(numeroMovil, nombre) {
  let num = "";
  
  // 1. Extraer solo los números (para el N° de Móvil)
  if (numeroMovil) {
    const match = String(numeroMovil).match(/\d+/);
    if (match) num = match[0];
  }

  let cleanName = nombre ? String(nombre).split('_')[0].trim() : "";

  // 2. Si no encontró número en numeroMovil, intentar sacarlo del nombre (ej: "Móvil 14")
  if (!num && cleanName) {
    const match = cleanName.match(/\d+/);
    if (match) num = match[0];
  }

  // 3. Limpiar el nombre para dejar SOLO LETRAS (borra códigos, guiones, patentes, etc)
  cleanName = cleanName.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '').trim().split(' ')[0];

  // Si el nombre quedó vacío o dice "Movil", lo omitimos para no redundar
  if (!cleanName || cleanName.toLowerCase() === "mvil" || cleanName.toLowerCase() === "movil" || cleanName.toLowerCase() === "móvil") {
    cleanName = "";
  }

  // 4. Retornar el formato ultra limpio
  if (num && cleanName) return `${num} - ${cleanName}`;
  if (num) return `${num}`;
  if (cleanName) return cleanName;
  
  return "Chofer";
}