// Revalidación compartida de las superficies con gráficos financieros.
// NO es 'use server': es un helper interno que se invoca desde las actions
// tras cualquier mutación de ventas/gastos/cobros/caja.
//
// El dashboard (widget de contabilidad) y reportes son rutas force-dynamic:
// recomputan sus series de ventas/gastos por moneda en cada carga. Aun así
// marcamos ambas rutas para invalidar la Router Cache de cliente, de modo que
// al volver a esas pestañas tras registrar/anular un gasto, cobro, factura o
// movimiento de tesorería los gráficos reflejen el dato nuevo, no uno cacheado.

import { revalidatePath } from 'next/cache'

export function revalidarFinanzas() {
  revalidatePath('/portal/dashboard')
  revalidatePath('/portal/reportes')
}
