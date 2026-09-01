'use client'

// Las piezas propias de una MIGRACIÓN DESDE LIANGAPP dentro del asistente de
// importar. Los cinco pasos son los mismos (plan, D6): lo que cambia es qué se
// pinta en «Subir», en «Reconocer» (el antiguo mapear) y en «Listo».
//
// El catálogo de gasto se importa aquí, en el cliente: son 93 entradas de datos
// puros y así elegir categoría no cuesta una consulta con la conexión de Cuba.

import { useRef } from 'react'
import { AlertTriangle, Check, CheckCircle2, Download, FileSpreadsheet, Plus, RefreshCw, X } from 'lucide-react'
import { formatearImporte } from '@/lib/importador/util'
import { OPCIONES_GASTO } from '@/lib/importador/origenes/liangapp/reglas'
import type {
  FacturaDetectada, FichaArchivo, FilaCuadre, GrupoPropuesto, MigracionLeida,
} from '@/lib/importador/origenes/liangapp/migracion'

/** Lo que el asistente guarda de una migración mientras dura. */
export interface MigracionEstado {
  migracion_id: string
  empresa: string
  periodo: string
  fichas: FichaArchivo[]
  cuadre: FilaCuadre[]
  utilidad: MigracionLeida['utilidad']
  sinArchivo: MigracionLeida['sinArchivo']
  facturas: FacturaDetectada[]
  grupos: GrupoPropuesto[]
  avisos: string[]
  errores: string[]
  lotes: { lote_id: string; entidad: string; etiqueta: string; filas: number; columnas: Record<string, string> }[]
}

/** ¿Hay estado de rendimiento? Sin él no se puede aplicar (plan, D2). */
export function conEstado(mig: MigracionEstado): boolean {
  return mig.fichas.some(f => f.tipo === 'estado')
}

/** ¿Cuadra todo lo que se va a importar? Las cuentas apartadas no cuentan. */
export function cuadraTodo(mig: MigracionEstado, excluidas: number[]): boolean {
  const cuentan = mig.cuadre.filter(f => !excluidas.includes(f.cuenta))
  return conEstado(mig) && cuentan.length > 0 && cuentan.every(f => f.cuadra)
}

