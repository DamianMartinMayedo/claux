'use client'

import { useState, useTransition } from 'react'
import { EyeOff, Loader2, RotateCcw, Save } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { guardarCostoVentas, type CategoriaCosto, type RolPL } from '@/app/actions/portal/dossier'
import { ROLES_PL, ROLES_RESULTADO, ROLES_GUIA, ROLES_FUERA_RESULTADO, ROLES_INGRESO } from '@/lib/pl/estado'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { ConfirmDialog } from '@/components/portal/Dialog'

const ROL_PL_UI: Record<RolPL, { titulo: string; descripcion: string }> = {
  COSTE_VENTAS: {
    titulo: 'Lo que vendes',
    descripcion: 'Mercancía, materia prima o el proveedor del servicio que vendes.',
  },
  PERSONAL: {
    titulo: 'Tu equipo',
    descripcion: 'Sueldos, seguridad social y todo lo que cuesta tu gente.',
  },
  OPERATIVO: {
    titulo: 'Mantener abierto',
    descripcion: 'Alquiler, luz, transporte, publicidad y el día a día.',
  },
  OTRO: {
    titulo: 'Impuestos y financiación',
    descripcion: 'Impuestos, comisiones e intereses, fuera del resultado operativo.',
  },
  // Los tres de la fase 2. No son renglones del resultado: son dinero que se
  // mueve sin que el negocio gane ni pierda por ello. Aquí importan tanto como
  // en Reportes, porque esta pantalla escribe la MISMA columna: una inversión
  // clasificada como gasto operativo hunde el resultado del documento que el
  // dueño le enseña a un inversor, que es el peor sitio posible para el error.
  INVERSION: {
    titulo: 'Inversiones',
    descripcion: 'Lo que compras y te dura años: equipos, obra, vehículos.',
  },
  PATRIMONIO: {
    titulo: 'Movimientos del dueño',
    descripcion: 'Tu dinero entrando o saliendo. Ni ingreso ni gasto.',
  },
  FINANCIACION: {
    titulo: 'Préstamos',
    descripcion: 'El principal prestado y su devolución. Los intereses no.',
  },
  // Fase 3. Aparece aquí porque esta pantalla escribe la MISMA columna y el dueño
  // puede tener categorías de ingreso mezcladas en la lista; sin su etiqueta
  // saldrían con el código crudo. No es una opción que se ofrezca en este paso:
  // el desplegable de abajo solo propone los papeles del GASTO, que es de lo que
  // trata el paso.
  INGRESO_OPERATIVO: {
    titulo: 'Ingresos del negocio',
    descripcion: 'Dinero que ENTRA por lo que vendes, cobrado sin factura.',
  },
  INGRESO_OTRO: {
    titulo: 'Otros ingresos',
    descripcion: 'Lo que entra sin ser lo que vendes: la tasa, un reembolso.',
  },
  // Los dos de la fase 4. Estos SÍ se ofrecen en el desplegable —son renglones
  // del resultado, no del ingreso—, pero no en la guía de arriba: solo existen
  // para quien lleva libros con un contador, y son dos tarjetas más que leer
  // para todos los demás.
  DEPRECIACION: {
    titulo: 'Desgaste de lo que compraste',
    descripcion: 'El reparto anual de un equipo, una obra o un vehículo. No sale de tu caja.',
  },
  IMPUESTO_UTILIDAD: {
    titulo: 'Impuesto sobre utilidades',
    descripcion: 'Se calcula sobre tu resultado, así que se resta debajo de él.',
  },
}

// Paso «Coste de ventas» (solo con `base`): clasifica cada categoría de gasto real
// del cliente por su papel en el estado de resultados. Nivel cliente: el 2º dossier
// hereda.
//
// CONVERGENCIA (F4): esto escribe en `categorias_gastos.rol_pl`, la misma columna
// que lee el informe de Reportes. Antes era un booleano propio del dossier
// (`dossier_costo_ventas`), así que el dueño podía tener «Alquiler» como coste de
// ventas en el documento del inversor y como gasto operativo en su propio informe.
// Clasificar aquí clasifica en los dos sitios, porque es un solo dato.

