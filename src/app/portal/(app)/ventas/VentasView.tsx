'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useMemo, useEffect, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link                   from 'next/link'
import {
  Copy, FileText, Plus, Send, Check, Ban, Clock, FileCheck,
  Archive, ArchiveRestore, Trash2,
} from 'lucide-react'
import {
  ESTADO_OFERTA_LABEL,
  ESTADO_OFERTA_BADGE,
  ESTADO_FACTURA_LABEL,
  ESTADO_FACTURA_BADGE,
  formatearMoneda,
  etiquetaNumero,
  type EstadoOferta,
  type EstadoFactura,
} from './_ventas-helpers'
import {
  cambiarEstadoFactura,
  cambiarEstadoOfertasEnLote,
  cambiarEstadoFacturasEnLote,
  duplicarOfertasEnLote,
  duplicarFacturasEnLote,
  archivarOfertasEnLote,
  archivarFacturasEnLote,
  eliminarOfertasEnLote,
  eliminarFacturasEnLote,
  type ResultadoLote,
  type VentasResumenData,
  type Oferta,
  type FacturaListado,
} from '@/app/actions/portal/ventas'
import { fmtFechaEs }                  from '@/lib/date-utils'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden } from '@/components/TableSort'
import TablaCargando                    from '@/components/portal/TablaCargando'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import { ConfirmDialog }               from '@/components/portal/Dialog'
import BulkBar                         from '@/components/portal/BulkBar'
import HeaderCheck                     from '@/components/portal/HeaderCheck'
import { useConfigurador }             from '@/components/portal/ConfiguradorContext'
import { useRowSelection }             from '@/components/portal/useRowSelection'
import IaTouchpoint                    from '@/components/portal/ia/IaTouchpoint'
import Tabs                            from '@/components/Tabs'
import Filtros                          from '@/components/portal/Filtros'
import AvisoTope from '@/components/portal/AvisoTope'
import ExportarMenu  from '@/components/portal/ExportarMenu'
import { filtroExport, resumenDe, opcionesTercero, type Filtro } from '@/lib/filtros'

interface Props { data: VentasResumenData; initialTab?: Tab; puedeEditar: boolean; children?: React.ReactNode }

type Tab = 'ofertas' | 'facturas'

// Estados desde los que es válido cada destino (espejo del server, para UI).
const OFERTA_DESDE: Record<EstadoOferta, EstadoOferta[]> = {
  BORRADOR: [], ENVIADA: ['BORRADOR'], APROBADA: ['BORRADOR', 'ENVIADA'],
  RECHAZADA: ['BORRADOR', 'ENVIADA'], CADUCADA: ['BORRADOR', 'ENVIADA'],
}
const FACTURA_DESDE: Record<EstadoFactura, EstadoFactura[]> = {
  BORRADOR: [], EMITIDA: ['BORRADOR'], COBRADA: [], ANULADA: ['BORRADOR', 'EMITIDA'],
}
const OFERTA_ELIMINABLE:  EstadoOferta[]  = ['BORRADOR', 'RECHAZADA', 'CADUCADA']
const FACTURA_ELIMINABLE: EstadoFactura[] = ['BORRADOR']

type Confirm = { title: string; body?: string; confirmLabel: string; danger: boolean; run: () => void }

