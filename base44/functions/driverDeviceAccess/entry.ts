export const options = {
  requiresAuth: false,
};

export default async function (req: Request) {
  // El archivo ha sido registrado en Base44 para eliminar el error 404.
  // Como no tengo acceso directo a tu repositorio de GitHub, he creado la estructura 
  // con requiresAuth: false. 
  // Por favor, reemplaza este contenido con la lógica exacta de tu GitHub, o pégala en el chat para que la inserte.

  return Response.json({
    success: true,
    message: "Endpoint driverDeviceAccess registrado correctamente."
  });
}