export default function PasoCostoVentas({
  categorias,
  dossierId,
  categoriasExcluidasIniciales,
  tieneSnapshot,
  onGuardado,
}: {
  dossierId: string
  categorias: CategoriaCosto[]
  categoriasExcluidasIniciales: string[]
  tieneSnapshot: boolean
  onGuardado?: () => void
}) {
  const [estado, setEstado] = useState<Record<string, RolPL>>(
    () => Object.fromEntries(categorias.map(c => [c.categoria_id, c.rol_pl])),
  )
  const [pending, startTransition] = useTransition()
  const [confirmar, setConfirmar] = useState(false)
  const [excluidas, setExcluidas] = useState(categoriasExcluidasIniciales)
  const categoriasVisibles = categorias.filter(c => !excluidas.includes(c.categoria_id))
  const categoriasApartadas = categorias.filter(c => excluidas.includes(c.categoria_id))
  const cuentaDe = (rol: string) =>
    categoriasVisibles.filter(c => (estado[c.categoria_id] ?? 'OPERATIVO') === rol).length

  function ejecutarGuardado() {
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossierId)
      fd.set('clasificacion', JSON.stringify(
        categorias.map(c => ({ categoria_id: c.categoria_id, rol_pl: estado[c.categoria_id] ?? c.rol_pl })),
      ))
      fd.set('categorias_excluidas', JSON.stringify(excluidas))
      const res = await guardarCostoVentas(fd)
      await ld.dismiss()
       if (res.ok) { toastSuccess('Dossier actualizado'); onGuardado?.() }
       else toastError(res.error || 'No se pudo guardar')
    })
  }

  function guardar() {
    if (tieneSnapshot) { setConfirmar(true); return }
    ejecutarGuardado()
  }

  return (
    <section className="card dos-costo-card">
      <div className="dos-body">
        <h2 className="dos-section-title">¿En qué se te va el dinero?</h2>
        <p className="dos-section-hint dos-costo-intro">
          Clasifica tus categorías para que el estado de resultados separe el <strong>margen bruto</strong>,
          el coste de mantener el negocio y los gastos de personal.
        </p>

        <div className="dos-costo-guia">
          <p className="dos-costo-guia-titulo">Qué estás decidiendo</p>
          <p className="dos-costo-guia-texto">
            No cambias importes ni eliminas gastos. Solo indicas qué significa cada categoría.
            Esta clasificación también se usa en Reportes.
          </p>
          {/* La guía explica el WATERFALL, así que enseña los cuatro renglones
              básicos que lo forman (`ROLES_GUIA`). Ni los tres de fuera del
              resultado —que no son renglones— ni los dos de la fase 4 —que solo
              existen para quien lleva libros con contador— entran aquí:
              convertirían una explicación de cuatro tarjetas en una de nueve, que
              ya nadie lee. Se explican donde se eligen: el desplegable los separa
              con su propio encabezado. */}
          <div className="dos-costo-guia-grid">
            {ROLES_GUIA.map(rol => (
              <div key={rol} className="dos-costo-guia-card">
                <strong>{ROL_PL_UI[rol].titulo}</strong>
                <span>{ROL_PL_UI[rol].descripcion}</span>
              </div>
            ))}
          </div>
        </div>

        {categorias.length === 0 ? (
          <PrerequisitoAviso acciones={[{ label: 'Crear categorías de gasto', href: '/portal/gastos?tab=categorias' }]}>
            Aún no tienes categorías de gasto registradas: sin ellas no hay nada que clasificar.
            Créalas en Gastos y vuelve a este paso.
          </PrerequisitoAviso>
        ) : (
          <>
            {/* El recuento enseña los cuatro básicos siempre, y el resto SOLO si
                el dueño ha puesto alguna ahí: un «0 inversiones» permanente
                ocuparía sitio para decir que no pasa nada, y con la fase 4 serían
                cinco ceros seguidos. */}
            <p className="dos-costo-resumen">
              {ROLES_PL
                .filter(rol => (ROLES_GUIA as readonly string[]).includes(rol) || cuentaDe(rol) > 0)
                .map((rol, i) => (
                  <span key={rol}>
                    {i > 0 && ' · '}
                    <strong>{cuentaDe(rol)}</strong>{' '}
                    {ROL_PL_UI[rol].titulo.toLowerCase()}
                  </span>
                ))}
            </p>
            {categoriasVisibles.length > 0 && <ul className="dos-rol-lista">
              {categoriasVisibles.map(c => {
                const rol = estado[c.categoria_id] ?? 'OPERATIVO'
                return (
                  <li key={c.categoria_id} className="dos-rol-fila">
                    <label className="dos-rol-nombre" htmlFor={`rol-${c.categoria_id}`}>{c.categoria}</label>
                    <select
                      id={`rol-${c.categoria_id}`}
                      className="input dos-rol-select"
                      value={rol}
                      onChange={e => setEstado(prev => ({ ...prev, [c.categoria_id]: e.target.value as RolPL }))}
                    >
                      {/* Los dos encabezados son la enseñanza: sin ellos, «Inversiones»
                          parece un renglón más del gasto y se elige por error. */}
                      <optgroup label="En tu resultado">
                        {ROLES_RESULTADO.map(r => <option key={r} value={r}>{ROL_PL_UI[r].titulo}</option>)}
                      </optgroup>
                      <optgroup label="Fuera de tu resultado">
                        {ROLES_FUERA_RESULTADO.map(r => <option key={r} value={r}>{ROL_PL_UI[r].titulo}</option>)}
                      </optgroup>
                      {/* Y las de ingreso, porque esta lista son TODAS las raíces
                          del cliente: sin este grupo, una categoría de ingreso
                          tendría un valor que no está entre las opciones y el
                          desplegable enseñaría la primera —«Lo que vendes»— como
                          si eso fuera lo que hace hoy. */}
                      <optgroup label="Ingresos">
                        {ROLES_INGRESO.map(r => <option key={r} value={r}>{ROL_PL_UI[r].titulo}</option>)}
                      </optgroup>
                    </select>
                    <button
                      type="button" className="dos-costo-excluir"
                      onClick={() => setExcluidas(prev => [...prev, c.categoria_id])}
                      aria-label={`Apartar ${c.categoria} de este dossier`}
                      title="Apartar de este dossier"
                    >
                      <EyeOff size={14} strokeWidth={2} />
                    </button>
                  </li>
                )
              })}
            </ul>}

            {categoriasVisibles.length === 0 && (
              <p className="dos-costo-vacio">Has apartado todas las categorías de este dossier.</p>
            )}

            {categoriasApartadas.length > 0 && (
              <div className="dos-costo-apartadas">
                <p className="dos-costo-apartadas-titulo">Apartadas de este dossier</p>
                <p className="dos-costo-apartadas-ayuda">
                  Siguen existiendo en Contabilidad y sus importes no cambian.
                </p>
                <ul className="dos-costo-apartadas-lista">
                  {categoriasApartadas.map(c => (
                    <li key={c.categoria_id}>
                      <span>{c.categoria}</span>
                      <button
                        type="button" className="btn btn-ghost btn-sm"
                        onClick={() => setExcluidas(prev => prev.filter(id => id !== c.categoria_id))}
                      >
                        <RotateCcw size={13} strokeWidth={2.5} /> Restaurar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="dos-acciones">
              <button className="btn btn-primary" onClick={guardar} disabled={pending}>
                {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Save size={14} strokeWidth={2.5} />}
                Guardar cambios
              </button>
            </div>
          </>
        )}
      </div>
      {confirmar && (
        <ConfirmDialog
          title="Actualizar los números de este dossier"
          body="Se recalcularán los importes y porcentajes usando la clasificación que acabas de elegir. Este cambio solo afecta a este dossier y no modifica Contabilidad ni Reportes."
          confirmLabel="Actualizar dossier"
          cancelLabel="Seguir editando"
          onConfirm={() => { setConfirmar(false); ejecutarGuardado() }}
          onCancel={() => setConfirmar(false)}
        />
      )}
    </section>
  )
}
