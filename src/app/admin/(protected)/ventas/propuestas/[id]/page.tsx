import { notFound } from 'next/navigation'
import { requireAccesoPagina } from '@/lib/admin-guard'
import { cargarBorradorParaEditor } from '@/lib/propuesta/cargar'
import { resumirParaEditor } from '@/lib/propuesta/editor'
import {
  listarModulosParaPropuesta, listarPresupuestosVinculables, obtenerPropuesta,
} from '@/app/actions/propuestas'
import PropuestaEditor from './PropuestaEditor'

export const dynamic = 'force-dynamic'

export default async function PropuestaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccesoPagina('propuestas')
  const { id } = await params
  const num = Number(id)
  if (!Number.isInteger(num) || num <= 0) notFound()

  // El borrador ARMADO viaja con lo demás: es lo que deja al editor enseñar en
  // cada caja lo que va a decir el documento, y qué lleva dentro cada sección,
  // sin abrir la presentación en otra pestaña.
  const [detalle, catalogo, presupuestos, borrador] = await Promise.all([
    obtenerPropuesta(num),
    listarModulosParaPropuesta(),
    listarPresupuestosVinculables(),
    cargarBorradorParaEditor(num),
  ])
  if (!detalle || !borrador) notFound()

  return (
    <PropuestaEditor
      detalle={detalle} catalogo={catalogo} presupuestos={presupuestos}
      resumen={resumirParaEditor(borrador.resuelta, borrador.prefill, borrador.capturas)}
    />
  )
}
