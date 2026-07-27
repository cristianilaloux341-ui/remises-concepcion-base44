import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

export function getDriverDisplay(numeroMovil, nombre) {
  const nombreCorto = nombre ? nombre.split(' ')[0] : "Chofer";
  const numDisplay = numeroMovil ? `${numeroMovil}` : "";
  return numDisplay ? `${numDisplay} | ${nombreCorto}` : nombreCorto;
}