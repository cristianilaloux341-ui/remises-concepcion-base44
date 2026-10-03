import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { buildRideHistory, loadCompletedRides, periodBounds } from "../../shared/rideReporting.ts";

export const options = { requiresAuth: false };

function safeDriver(driver:any) {
  return { id:driver.id, name:driver.name, phone:driver.phone, vehicle_model:driver.vehicle_model, vehicle_plate:driver.vehicle_plate, status:driver.status,
    dispatch_status:driver.dispatch_status||"normal", queue_authoritative_base:driver.queue_authoritative_base||null,
    queue_position:driver.queue_position??null, bloqueo_post_aceptacion_hasta:driver.bloqueo_post_aceptacion_hasta??null };
}

Deno.serve(async (req) => {
  const base44=createClientFromRequest(req);
  try {
    const payload=await req.json().catch(()=>({}));
    let driver=await base44.asServiceRole.entities.Driver.get(String(payload.driver_id||"")).catch(()=>null);
    const valid=Boolean(driver && driver.device_id===String(payload.device_id||"") && driver.current_session_token===String(payload.access_token||""));
    if(!valid) return Response.json({valid:false},{status:401});
    const load=async(id:any)=>id?await base44.asServiceRole.entities.RideOrder.get(String(id)).catch(()=>null):null;
    let [a,r,n]=await Promise.all([load(driver.active_ride_id),load(driver.reserved_order_id),load(driver.next_order_id)]);
    // La reconciliación no puede devolver indefinidamente una oferta vencida.
    // El motor canónico revalida intento, propietario y aceptación concurrente.
    if (r?.status === "ofrecido" && r.reserved_driver_id === driver.id &&
        r.alert_presented_at && Number(r.alert_presented_assignment_attempt) === Number(r.assignment_attempt) &&
        r.offerExpiresAt != null && Number.isFinite(Number(r.offerExpiresAt)) && Number(r.offerExpiresAt) <= Date.now()) {
      await base44.asServiceRole.functions.invoke("rejectRide", {
        orderId:r.id,driverId:driver.id,assignmentAttempt:Number(r.assignment_attempt),
        source:"timeout",sessionToken:String(payload.access_token||"")
      });
      driver=await base44.asServiceRole.entities.Driver.get(driver.id);
      [a,r,n]=await Promise.all([load(driver.active_ride_id),load(driver.reserved_order_id),load(driver.next_order_id)]);
    }
    const owns=(o:any)=>o&&String(o.driver_id||"")===String(driver.id);
    const active=owns(a)&&["aceptado","en_camino","en_viaje"].includes(String(a.status||""))?a:null;
    const reserved=owns(r)&&["ofrecido","aceptado"].includes(String(r.status||""))?r:null;
    const next=owns(n)&&!["completado","cancelado"].includes(String(n.status||""))?n:null;
    const serverTimeMs=Date.now();
    const now=new Date(serverTimeMs),bounds=periodBounds("day",now);
    const completed=await loadCompletedRides(base44.asServiceRole.entities.RideOrder,driver.id,bounds.from);
    const history=buildRideHistory(completed,"day",now);
    const dayKey=history.day,earnings=history.summary.total,today=history.orders;
    return Response.json({valid:true,server_time:new Date(serverTimeMs).toISOString(),serverTimeMs,daily_summary:{earnings,trips:today.length,day:dayKey},driver:safeDriver(driver),active_order:active,reserved_order:reserved,next_order:next});
  } catch(e) { return Response.json({error:e?.message||"RESTORE_FAILED"},{status:500}); }
});