/** Una tarjeta por archivo: qué se ha entendido de él y si entra o no. */
export function FichasLiangApp({
  fichas, excluidas, onApartar, onQuitar, onCambiarEstado, onAnadir, cargando, sinArchivos,
}: {
  fichas: FichaArchivo[]
  excluidas: number[]
  onApartar: (cuenta: number, dentro: boolean) => void
  /** Sacar un archivo del conjunto: es lo que arregla el que se subió mal. */
  onQuitar: (nombre: string) => void
  /** El estado de rendimiento no se quita —sin él no hay migración—: se cambia. */
  onCambiarEstado: () => void
  onAnadir: (e: React.ChangeEvent<HTMLInputElement>) => void
  cargando: boolean
  /** El conjunto ya no está en la pestaña: se puede seguir, pero no retocarlo. */
  sinArchivos: boolean
}) {
  const masRef = useRef<HTMLInputElement>(null)
  return (
    <div className="imprt-mig-fichas">
      {fichas.map(f => {
        const fuera = f.cuenta !== null && excluidas.includes(f.cuenta)
        return (
          <article key={f.nombre} className={`imprt-mig-ficha ${fuera || f.tipo === 'no-reconocido' ? 'imprt-mig-ficha-fuera' : ''}`}>
            <div className="imprt-mig-ficha-cab">
              <FileSpreadsheet size={16} strokeWidth={1.75} />
              <span className="imprt-mig-ficha-nombre" title={f.nombre}>{f.nombre}</span>
              {f.tipo === 'estado' ? (
                <button type="button" className="btn-icon imprt-mig-quitar"
                  onClick={onCambiarEstado} disabled={cargando || sinArchivos}
                  aria-label={`Cambiar ${f.nombre}`} title="Cambiar este archivo">
                  <RefreshCw size={14} strokeWidth={2} />
                </button>
              ) : (
                <button type="button" className="btn-icon btn-icon-danger imprt-mig-quitar"
                  onClick={() => onQuitar(f.nombre)} disabled={cargando || sinArchivos}
                  aria-label={`Quitar ${f.nombre}`} title="Quitar este archivo">
                  <X size={14} strokeWidth={2} />
                </button>
              )}
            </div>

            {f.tipo === 'no-reconocido' ? (
              <p className="imprt-mig-ficha-que">No es un reporte de LiangApp. Se queda fuera.</p>
            ) : f.tipo === 'estado' ? (
              <p className="imprt-mig-ficha-que">{f.etiqueta}</p>
            ) : (
              <>
                <p className="imprt-mig-ficha-que">
                  <strong>Cuenta {f.cuenta}</strong> · {f.nombreCuenta}
                </p>
                <p className="imprt-mig-ficha-destino">
                  {f.entidad ? <>Entra como <strong>{f.etiqueta}</strong></> : (f.motivo ?? 'No se importa')}
                </p>
                <dl className="imprt-mig-ficha-datos">
                  <div><dt>Líneas</dt><dd>{f.lineas}</dd></div>
                  <div><dt>Importe</dt><dd>{formatearImporte(f.importe)}</dd></div>
                  {f.facturas > 0 && <div><dt>En facturas</dt><dd>{formatearImporte(f.facturas)}</dd></div>}
                </dl>
                {f.entidad && (
                  <label className="checkbox-group imprt-mig-escape">
                    <input type="checkbox" checked={!fuera} disabled={cargando}
                      onChange={e => onApartar(f.cuenta as number, e.target.checked)} />
                    <span className="checkbox-label">Importar esta cuenta</span>
                  </label>
                )}
              </>
            )}

            {f.fechasCorregidas > 0 && (
              <p className="imprt-mig-ficha-nota">{f.fechasCorregidas} fecha(s) corregidas.</p>
            )}
            {f.avisos.map(a => (
              <p key={a} className="imprt-mig-ficha-aviso"><AlertTriangle size={13} strokeWidth={2} /> {a}</p>
            ))}
          </article>
        )
      })}
      <input ref={masRef} type="file" accept=".xlsx" multiple className="imprt-drop-input"
        onChange={onAnadir} disabled={cargando || sinArchivos} aria-label="Añadir archivos" />
      <button type="button" className="imprt-mig-anadir" disabled={cargando || sinArchivos}
        onClick={() => masRef.current?.click()}>
        <Plus size={18} strokeWidth={2} />
        <span>{sinArchivos ? 'Empieza otra vez para cambiar los archivos' : 'Añadir archivos'}</span>
      </button>
    </div>
  )
}

/**
 * La clasificación propuesta, por grupos y no línea a línea: sobre 800 apuntes,
 * confirmar de uno en uno no es revisar, es teclear.
 */
