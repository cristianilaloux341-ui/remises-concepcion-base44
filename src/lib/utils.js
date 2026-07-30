import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

export function getDriverDisplay(numeroMovil, nombre) {
  let cleanName = nombre || "Chofer";
  cleanName = cleanName.split('_att_')[0];
  
  if (cleanName.toLowerCase().startsWith("móvil") || cleanName.toLowerCase().startsWith("movil")) {
    cleanName = cleanName;
  } else {
    cleanName = cleanName.split(' ')[0];
  }

  let numDisplay = "";
  if (numeroMovil) {
    const matched = String(numeroMovil).match(/\d+/);
    if (matched) {
      numDisplay = matched[0];
    }
  }

  if (numDisplay && cleanName.includes(numDisplay)) {
    return cleanName;
  }

  return numDisplay ? `${numDisplay} - ${cleanName}` : cleanName;
}