export default function VentasView({ data, initialTab, puedeEditar, children }: Props) {
  const router = useRouter()
  const [tab,          setTab]          = useState<Tab>(initialTab ?? 'ofertas')
  const [cargando,     setCargando]     = useState(false)

  // La pestaña activa se refleja en la URL (`?t=`): así volver desde el detalle
  // de una factura o refrescar conserva la pestaña en vez de saltar a Ofertas.
  // Se preservan los demás parámetros (rango y búsqueda): cambiar de pestaña no puede
  // tirar el filtro que el dueño acaba de poner.
  const params = useSearchParams()
  function cambiarTab(t: Tab) {
    setTab(t)
    const next = new URLSearchParams(params.toString())
    next.set('t', t)
    router.replace(`/portal/ventas?${next.toString()}`, { scroll: false })
  }
  // Los filtros viven en la URL, igual que el rango y la búsqueda: refrescar —o que se caiga
  // la conexión— ya no tira lo que el dueño acababa de poner, y de esta única declaración
  // salen la barra, lo que viaja a la descarga y el texto del desplegable.
  const filtroEmpresa = params.get('empresa') ?? ''
  const filtroCliente = params.get('cliente') ?? ''
  const filtroEstado  = params.get('estado')  ?? ''
  const soloConSaldo  = params.get('saldo') === '1'
  // «Ver archivadas» lo aplica el SERVIDOR: es lo único de esta barra que cambia QUÉ se trae
  // y no cómo se pinta, y traerlas para esconderlas gastaba cupo del techo de 500 filas
  // —desplazando documentos vivos— sin que nada lo dijera.
  const verArchivadas = params.get('archivadas') === '1'
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [isPending, startTransition] = useTransition()

  const ofertasFiltradas  = useMemo(
    () => filtrarOfertas(data.ofertas, filtroEmpresa, filtroCliente, filtroEstado, verArchivadas),
    [data.ofertas, filtroEmpresa, filtroCliente, filtroEstado, verArchivadas])
  const facturasFiltradas = useMemo(
    () => filtrarFacturas(data.facturas, filtroEmpresa, filtroCliente, filtroEstado, verArchivadas)
            .filter(f => !soloConSaldo || f.saldo > 0.005),
    [data.facturas, filtroEmpresa, filtroCliente, filtroEstado, verArchivadas, soloConSaldo])

  // El «de M» es el total REAL del rango, no las filas traídas: decía «12 de 500» cuando en
  // el rango había 900, y esa cifra es justo la que el dueño usa para saber si está viéndolo
  // todo. Las pestañas siguen contando lo traído —es lo que hay cargado para filtrar— pero
  // el «N de M» de la tabla ya no miente.
  const conteoOfertas  = data.total_ofertas
  const conteoFacturas = data.total_facturas

  // Pendiente de cobro POR MONEDA de lo que se está viendo. Sin sumar monedas distintas
  // (no cotizan aquí) y sobre las filas filtradas, no sobre toda la historia.
  const pendienteTotal = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of facturasFiltradas) {
      if (f.saldo > 0.005) m.set(f.moneda, (m.get(f.moneda) ?? 0) + f.saldo)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [facturasFiltradas])

  const ofertaIds  = useMemo(() => ofertasFiltradas.map(o => o.oferta_id),  [ofertasFiltradas])
  const facturaIds = useMemo(() => facturasFiltradas.map(f => f.factura_id), [facturasFiltradas])
  const selOfertas  = useRowSelection(ofertaIds)
  const selFacturas = useRowSelection(facturaIds)

  // Al cambiar de pestaña, limpiar selección para no arrastrar contexto.
  useEffect(() => { selOfertas.clear(); selFacturas.clear() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const { colorOf, nombreOf } = useEmpresas()
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  /**
   * LA DECLARACIÓN. De aquí salen la barra, el `FiltroExport` de la descarga y el texto del
   * desplegable, que antes se escribían tres veces por separado.
   *
   * `escalado` en los que SON columna: mientras el listado quepa entero el navegador filtra
   * al instante y da el mismo resultado; en cuanto hay filas sin traer sube a la consulta,
   * porque un filtro que solo mira las 500 más recientes miente sin decirlo.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'empresa_id', param: 'empresa', label: 'Todas',
      rotulo: 'Empresa',
      valor: filtroEmpresa, widget: 'pastillas', donde: 'escalado',
      ocultarSi: empresasFiltro.length <= 1,
      opciones: empresasFiltro.map(e => ({ valor: e.empresa_id, label: e.nombre, color: e.color })),
    },
    {
      clave: 'tercero', param: 'cliente', label: 'Todos los clientes',
      rotulo: 'Cliente',
      valor: filtroCliente, widget: 'select', donde: 'escalado',
      ocultarSi: data.clientes.length === 0,
      // Agrupados POR EMPRESA: un cliente tiene una ficha por empresa, y la lista plana
      // repetía el mismo nombre tantas veces como fichas, indistinguibles.
      opciones: opcionesTercero(data.clientes, nombreOf, empresasFiltro.length > 1, filtroEmpresa || undefined),
    },
    {
      // Los dos juegos de estados no se solapan, así que el servidor sabe a qué tabla
      // aplicarlo sin que haga falta mandarle la pestaña.
      clave: 'estado', label: 'Todos los estados', valor: filtroEstado,
      rotulo: 'Estado',
      widget: 'select', donde: 'escalado',
      opciones: Object.entries(tab === 'ofertas' ? ESTADO_OFERTA_LABEL : ESTADO_FACTURA_LABEL)
        .map(([k, v]) => ({ valor: k, label: v })),
    },
    {
      clave: 'archivadas', label: 'Ver archivadas', valor: verArchivadas ? '1' : '',
      widget: 'toggle', donde: 'servidor',
    },
    {
      // Derivado del saldo, que se calcula sobre los cobros: no es columna, no puede subir.
      clave: 'con_saldo', label: 'Solo con saldo', valor: soloConSaldo ? '1' : '',
      widget: 'toggle', donde: 'cliente', ocultarSi: tab !== 'facturas',
    },
  ], [filtroEmpresa, filtroCliente, filtroEstado, verArchivadas, soloConSaldo, tab,
      empresasFiltro, data.clientes, nombreOf])

  const empresasConLetra = data.empresas.filter(e => !!e.letra_facturacion)
  const sinSetupEmpresas = data.empresas.length === 0
  const sinMoneda        = data.monedas.length === 0
  const sinLetra         = data.empresas.length > 0 && empresasConLetra.length === 0

  // ── Orquestación de acciones en lote ──
  function ejecutar(fn: () => Promise<ResultadoLote>, sel: { clear: () => void }) {
    const ld = toastLoading('Procesando…')   // fuera de startTransition, si no no se pinta
    startTransition(async () => {
      const r = await fn()
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(`${r.hechas} aplicada${r.hechas === 1 ? '' : 's'}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitida${r.omitidas.length === 1 ? '' : 's'}`)
      if (r.errores.length)  partes.push(`${r.errores.length} con error`)
      const msg = partes.join(' · ') || 'Nada que hacer'
      if (r.hechas > 0 && r.errores.length === 0) toastSuccess(msg)
      else if (r.hechas > 0)                      toastError(msg)
      else                                        toastError(r.omitidas[0]?.motivo ? `Nada aplicado — ${r.omitidas[0].motivo}` : msg)
      sel.clear()
      router.refresh()
    })
  }
  function pedirConfirmacion(c: Confirm) { setConfirm(c) }

  const selData = tab === 'ofertas'
    ? { sel: selOfertas, items: ofertasFiltradas.filter(o => selOfertas.isSelected(o.oferta_id)) }
    : { sel: selFacturas, items: facturasFiltradas.filter(f => selFacturas.isSelected(f.factura_id)) }

  return (
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Ventas</h1>
            <IaTouchpoint tipo="ventas" descripcion="un análisis de tus ventas" />
          </div>
          <p className="page-subtitle">
            Gestiona ofertas comerciales y facturas. Las ofertas aprobadas generan factura automáticamente.
          </p>
        </div>
        <div className="tes-header-actions">
        {/* Los filtros de la barra viajan al fichero: filtrar «vencidas» y bajarse
            todas era la queja. Y el desplegable dice qué se lleva antes de clicar. */}
        <ExportarMenu
          clave={tab === 'ofertas' ? 'ofertas' : 'facturas'}
          /* GENERADOS de la declaración: no hay un objeto que escribir a mano y que se pueda
             quedar corto, ni un resumen que pueda imprimir un código interno. */
          filtro={filtroExport(declaracion, { desde: data.rango.desde, hasta: data.rango.hasta, q: data.q })}
          resumen={resumenDe(declaracion)}
        />
        {puedeEditar && (tab === 'ofertas' ? (
          sinSetupEmpresas || sinMoneda || sinLetra ? (
            <button
              className="btn btn-primary"
              disabled
              title={sinSetupEmpresas ? 'Primero crea una empresa.' : sinMoneda ? 'Primero configura una moneda activa.' : 'Asigna letra de facturación a alguna empresa.'}
            >
              <Plus size={18} strokeWidth={2} /> Nueva oferta
            </button>
          ) : (
            <Link href="/portal/ventas/ofertas/nueva" className="btn btn-primary">
              <Plus size={18} strokeWidth={2} /> Nueva oferta
            </Link>
          )
        ) : (
          sinSetupEmpresas || sinMoneda || sinLetra ? (
            <button
              className="btn btn-primary"
              disabled
              title={sinSetupEmpresas ? 'Primero crea una empresa.' : sinMoneda ? 'Primero configura una moneda activa.' : 'Asigna letra de facturación a alguna empresa.'}
            >
              <Plus size={18} strokeWidth={2} /> Nueva factura
            </button>
          ) : (
            <Link href="/portal/ventas/facturas/nueva" className="btn btn-primary">
              <Plus size={18} strokeWidth={2} /> Nueva factura
            </Link>
          )
        ))}
        </div>
      </div>
      {children}

      {/* ── Prerrequisitos de configuración ── */}
      {sinSetupEmpresas || sinMoneda ? (
        <PrerequisitoAviso acciones={[
          ...(sinSetupEmpresas ? [{ label: 'Crear empresa', href: '/portal/empresas' }] : []),
          ...(sinMoneda ? [{ label: 'Configurar moneda', href: '/portal/monedas' }] : []),
        ]}>
          {sinSetupEmpresas && sinMoneda
            ? <>Para crear ofertas y facturas necesitas <strong>una empresa</strong> y <strong>una moneda activa</strong>.</>
            : sinSetupEmpresas
              ? <>Para crear ofertas y facturas necesitas <strong>una empresa</strong>.</>
              : <>Para crear ofertas y facturas necesitas <strong>una moneda activa</strong>.</>}
        </PrerequisitoAviso>
      ) : sinLetra ? (
        <PrerequisitoAviso acciones={[{ label: 'Ir a Empresas', href: '/portal/empresas' }]}>
          Ninguna de tus empresas tiene <strong>letra de facturación</strong> asignada; configúrala para poder crear ofertas y facturas.
        </PrerequisitoAviso>
      ) : null}

      {/* ── Tabs ── */}
      <Tabs
        ariaLabel="Ofertas y facturas"
        active={tab}
        onChange={cambiarTab}
        tabs={[
          { id: 'ofertas',  label: 'Ofertas',  count: conteoOfertas },
          { id: 'facturas', label: 'Facturas', count: conteoFacturas },
        ]}
      />

      <Filtros
        filtros={declaracion}
        rango={data.rango}
        q={data.q}
        placeholder="Buscar por número, cliente o importe…"
        hayMas={data.hay_mas_ofertas || data.hay_mas_facturas}
        /* Solo la empresa se queda en la fila; el cliente baja al panel. Con las píldoras de
           tres empresas MÁS un desplegable de clientes, la barra envolvía a dos líneas y
           «Filtros» acababa suelto al principio de la segunda. Y el cliente ya se busca por
           nombre en la caja de al lado, que es como se llega a él la mayoría de las veces. */
        visibles={1}
        onCargando={setCargando}
      />

      {/* ── Tabla ── */}
      <TablaCargando activo={cargando}>
      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">
            {tab === 'ofertas' ? 'Ofertas comerciales' : 'Facturas'}
          </h2>
          <span className="text-xs-muted">
            {tab === 'ofertas'
              ? `${ofertasFiltradas.length} de ${conteoOfertas}`
              : `${facturasFiltradas.length} de ${conteoFacturas}`}
            {/* Los totales dicen SOBRE QUÉ se calculan: antes la cabecera sumaba toda la
                historia mientras la tabla enseñaba un filtro. */}
            {tab === 'facturas' && pendienteTotal.length > 0 && (
              <> · Pendiente {pendienteTotal.map(([mon, tot]) => formatearMoneda(tot, mon)).join(' · ')}</>
            )}
          </span>
        </div>

        {((tab === 'ofertas' && data.hay_mas_ofertas) || (tab === 'facturas' && data.hay_mas_facturas)) && (
          <AvisoTope
            mostrados={tab === 'ofertas' ? data.ofertas.length : data.facturas.length}
            total={tab === 'ofertas' ? data.total_ofertas : data.total_facturas}
            limite={data.limite}
            sustantivo={tab === 'ofertas' ? 'ofertas' : 'facturas'}
            femenino
          />
        )}

        {tab === 'ofertas' ? (
          ofertasFiltradas.length === 0 ? (
            <div className="mon-empty">
              <FileText size={18} strokeWidth={2} />
              <p>{conteoOfertas === 0
                ? 'Aún no has creado ninguna oferta. Crea la primera para empezar.'
                : 'No hay ofertas que coincidan con los filtros.'}</p>
            </div>
          ) : (
            <TablaOfertas
              ofertas={ofertasFiltradas}
              empresaNombres={data.empresa_nombres}
              clienteNombres={data.cliente_nombres}
              mostrarEmpresa={data.empresas.length > 1}
              sel={selOfertas}
              puedeEditar={puedeEditar}
            />
          )
        ) : (
          facturasFiltradas.length === 0 ? (
            <div className="mon-empty">
              <FileText size={18} strokeWidth={2} />
              <p>{conteoFacturas === 0
                ? 'Aún no has emitido ninguna factura. Crea una directa o aprueba una oferta.'
                : 'No hay facturas que coincidan con los filtros.'}</p>
            </div>
          ) : (
            <TablaFacturas
              facturas={facturasFiltradas}
              empresaNombres={data.empresa_nombres}
              clienteNombres={data.cliente_nombres}
              mostrarEmpresa={data.empresas.length > 1}
              sel={selFacturas}
              puedeEditar={puedeEditar}
              onEmitir={f => pedirConfirmacion({
                title: `¿Emitir ${etiquetaNumero(f.numero)}?`,
                body: 'Recibirá su número fiscal definitivo (el siguiente de la serie) y ya no podrás editarla.',
                confirmLabel: 'Sí, emitir',
                danger: false,
                run: () => {
                  const ld = toastLoading('Emitiendo…')
                  startTransition(async () => {
                    const r = await cambiarEstadoFactura(f.factura_id, 'EMITIDA')
                    await ld.dismiss()
                    if (!r.ok) { toastError(r.error ?? 'Error al emitir.'); return }
                    toastSuccess('Factura emitida.')
                    router.refresh()
                  })
                },
              })}
            />
          )
        )}
      </div>
      </TablaCargando>

      {/* ── Barra flotante de acciones en lote ── */}
      {puedeEditar && (
      <BulkBar count={selData.sel.count} onClear={selData.sel.clear}>
        {tab === 'ofertas'
          ? <AccionesOfertas
              items={selData.items as Oferta[]} ids={selOfertas.selectedIds}
              disabled={isPending} verArchivadas={verArchivadas}
              ejecutar={fn => ejecutar(fn, selOfertas)} pedirConfirmacion={pedirConfirmacion} />
          : <AccionesFacturas
              items={selData.items as FacturaListado[]} ids={selFacturas.selectedIds}
              disabled={isPending} verArchivadas={verArchivadas}
              ejecutar={fn => ejecutar(fn, selFacturas)} pedirConfirmacion={pedirConfirmacion} />
        }
      </BulkBar>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onConfirm={() => { const run = confirm.run; setConfirm(null); run() }}
          onCancel={() => setConfirm(null)}
        />
      )}

    </div>
  )
}