export function GruposLiangApp({
  grupos, elegido, cargando, onElegir,
}: {
  grupos: GrupoPropuesto[]
  elegido: Record<string, string>
  cargando: boolean
  onElegir: (grupo: string, clave: string) => void
}) {
  const vivos = grupos.filter(g => g.lineas > 0)
  if (!vivos.length) return null
  return (
    <div className="imprt-mig-grupos">
      {vivos.map(g => {
        const valor = elegido[g.grupo] ?? g.propuesta ?? ''
        const sugeridas = [...new Set([g.propuesta, ...g.alternativas].filter((c): c is string => !!c))]
        return (
          <div key={g.grupo} className={`imprt-mig-grupo ${valor ? '' : 'imprt-mig-grupo-falta'}`}>
            <div className="imprt-mig-grupo-que">
              <strong>{g.etiqueta}</strong>
              <span>
                {g.lineas} {g.lineas === 1 ? 'línea' : 'líneas'} · {formatearImporte(g.importe)}
                {g.ejemplo && <> · «{g.ejemplo}»</>}
              </span>
            </div>
            <select className="input" value={valor} disabled={cargando}
              aria-label={`Categoría de ${g.etiqueta}`}
              onChange={e => onElegir(g.grupo, e.target.value)}>
              <option value="">— Elige una categoría —</option>
              {sugeridas.length > 0 && (
                <optgroup label="Propuestas">
                  {sugeridas.map(c => (
                    <option key={c} value={c}>{OPCIONES_GASTO.find(o => o.clave === c)?.etiqueta ?? c}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Todas">
                {OPCIONES_GASTO.map(o => <option key={o.clave} value={o.clave}>{o.etiqueta}</option>)}
              </optgroup>
            </select>
          </div>
        )
      })}
    </div>
  )
}

/**
 * El cuadre contra el estado de rendimiento del propio cliente, cuenta por
 * cuenta. Es la única validación externa que hay, y sin ella no se aplica.
 */
export function CuadreLiangApp({
  mig, excluidas, enSitio = false,
}: {
  mig: MigracionEstado
  excluidas: number[]
  /** Se está enseñando EN el reconocimiento: lo que hay que hacer ya lo dice el
   *  aviso que hay junto al botón, y repetirlo aquí sería decirlo dos veces. */
  enSitio?: boolean
}) {
  const hayEstado = conEstado(mig)
  const cuadra = cuadraTodo(mig, excluidas)
  return (
    <div className="card card-table imprt-mig-cuadre">
      <div className="card-header">
        <h2 className="card-title card-title-sm">Cuadre con tu contabilidad</h2>
        <span className={`badge ${cuadra ? 'badge-success' : 'badge-warning'}`}>
          {!hayEstado ? 'Falta el estado' : cuadra ? 'Cuadra' : 'No cuadra'}
        </span>
      </div>
      {!enSitio && (!hayEstado ? (
        <div className="alert alert-warning">
          <AlertTriangle size={16} strokeWidth={2} />
          Vuelve al reconocimiento y añade el Estado de rendimiento financiero del período: sin él la migración no se puede aplicar.
        </div>
      ) : !cuadra && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} strokeWidth={2} />
          Vuelve al reconocimiento y aparta las cuentas que no cuadran, o corrige sus archivos y vuelve a subirlos.
        </div>
      ))}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th className="col-num">Cuenta</th>
              <th>Concepto</th>
              <th className="col-num">Leído</th>
              <th className="col-num">Tu estado</th>
              <th className="col-num">Diferencia</th>
              <th className="col-center">Cuadre</th>
            </tr>
          </thead>
          <tbody>
            {mig.cuadre.map(f => {
              const fuera = excluidas.includes(f.cuenta)
              return (
                <tr key={f.cuenta}>
                  <td data-label="Cuenta" className="col-num">{f.cuenta}</td>
                  <td data-label="Concepto"><span className="cell-clamp" title={f.etiqueta}>{f.etiqueta}</span></td>
                  <td data-label="Leído" className="col-num">{formatearImporte(f.leido)}</td>
                  <td data-label="Tu estado" className="col-num">{f.oficial === null ? '—' : formatearImporte(f.oficial)}</td>
                  <td data-label="Diferencia" className="col-num">{f.diferencia === null ? '—' : formatearImporte(f.diferencia)}</td>
                  <td data-label="Cuadre" className="col-center">
                    <span className={`badge ${fuera ? 'badge-neutral' : f.cuadra ? 'badge-success' : 'badge-warning'}`}>
                      {fuera ? 'Apartada' : f.cuadra ? 'Cuadra' : f.oficial === null ? 'Sin línea' : 'No cuadra'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {mig.sinArchivo.length > 0 && (
        <div className="imprt-mig-falta">
          <p className="text-xs-muted">Tu estado trae conceptos de los que no has subido el libro mayor:</p>
          <ul className="imprt-mig-falta-lista">
            {mig.sinArchivo.map(s => (
              <li key={s.concepto}><span>{s.concepto}</span><strong>{formatearImporte(s.importe)}</strong></li>
            ))}
          </ul>
        </div>
      )}
      {hayEstado && mig.utilidad.oficial !== null && (
        <p className="imprt-mig-utilidad">
          Resultado del período: <strong>{formatearImporte(mig.utilidad.reconstruida)}</strong> según lo subido,
          {' '}<strong>{formatearImporte(mig.utilidad.oficial)}</strong> según tu estado.
        </p>
      )}
    </div>
  )
}

/**
 * Lo facturado no entra como cobro: una factura lleva cliente, vencimiento y
 * estado, y el libro mayor solo sabe número, fecha e importe (plan, D3).
 */
export function FacturasLiangApp({
  facturas, bajando, onDescargar,
}: {
  facturas: FacturaDetectada[]
  bajando: boolean
  onDescargar: () => void
}) {
  const total = facturas.reduce((s, f) => s + f.importe, 0)
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title card-title-sm">Facturas detectadas</h2>
        <span className="text-xs-muted">{facturas.length} · {formatearImporte(total)}</span>
      </div>
      <p className="modal-body-text">
        Descarga la plantilla, completa el cliente de cada factura y súbela en Facturas de venta.
      </p>
      <div className="imprt-acciones">
        <button type="button" className="btn btn-secondary" onClick={onDescargar} disabled={bajando}>
          <Download size={15} strokeWidth={2} /> {bajando ? 'Generando…' : 'Descargar plantilla de facturas'}
        </button>
      </div>
      <details className="imprt-pend-mas">
        <summary>Ver las {facturas.length} facturas</summary>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr><th>Nº</th><th>Fecha</th><th>Concepto</th><th className="col-num">Importe</th></tr>
            </thead>
            <tbody>
              {facturas.map((f, i) => (
                <tr key={`${f.numero}-${i}`}>
                  <td data-label="Nº">{f.numero}</td>
                  <td data-label="Fecha">{f.fecha}</td>
                  <td data-label="Concepto"><span className="cell-clamp" title={f.descripcion}>{f.descripcion}</span></td>
                  <td data-label="Importe" className="col-num">{formatearImporte(f.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

/**
 * Lo que hay que exportar de LiangApp, dicho ANTES de subir nada. La subida va
 * en dos tramos y el orden no es capricho: el estado de rendimiento es el que
 * permite cuadrar, y sin él la migración no se aplica. Pedirlo el último es
 * dejar que el cliente suba veinte mayores para descubrir al final que le falta
 * el que importa.
 */
export function AyudaLiangApp({ hayEstado }: { hayEstado: boolean }) {
  return (
    <div className="alert alert-info alert-intro">
      <span>
        {hayEstado
          ? <>
              Ahora los <strong>libros mayores</strong> del período —uno por cuenta—, de la misma
              empresa y el mismo período que el estado. Puedes subirlos todos a la vez.
            </>
          : <>
              Empieza por el <strong>Estado de rendimiento financiero</strong> del período: es{' '}
              <strong>obligatorio</strong>, porque es contra él como se cuadra lo migrado. Después
              subes los libros mayores.
            </>}
      </span>
    </div>
  )
}

/** El estado de rendimiento ya aceptado, con la puerta para cambiarlo. */
export function EstadoLiangApp({
  nombre, onCambiar, cargando,
}: {
  nombre: string
  /** El estado no se quita —sostiene la migración—: se sustituye por otro. */
  onCambiar: () => void
  cargando: boolean
}) {
  return (
    <p className="alert alert-success imprt-mig-listo">
      <CheckCircle2 size={15} strokeWidth={2} />
      <span className="imprt-mig-listo-nombre">
        <strong>Estado de rendimiento financiero</strong> · {nombre}
      </span>
      <button type="button" className="btn btn-aviso btn-sm" onClick={onCambiar} disabled={cargando}>
        Cambiar
      </button>
    </p>
  )
}

/** El resumen de una migración ya aplicada, lote a lote. */
export function AplicadosLiangApp({
  aplicados,
}: {
  aplicados: { lote_id: string; etiqueta: string; insertadas: number }[]
}) {
  if (!aplicados.length) return null
  return (
    <ul className="imprt-plan">
      {aplicados.map(a => (
        <li key={a.lote_id}>
          <Check size={14} strokeWidth={2.5} />
          <span><strong>{a.insertadas}</strong> {a.etiqueta.toLowerCase()}.</span>
        </li>
      ))}
    </ul>
  )
}
