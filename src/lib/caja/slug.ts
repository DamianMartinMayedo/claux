// Slug del nombre de un punto de venta para el enlace de instalación:
//   /punto-de-venta/<slug>#t=<token>
//
// Es DECORATIVO: sirve para que quien recibe el enlace por WhatsApp vea de qué punto
// es. Nunca identifica —los nombres se repiten entre empresas y se cambian—, así que
// no hace falta que sea único ni estable: quien manda es el token del fragmento.
// Sin dependencias de servidor a propósito: lo usa la vista de configuración, que es
// un componente de cliente.
export function slugPuntoVenta(nombre: string): string {
  return (
    nombre
      // NFD separa la tilde de su letra y el rango ̀-ͯ la borra: "Café" →
      // "cafe", "Ñico" → "nico". Sin esto quedarían %C3%A9 en la URL.
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '')
    // Un nombre solo de símbolos o emojis se queda sin nada que sluguificar.
  ) || 'punto'
}