// ── Botones de acción en lote: OFERTAS ────────────────────────────────────────

function AccionesOfertas({
  items, ids, disabled, verArchivadas, ejecutar, pedirConfirmacion,
}: {
  items: Oferta[]; ids: string[]; disabled: boolean; verArchivadas: boolean
  ejecutar: (fn: () => Promise<ResultadoLote>) => void
  pedirConfirmacion: (c: Confirm) => void
}) {
  const n = ids.length
  const puede = (destino: EstadoOferta) => items.some(o => OFERTA_DESDE[destino].includes(o.estado))
  const hayArchivadas    = items.some(o => o.archivado)
  const hayNoArchivadas  = items.some(o => !o.archivado)
  const hayEliminables   = items.some(o => OFERTA_ELIMINABLE.includes(o.estado) && !o.factura_id)
  // Configurador (modo configuración): puede forzar el borrado de cualquier oferta.
  const esConfigurador   = useConfigurador()
  const forzarBorrado    = esConfigurador && items.some(o => !OFERTA_ELIMINABLE.includes(o.estado) || o.factura_id)

  return (
    <>
      {puede('ENVIADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => cambiarEstadoOfertasEnLote(ids, 'ENVIADA'))}>
          <Send size={14} strokeWidth={2} /> Enviar
        </button>
      )}
      {puede('APROBADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Aprobar ${n} oferta${n === 1 ? '' : 's'}?`,
            body: 'Cada oferta aprobada genera automáticamente su factura en borrador.',
            confirmLabel: 'Sí, aprobar', danger: false,
            run: () => ejecutar(() => cambiarEstadoOfertasEnLote(ids, 'APROBADA')),
          })}>
          <Check size={14} strokeWidth={2} /> Aprobar
        </button>
      )}
      {puede('RECHAZADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Rechazar ${n} oferta${n === 1 ? '' : 's'}?`,
            confirmLabel: 'Rechazar', danger: true,
            run: () => ejecutar(() => cambiarEstadoOfertasEnLote(ids, 'RECHAZADA')),
          })}>
          <Ban size={14} strokeWidth={2} /> Rechazar
        </button>
      )}
      {puede('CADUCADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => cambiarEstadoOfertasEnLote(ids, 'CADUCADA'))}>
          <Clock size={14} strokeWidth={2} /> Caducar
        </button>
      )}
      <button className="btn btn-secondary btn-sm" disabled={disabled}
        onClick={() => ejecutar(() => duplicarOfertasEnLote(ids))}>
        <Copy size={14} strokeWidth={2} /> Duplicar
      </button>
      {hayNoArchivadas && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => archivarOfertasEnLote(ids, true))}>
          <Archive size={14} strokeWidth={2} /> Archivar
        </button>
      )}
      {verArchivadas && hayArchivadas && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => archivarOfertasEnLote(ids, false))}>
          <ArchiveRestore size={14} strokeWidth={2} /> Desarchivar
        </button>
      )}
      {(hayEliminables || esConfigurador) && (
        <button className="btn btn-danger-text btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Eliminar ${n} oferta${n === 1 ? '' : 's'}?`,
            body: forzarBorrado
              ? 'Modo configuración: se eliminarán TODAS las seleccionadas, incluidas las que tienen factura asociada. No se puede deshacer.'
              : 'Solo se eliminan borradores y ofertas rechazadas o caducadas. Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar', danger: true,
            run: () => ejecutar(() => eliminarOfertasEnLote(ids)),
          })}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      )}
    </>
  )
}

