import { requireAccesoPagina } from '@/lib/admin-guard'
import { listarDiagnosticos } from '@/app/actions/diagnostico'
import { nombresDeNiveles } from '@/lib/niveles-server'
import { obtenerCatalogoPublico } from '@/lib/publico/catalogo'
import { tamanoComoTexto, type RespuestaTamano } from '@/lib/publico/tamano'
import SolicitudesView from './SolicitudesView'

export const dynamic = 'force-dynamic'

export default async function SolicitudesPage() {
  const ctx = await requireAccesoPagina('solicitudes')
  const [leads, nombresNivel, catalogo] = await Promise.all([
    listarDiagnosticos(),
    nombresDeNiveles(),
    obtenerCatalogoPublico(),
  ])

  // El tamaño declarado, ya en lenguaje humano. Se resuelve AQUÍ y no en la
  // vista: `diagnosticos.tamano` guarda índices de nivel, y traducirlos pide el
  // catálogo vivo (los topes de cada nivel y los módulos del sector, que deciden
  // si la tercera pregunta va de productos o de servicios).
  const tamanos: Record<number, RespuestaTamano[]> = {}
  for (const l of leads) {
    if (!l.tamano) continue
    const modulos = catalogo.sectores.find((s) => s.sector === l.sector)?.modulos ?? []
    const lineas = tamanoComoTexto(catalogo.niveles, modulos, l.tamano)
    if (lineas.length) tamanos[l.id] = lineas
  }

  // Sector, necesidades y módulos se guardan por CLAVE, y la ficha las pintaba
  // tal cual: «servicios», «catalogo_qr», «rrhh». Son las etiquetas internas de
  // la tabla, no lo que el visitante leyó al marcarlas. Se traducen aquí porque
  // el catálogo vivo ya está cargado para el tamaño: cero consultas de más.
  const etiquetas = {
    sectores:    Object.fromEntries(catalogo.sectores.map((x) => [x.sector, x.nombre])),
    necesidades: Object.fromEntries(catalogo.necesidades.map((x) => [x.clave, x.etiqueta])),
    modulos:     Object.fromEntries(catalogo.modulos.map((x) => [x.clave, x.nombre])),
  }

  return (
    <SolicitudesView
      leads={leads}
      rol={ctx.rol}
      permisos={ctx.permisos}
      nombresNivel={nombresNivel}
      tamanos={tamanos}
      etiquetas={etiquetas}
    />
  )
}
