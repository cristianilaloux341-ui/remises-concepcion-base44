import { base44 } from "@/api/base44Client";

export async function resolvePanicAlert(alertId) {
  const response = await base44.functions.invoke("resolvePanicAlert", {
    alertId,
    sessionToken: sessionStorage.getItem("local_operator_token") || "",
  });
  if (!response.data?.success) {
    throw new Error(response.data?.error || "No se pudo marcar la alerta como atendida.");
  }
  return response.data;
}