// ── Botones de acción en lote: FACTURAS ───────────────────────────────────────

function AccionesFacturas({
  items, ids, disabled, verArchivadas, ejecutar, pedirConfirmacion,
}: {
  items: FacturaListado[]; ids: string[]; disabled: boolean; verArchivadas: boolean
  ejecutar: (fn: () => Promise<ResultadoLote>) => void
  pedirConfirmacion: (c: Confirm) => void
}) {
  const n = ids.length
  const puede = (destino: EstadoFactura) => items.some(f => FACTURA_DESDE[destino].includes(f.estado))
  const hayArchivadas   = items.some(f => f.archivado)
  const hayNoArchivadas = items.some(f => !f.archivado)
  const hayEliminables  = items.some(f => FACTURA_ELIMINABLE.includes(f.estado))
  // Configurador (modo configuración): puede forzar el borrado de cualquier factura.
  const esConfigurador  = useConfigurador()
  const forzarBorrado   = esConfigurador && items.some(f => !FACTURA_ELIMINABLE.includes(f.estado))

  return (
    <>
      {puede('EMITIDA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Emitir ${n} factura${n === 1 ? '' : 's'}?`,
            body: 'Una vez emitidas ya no se pueden editar; solo cobrar o anular.',
            confirmLabel: 'Sí, emitir', danger: false,
            run: () => ejecutar(() => cambiarEstadoFacturasEnLote(ids, 'EMITIDA')),
          })}>
          <FileCheck size={14} strokeWidth={2} /> Emitir
        </button>
      )}
      {puede('ANULADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Anular ${n} factura${n === 1 ? '' : 's'}?`,
            body: 'Anular deja registro pero invalida el documento. No se puede deshacer.',
            confirmLabel: 'Anular', danger: true,
            run: () => ejecutar(() => cambiarEstadoFacturasEnLote(ids, 'ANULADA')),
          })}>
          <Ban size={14} strokeWidth={2} /> Anular
        </button>
      )}
      <button className="btn btn-secondary btn-sm" disabled={disabled}
        onClick={() => ejecutar(() => duplicarFacturasEnLote(ids))}>
        <Copy size={14} strokeWidth={2} /> Duplicar
      </button>
      {hayNoArchivadas && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => archivarFacturasEnLote(ids, true))}>
          <Archive size={14} strokeWidth={2} /> Archivar
        </button>
      )}
      {verArchivadas && hayArchivadas && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => archivarFacturasEnLote(ids, false))}>
          <ArchiveRestore size={14} strokeWidth={2} /> Desarchivar
        </button>
      )}
      {(hayEliminables || esConfigurador) && (
        <button className="btn btn-danger-text btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Eliminar ${n} factura${n === 1 ? '' : 's'}?`,
            body: forzarBorrado
              ? 'Modo configuración: se eliminarán TODAS las seleccionadas, incluidas emitidas o anuladas, junto con sus cobros en Tesorería. No se puede deshacer.'
              : 'Solo se eliminan facturas en borrador. Las emitidas se anulan, no se borran. No se puede deshacer.',
            confirmLabel: 'Eliminar', danger: true,
            run: () => ejecutar(() => eliminarFacturasEnLote(ids)),
          })}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      )}
    </>
  )
}

