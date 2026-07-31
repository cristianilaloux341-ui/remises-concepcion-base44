import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

export function formatTimeBA(dateStr, formatType = "time") {
  if (!dateStr) return "";
  try {
    const safeDateStr = (!dateStr.endsWith("Z") && dateStr.includes("T")) ? dateStr + "Z" : dateStr;
    const d = new Date(safeDateStr);
    if (isNaN(d.getTime())) return dateStr;

    if (formatType === "time") {
      return d.toLocaleTimeString("es-AR", { timeZone: "America/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
    }
    if (formatType === "short") {
      return d.toLocaleString("es-AR", { timeZone: "America/Buenos_Aires", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }
    if (formatType === "full-sec") {
      return d.toLocaleString("es-AR", { timeZone: "America/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    return d.toLocaleString("es-AR", { timeZone: "America/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch(e) {
    return "";
  }
}

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