type SelApi = ReturnType<typeof useRowSelection>

// ── Tabla de ofertas ──────────────────────────────────────────────────────────

function TablaOfertas({
  ofertas, empresaNombres, clienteNombres, mostrarEmpresa, sel, puedeEditar,
}: {
  ofertas: Oferta[]
  empresaNombres: Record<string, string>
  clienteNombres: Record<string, string>
  mostrarEmpresa: boolean
  sel: SelApi
  puedeEditar: boolean
}) {
  const router = useRouter()
  const { colorOf } = useEmpresas()
  const ord = useOrden(ofertas, {
    numero:  { label: 'Número',  valor: o => o.numero },
    fecha:   { label: 'Fecha',   valor: o => o.fecha_emision },
    empresa: { label: 'Empresa', valor: o => empresaNombres[o.empresa_id] ?? o.empresa_id },
    cliente: { label: 'Cliente', valor: o => clienteNombres[o.cliente_id] ?? o.cliente_id },
    estado:  { label: 'Estado',  valor: o => o.estado },
    total:   { label: 'Total',   valor: o => Number(o.total) },
  })
  const { pageItems, ...pag } = usePagination(ord.filas)
  return (
    <>
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            {puedeEditar && (
              <th className="col-check">
                <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
              </th>
            )}
            <ThOrden orden={ord} clave="numero" />
            <ThOrden orden={ord} clave="fecha" />
            {mostrarEmpresa && <ThOrden orden={ord} clave="empresa" />}
            <ThOrden orden={ord} clave="cliente" />
            <ThOrden orden={ord} clave="estado" />
            <ThOrden orden={ord} clave="total" className="col-num" />
          </tr>
        </thead>
        <tbody>
          {pageItems.map(o => (
            <tr
              key={o.oferta_id}
              className={`table-row-clickable${mostrarEmpresa ? ' row-empresa-accent' : ''}`}
              style={mostrarEmpresa ? empresaColorVar(colorOf(o.empresa_id)) : undefined}
              onClick={() => router.push(`/portal/ventas/ofertas/${o.oferta_id}`)}
            >
              {puedeEditar && (
                <td className="col-check" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" className="row-check"
                    checked={sel.isSelected(o.oferta_id)}
                    onChange={() => sel.toggle(o.oferta_id)}
                    aria-label={`Seleccionar ${o.numero}`} />
                </td>
              )}
              <td data-label="Número">
                <Link href={`/portal/ventas/ofertas/${o.oferta_id}`} className="ven-link-numero" onClick={(e) => e.stopPropagation()}>
                  {o.numero}
                </Link>
              </td>
              <td data-label="Fecha" className="text-sm-muted">
                {fmtFechaEs(o.fecha_emision)}
              </td>
              {mostrarEmpresa && (
                <td data-label="Empresa">
                  <EmpresaTag color={colorOf(o.empresa_id)} nombre={empresaNombres[o.empresa_id] ?? o.empresa_id} />
                </td>
              )}
              <td data-label="Cliente"><span className="cell-clamp">{clienteNombres[o.cliente_id] ?? o.cliente_id}</span></td>
              <td data-label="Estado">
                <BadgeOferta estado={o.estado} />
                {o.archivado && <span className="badge badge-neutral ven-badge-archivada">Archivada</span>}
              </td>
              <td data-label="Total" className="col-num">
                {formatearMoneda(Number(o.total), o.moneda)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <TablePagination {...pag} label="oferta" />
    </>
  )
}

// ── Tabla de facturas ─────────────────────────────────────────────────────────

function TablaFacturas({
  facturas, empresaNombres, clienteNombres, mostrarEmpresa, sel, onEmitir, puedeEditar,
}: {
  facturas: FacturaListado[]
  empresaNombres: Record<string, string>
  clienteNombres: Record<string, string>
  mostrarEmpresa: boolean
  sel: SelApi
  /** Emitir desde la fila. Antes solo existía en lote: para emitir UNA factura había que
   *  seleccionarla o entrar en su ficha, que es el camino más largo al gesto más común. */
  onEmitir: (f: FacturaListado) => void
  puedeEditar: boolean
}) {
  const router = useRouter()
  const { colorOf } = useEmpresas()
  const ord = useOrden(facturas, {
    numero:      { label: 'Número',      valor: f => etiquetaNumero(f.numero) },
    fecha:       { label: 'Fecha',       valor: f => f.fecha_emision },
    empresa:     { label: 'Empresa',     valor: f => empresaNombres[f.empresa_id] ?? f.empresa_id },
    cliente:     { label: 'Cliente',     valor: f => clienteNombres[f.cliente_id] ?? f.cliente_id },
    vencimiento: { label: 'Vencimiento', valor: f => f.fecha_vencimiento },
    estado:      { label: 'Estado',      valor: f => f.estado },
    total:       { label: 'Total',       valor: f => Number(f.total) },
    pendiente:   { label: 'Pendiente',   valor: f => f.saldo > 0.005 ? f.saldo : null },
  })
  const { pageItems, ...pag } = usePagination(ord.filas)
  return (
    <>
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            {puedeEditar && (
              <th className="col-check">
                <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
              </th>
            )}
            <ThOrden orden={ord} clave="numero" />
            <ThOrden orden={ord} clave="fecha" />
            {mostrarEmpresa && <ThOrden orden={ord} clave="empresa" />}
            <ThOrden orden={ord} clave="cliente" />
            <ThOrden orden={ord} clave="vencimiento" />
            <ThOrden orden={ord} clave="estado" />
            <ThOrden orden={ord} clave="total" className="col-num" />
            <ThOrden orden={ord} clave="pendiente" className="col-num" />
            {puedeEditar && <th className="col-actions"></th>}
          </tr>
        </thead>
        <tbody>
          {pageItems.map(f => (
            <tr
              key={f.factura_id}
              className={`table-row-clickable${mostrarEmpresa ? ' row-empresa-accent' : ''}`}
              style={mostrarEmpresa ? empresaColorVar(colorOf(f.empresa_id)) : undefined}
              onClick={() => router.push(`/portal/ventas/facturas/${f.factura_id}`)}
            >
              {puedeEditar && (
              <td className="col-check" onClick={e => e.stopPropagation()}>
                <input type="checkbox" className="row-check"
                  checked={sel.isSelected(f.factura_id)}
                  onChange={() => sel.toggle(f.factura_id)}
                  aria-label={`Seleccionar ${etiquetaNumero(f.numero)}`} />
              </td>
              )}
              <td data-label="Número">
                <Link href={`/portal/ventas/facturas/${f.factura_id}`} className="ven-link-numero" onClick={(e) => e.stopPropagation()}>
                  {etiquetaNumero(f.numero)}
                </Link>
              </td>
              <td data-label="Fecha" className="text-sm-muted">
                {fmtFechaEs(f.fecha_emision)}
              </td>
              {mostrarEmpresa && (
                <td data-label="Empresa">
                  <EmpresaTag color={colorOf(f.empresa_id)} nombre={empresaNombres[f.empresa_id] ?? f.empresa_id} />
                </td>
              )}
              <td data-label="Cliente"><span className="cell-clamp">{clienteNombres[f.cliente_id] ?? f.cliente_id}</span></td>
              <td data-label="Vencimiento" className="text-sm-muted">
                {f.fecha_vencimiento ? fmtFechaEs(f.fecha_vencimiento) : '—'}
              </td>
              <td data-label="Estado">
                <BadgeFactura estado={f.estado} />
                {/* «Parcial» es DERIVADO (hay cobros y queda saldo); el estado persistido
                    sigue siendo EMITIDA, igual que en Gastos y cobros. */}
                {f.parcial && <span className="badge badge-warning ven-badge-archivada">Parcial</span>}
                {f.archivado && <span className="badge badge-neutral ven-badge-archivada">Archivada</span>}
              </td>
              <td data-label="Total" className="col-num">
                {formatearMoneda(Number(f.total), f.moneda)}
              </td>
              <td data-label="Pendiente" className="col-num">
                {f.saldo > 0.005 ? (
                  <>
                    {formatearMoneda(f.saldo, f.moneda)}
                    {f.dias_vencido != null && (
                      <div className="ven-vencida-hint">
                        Vencida {f.dias_vencido} {f.dias_vencido === 1 ? 'día' : 'días'}
                      </div>
                    )}
                  </>
                ) : <span className="text-muted">—</span>}
              </td>
              {/* Una sola acción → icono directo, sin menú «⋯» (regla de UI §3). Solo en
                  BORRADOR: en cualquier otro estado la fila no tiene nada que ofrecer. */}
              {puedeEditar && (
                <td className="col-actions" onClick={e => e.stopPropagation()}>
                  {f.estado === 'BORRADOR' && !f.archivado && (
                    <button
                      type="button"
                      className="ter-action-btn"
                      onClick={() => onEmitir(f)}
                      aria-label={`Emitir ${etiquetaNumero(f.numero)}`}
                      title="Emitir"
                    >
                      <FileCheck size={14} strokeWidth={2} />
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <TablePagination {...pag} label="factura" />
    </>
  )
}

// ── Badges ────────────────────────────────────────────────────────────────────

function BadgeOferta({ estado }: { estado: EstadoOferta }) {
  return (
    <span className={`badge ${ESTADO_OFERTA_BADGE[estado] ?? 'badge-neutral'}`}>
      {ESTADO_OFERTA_LABEL[estado]}
    </span>
  )
}

function BadgeFactura({ estado }: { estado: EstadoFactura }) {
  return (
    <span className={`badge ${ESTADO_FACTURA_BADGE[estado] ?? 'badge-neutral'}`}>
      {ESTADO_FACTURA_LABEL[estado]}
    </span>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function filtrarOfertas(
  arr: Oferta[], empresa: string, cliente: string, estado: string, verArchivadas: boolean,
): Oferta[] {
  return arr.filter(o => {
    if (!verArchivadas && o.archivado) return false
    if (empresa && o.empresa_id !== empresa) return false
    if (cliente && o.cliente_id !== cliente) return false
    if (estado  && o.estado     !== estado)  return false
    return true
  })
}

function filtrarFacturas(
  arr: FacturaListado[], empresa: string, cliente: string, estado: string, verArchivadas: boolean,
): FacturaListado[] {
  return arr.filter(f => {
    if (!verArchivadas && f.archivado) return false
    if (empresa && f.empresa_id !== empresa) return false
    if (cliente && f.cliente_id !== cliente) return false
    if (estado  && f.estado     !== estado)  return false
    return true
  })
}
