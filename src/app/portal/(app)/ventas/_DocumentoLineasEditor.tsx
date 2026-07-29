'use client'

import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2, PackageSearch } from 'lucide-react'
import type { ProductoOpcion } from '@/app/actions/portal/ventas'
import { SelectorArticulo } from './_SelectorArticulo'
import {
  AJUSTE_TIPO_LABEL,
  calcularTotales,
  formatearMoneda,
  modoDescuentoLinea,
  parseNumeroEs,
  type AjusteInput,
  type AjusteModo,
  type AjusteTipo,
  type LineaInput,
} from './_ventas-helpers'

/**
 * Campo numérico que acepta **coma decimal** sin comerse lo que se escribe.
 *
 * El `type="number"` que había aquí devolvía cadena vacía con «0,5» en un navegador con
 * locale es (la coma es inválida para el control), así que medio kilo se guardaba como
 * 0 en silencio. Y un `type="text"` controlado ingenuo es igual de malo: al teclear
 * «0,» el número vale 0 y el input se repinta como «0», borrando la coma.
 *
 * Lo que hace: guarda el TEXTO tal cual y lo enseña **mientras siga significando el
 * número que tiene el documento**. Si el valor cambia desde fuera —el selector de
 * moneda reexpresa los importes— el texto deja de cuadrar y se pinta el número nuevo.
 * Derivado en el render, sin `useEffect`: un efecto aquí robaría el foco al repintar.
 */
function InputNumero({
  valor, onValor, etiqueta, onKeyDown,
}: {
  valor: number
  onValor: (n: number) => void
  etiqueta: string
  onKeyDown?: (e: React.KeyboardEvent) => void
}) {
  const [texto, setTexto] = useState<string | null>(null)
  const mostrado = texto !== null && parseNumeroEs(texto) === valor
    ? texto
    : String(valor).replace('.', ',')
  return (
    <input
      className="input input-sm ven-input-num"
      type="text" inputMode="decimal"
      aria-label={etiqueta}
      value={mostrado}
      onChange={e => { setTexto(e.target.value); onValor(parseNumeroEs(e.target.value)) }}
      onFocus={e => e.target.select()}
      onKeyDown={onKeyDown}
    />
  )
}

/**
 * Descripción de una línea, con AUTOCOMPLETADO del catálogo.
 *
 * El vínculo con el artículo se crea al elegir una sugerencia, nunca por coincidencia de
 * texto: el `datalist` anterior ataba la línea solo si el input decía exactamente
 * «CÓDIGO — Nombre», así que matizar la descripción rompía el enlace en silencio y con él
 * el coste congelado de la línea, el margen del informe y la CxP al proveedor.
 *
 * La lista va en `position:absolute`, fuera del flujo: si empujara, abrir sugerencias
 * estiraría la fila y descolocaría la rejilla entera (que es justo lo que hacía el chip
 * del código debajo del input).
 */
function DescripcionLinea({
  valor, productos, moneda, linkCodigo, inputRef,
  onTexto, onElegir, onEnter,
}: {
  valor:      string
  productos:  ProductoOpcion[]
  moneda:     string
  /** Código del artículo enlazado, o null. Se pinta DENTRO del input, a la derecha. */
  linkCodigo: string | null
  inputRef:   (el: HTMLInputElement | null) => void
  onTexto:    (v: string) => void
  onElegir:   (p: ProductoOpcion) => void
  /** `Enter` sin sugerencias abiertas. Nunca envía el formulario. */
  onEnter:    () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo]   = useState(0)

  const sugerencias = useMemo(() => {
    const t = valor.trim().toLowerCase()
    if (t.length < 2) return []
    return productos
      .filter(p => p.codigo.toLowerCase().includes(t) || p.nombre.toLowerCase().includes(t))
      .slice(0, 6)
  }, [valor, productos])

  // Se ofrecen sugerencias solo si la línea NO está ya enlazada: con vínculo, seguir
  // sugiriendo invita a cambiarlo por accidente mientras se matiza el texto.
  const visible = abierto && !linkCodigo && sugerencias.length > 0

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible) {
      // Enter en la descripción NUNCA envía la factura: en un formulario largo eso es
      // casi siempre un accidente. Aquí significa «he terminado esta línea».
      if (e.key === 'Enter') { e.preventDefault(); onEnter() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(i => (i + 1) % sugerencias.length); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActivo(i => (i - 1 + sugerencias.length) % sugerencias.length); return }
    if (e.key === 'Escape')    { setAbierto(false); return }
    if (e.key === 'Enter') {
      // Con la lista abierta, Enter ELIGE la sugerencia marcada.
      e.preventDefault()
      onElegir(sugerencias[activo])
      setAbierto(false)
    }
  }

  return (
    <div className="ven-desc-wrap">
      <input
        ref={inputRef}
        className={`input input-sm${linkCodigo ? ' ven-desc-enlazada' : ''}`}
        type="text"
        aria-label="Descripción de la línea"
        placeholder="Describe lo que vendes…"
        value={valor}
        onChange={e => { onTexto(e.target.value); setAbierto(true); setActivo(0) }}
        onFocus={() => setAbierto(true)}
        // `blur` con retardo: sin él, el clic en una sugerencia cierra la lista antes de
        // que el `mousedown` llegue a registrarse y no se elige nada.
        onBlur={() => setTimeout(() => setAbierto(false), 120)}
        onKeyDown={teclas}
      />
      {/* El chip INFORMA del vínculo; no se puede quitar desde aquí. Quitarlo dejaba la
          fila idéntica pero muda: sin descuento de existencias, sin coste congelado para
          el margen y sin aviso de stock — y si se desenlazaban todas, el bloque entero de
          Inventario desaparecía del formulario. Para vender algo sin tocar el catálogo se
          borra la línea y se escribe a mano; para no mover existencias en TODO el
          documento está el check de Inventario, que es donde vive esa decisión. */}
      {linkCodigo && (
        <span className="ven-desc-chip" title={`Enlazada al artículo ${linkCodigo} del catálogo`}>
          {linkCodigo}
        </span>
      )}
      {visible && (
        <ul className="ven-autocomplete" role="listbox">
          {sugerencias.map((p, i) => (
            <li key={p.producto_id}>
              <button
                type="button"
                className={`ven-autocomplete-item${i === activo ? ' active' : ''}`}
                onMouseDown={e => { e.preventDefault(); onElegir(p); setAbierto(false) }}
                onMouseEnter={() => setActivo(i)}
              >
                <span className="ven-autocomplete-cod">{p.codigo}</span>
                <span className="ven-autocomplete-nom">{p.nombre}</span>
                {p.precios[moneda] != null && (
                  <span className="ven-autocomplete-precio">
                    {formatearMoneda(p.precios[moneda], moneda)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface Props {
  lineas:        LineaInput[]
  ajustes:       AjusteInput[]
  moneda:        string
  productos:     ProductoOpcion[]
  /** Almacén elegido para el descuento de stock: enseña existencias en el selector. */
  almacenId?:    string
  notas?:              string
  notasInternas?:      string
  /** Se pinta ENTRE las líneas y los ajustes (ahí va el bloque de inventario). */
  trasLineas?:   React.ReactNode
  onLineasChange:       (v: LineaInput[])  => void
  onAjustesChange:      (v: AjusteInput[]) => void
  onNotasChange?:       (v: string) => void
  onNotasInternasChange?: (v: string) => void
}

export function DocumentoLineasEditor({
  lineas, ajustes, moneda, productos, almacenId,
  notas, notasInternas, trasLineas,
  onLineasChange, onAjustesChange,
  onNotasChange, onNotasInternasChange,
}: Props) {
  const totales = useMemo(
    () => calcularTotales(lineas, ajustes),
    [lineas, ajustes],
  )
  // El selector del catálogo es UNO por documento, no uno por fila: se abre desde la
  // cabecera y añade tantas líneas como artículos se marquen.
  const [eligiendo, setEligiendo] = useState(false)
  // Modo de descuento ELEGIDO por línea. Vive aquí y no solo derivado de los importes
  // porque con descuento 0 los dos modos son indistinguibles en los datos: elegir
  // «importe» y no escribir nada haría que el selector saltara solo de vuelta a «%».
  const [modoDto, setModoDto] = useState<Record<number, AjusteModo>>({})
  // Se enfoca la descripción de la línea recién añadida. Con `ref` y no con un efecto:
  // el foco es un efecto del CLIC, no del render, y meterlo en un `useEffect` es la
  // receta del aviso `set-state-in-effect` y de robarle el foco al usuario al repintar.
  const filasRef = useRef<Record<number, HTMLInputElement | null>>({})

  const catalogo = new Map(productos.map(p => [p.producto_id, p]))

  // ── Líneas ──────────────────────────────────────────────────────────────────
  function addLinea() {
    const i = lineas.length
    onLineasChange([
      ...lineas,
      { producto_id: null, descripcion: '', cantidad: 1, precio_unitario: 0, descuento_pct: 0 },
    ])
    // Tras el repintado: el input de esa fila aún no existe en este tick.
    requestAnimationFrame(() => filasRef.current[i]?.focus())
  }
  function removeLinea(i: number) {
    onLineasChange(lineas.filter((_, idx) => idx !== i))
  }
  function updateLinea(i: number, patch: Partial<LineaInput>) {
    onLineasChange(lineas.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  /** Línea nueva a partir de un artículo del catálogo. */
  function lineaDe(p: ProductoOpcion): LineaInput {
    return {
      producto_id:     p.producto_id,
      descripcion:     p.nombre,
      cantidad:        1,
      precio_unitario: p.precios[moneda] ?? 0,
      descuento_pct:   0,
      unidad:          p.unidad,
    }
  }

  /**
   * Enlaza una línea EXISTENTE con un artículo (autocompletado). La descripción pasa a
   * ser la del artículo solo si estaba vacía o si es un prefijo de lo que se estaba
   * escribiendo: quien ya matizó «Cerveza — mesa 4» no quiere perder el matiz. El vínculo
   * y el texto son dos cosas distintas desde que se quitó el `datalist`, que ataba la
   * línea por coincidencia exacta y rompía el enlace en silencio al editar.
   */
  function enlazarArticulo(i: number, p: ProductoOpcion) {
    const actual = lineas[i]
    const escrito = actual.descripcion.trim()
    const esBusqueda = !escrito
      || p.nombre.toLowerCase().startsWith(escrito.toLowerCase())
      || p.codigo.toLowerCase() === escrito.toLowerCase()
    updateLinea(i, {
      producto_id:     p.producto_id,
      descripcion:     esBusqueda ? p.nombre : escrito,
      unidad:          p.unidad,
      precio_unitario: p.precios[moneda] ?? actual.precio_unitario ?? 0,
    })
  }

  /**
   * Añade una línea por artículo elegido en el catálogo. Si la última línea está vacía y
   * sin enlazar —la que deja «Añadir línea» al pulsarlo sin escribir nada— se reutiliza
   * en vez de dejarla ahí obligando a borrarla a mano.
   */
  function anadirDelCatalogo(elegidos: ProductoOpcion[]) {
    if (elegidos.length === 0) return
    const ultima = lineas[lineas.length - 1]
    const base = ultima && !ultima.producto_id && !ultima.descripcion.trim()
      ? lineas.slice(0, -1)
      : lineas
    onLineasChange([...base, ...elegidos.map(lineaDe)])
  }

  /** `Enter` en el último campo de la última línea añade otra: teclear sin ratón. */
  function handleEnterUltimoCampo(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()          // dentro de un <form>, Enter lo enviaría
    if (i === lineas.length - 1) addLinea()
  }

  // ── Ajustes ──────────────────────────────────────────────────────────────────
  function addAjuste(tipo: AjusteTipo) {
    onAjustesChange([
      ...ajustes,
      { tipo, nombre: '', modo: 'PORCENTAJE', valor: 0 },
    ])
  }
  function removeAjuste(i: number) {
    onAjustesChange(ajustes.filter((_, idx) => idx !== i))
  }
  function updateAjuste(i: number, patch: Partial<AjusteInput>) {
    onAjustesChange(ajustes.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }

  function ajustePlaceholder(tipo: AjusteTipo): string {
    if (tipo === 'DESCUENTO') return 'Descuento comercial'
    if (tipo === 'CARGO')     return 'Cargo / flete'
    return 'Nombre del impuesto'
  }

  return (
    <div className="ven-editor">

      {/* ── Líneas ── */}
      <div className="ven-form-section">
        <div className="ven-section-header">
          <span className="ven-form-section-title">Líneas</span>
          <div className="ven-section-actions">
            {/* El catálogo se abre UNA vez y se marcan todos los artículos: llenar una
                factura es elegir cinco cosas, no abrir cinco veces el mismo buscador. */}
            {productos.length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEligiendo(true)}>
                <PackageSearch size={12} strokeWidth={2.5} /> Del catálogo
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={addLinea}>
              <Plus size={12} strokeWidth={2.5} /> Añadir línea
            </button>
          </div>
        </div>

        {lineas.length === 0 ? (
          <div className="ven-empty-mini">
            Sin líneas todavía. Añade al menos una para poder guardar
            {productos.length > 0 && <> — o elige varias del catálogo de una vez</>}.
          </div>
        ) : (
          <div className="ven-lineas-table">
            <div className="ven-lineas-head">
              <div className="ven-col-prod">Artículo / descripción</div>
              <div className="ven-col-num">Cant.</div>
              <div className="ven-col-num">Precio</div>
              <div className="ven-col-num">Descuento</div>
              <div className="ven-col-num">Total</div>
              <div className="ven-col-del"></div>
            </div>

            {lineas.map((l, i) => {
              const art  = l.producto_id ? catalogo.get(l.producto_id) : undefined
              const modo = modoDto[i] ?? modoDescuentoLinea(l)
              return (
              <div key={i} className="ven-lineas-row">
                {/* El código del artículo va DENTRO del input, a la derecha, no debajo:
                    una segunda línea bajo el campo estiraba la fila y descolocaba la
                    rejilla entera de cantidad/precio/descuento/total. */}
                <div className="ven-col-prod">
                  <DescripcionLinea
                    valor={l.descripcion}
                    productos={productos}
                    moneda={moneda}
                    linkCodigo={l.producto_id ? (art?.codigo ?? l.producto_id) : null}
                    inputRef={el => { filasRef.current[i] = el }}
                    onTexto={v => updateLinea(i, { descripcion: v })}
                    onElegir={p => enlazarArticulo(i, p)}
                    onEnter={() => { if (i === lineas.length - 1) addLinea() }}
                  />
                </div>

                <div className="ven-col-num" data-label="Cant.">
                  <InputNumero
                    valor={l.cantidad}
                    onValor={n => updateLinea(i, { cantidad: n })}
                    etiqueta={`Cantidad de la línea ${i + 1}`}
                  />
                </div>

                <div className="ven-col-num" data-label="Precio">
                  <InputNumero
                    valor={l.precio_unitario}
                    onValor={n => updateLinea(i, { precio_unitario: n })}
                    etiqueta={`Precio unitario de la línea ${i + 1}`}
                  />
                </div>

                <div className="ven-col-num ven-col-dto" data-label="Descuento">
                  <select
                    className="input input-sm ven-dto-modo"
                    aria-label={`Modo de descuento de la línea ${i + 1}`}
                    value={modo}
                    onChange={e => {
                      const nuevo = e.target.value as AjusteModo
                      setModoDto(m => ({ ...m, [i]: nuevo }))
                      updateLinea(i, nuevo === 'PORCENTAJE'
                        ? { descuento_pct: l.descuento_importe ?? 0, descuento_importe: 0 }
                        : { descuento_pct: 0, descuento_importe: l.descuento_pct ?? 0 })
                    }}
                  >
                    <option value="PORCENTAJE">%</option>
                    <option value="MONTO_FIJO">{moneda || 'Fijo'}</option>
                  </select>
                  {/* `key` con el modo: al cambiar de % a importe el campo es OTRO, y sin
                      remontarlo se quedaría enseñando el texto del modo anterior. */}
                  <InputNumero
                    key={`dto-${modo}`}
                    valor={modo === 'PORCENTAJE' ? (l.descuento_pct ?? 0) : (l.descuento_importe ?? 0)}
                    onValor={n => updateLinea(i, modo === 'PORCENTAJE'
                      ? { descuento_pct: n, descuento_importe: 0 }
                      : { descuento_pct: 0, descuento_importe: n })}
                    etiqueta={`Descuento de la línea ${i + 1}`}
                    onKeyDown={e => handleEnterUltimoCampo(e, i)}
                  />
                </div>

                <div className="ven-col-num ven-total-cell" data-label="Total">
                  {formatearMoneda(totales.lineas_totales[i] ?? 0, moneda)}
                  {(totales.lineas_descuentos[i] ?? 0) > 0 && (
                    <div className="ven-descuento-hint">
                      −{formatearMoneda(totales.lineas_descuentos[i], moneda)}
                    </div>
                  )}
                </div>

                <div className="ven-col-del">
                  <button
                    type="button"
                    className="ter-action-btn ter-action-danger"
                    onClick={() => removeLinea(i)}
                    aria-label={`Eliminar la línea ${i + 1}`}
                    title="Eliminar línea"
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Inventario va AQUÍ, pegado a las líneas de las que habla, y no al final del
          formulario: enterrado bajo los totales y las notas era una configuración que el
          dueño no llegaba a ver. */}
      {trasLineas}

      {/* ── Ajustes ── */}
      <div className="ven-form-section">
        <div className="ven-section-header">
          <span className="ven-form-section-title">Descuentos, cargos e impuestos</span>
          <div className="ven-section-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addAjuste('DESCUENTO')}>
              <Plus size={12} strokeWidth={2.5} /> Descuento
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addAjuste('CARGO')}>
              <Plus size={12} strokeWidth={2.5} /> Cargo
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addAjuste('IMPUESTO')}>
              <Plus size={12} strokeWidth={2.5} /> Impuesto
            </button>
          </div>
        </div>

        {ajustes.length === 0 ? (
          <div className="ven-empty-mini">
            Sin ajustes. Los porcentajes se calculan sobre el subtotal de líneas.
          </div>
        ) : (
          <div className="ven-ajustes-list">
            {/* Header row */}
            <div className="ven-ajuste-head">
              <div className="ven-ajh-nombre">Nombre</div>
              <div className="ven-ajh-modo">Modo</div>
              <div className="ven-ajh-valor">Valor</div>
              <div className="ven-ajh-monto">Importe</div>
              <div></div>
            </div>
            {ajustes.map((a, i) => (
              <div key={i} className="ven-ajuste-row">
                <input
                  className="input input-sm ven-aj-nombre"
                  type="text"
                  placeholder={ajustePlaceholder(a.tipo)}
                  value={a.nombre}
                  onChange={e => updateAjuste(i, { nombre: e.target.value })}
                />
                <select
                  className="input input-sm ven-aj-modo"
                  value={a.modo}
                  onChange={e => updateAjuste(i, { modo: e.target.value as AjusteModo })}
                >
                  <option value="PORCENTAJE">%</option>
                  <option value="MONTO_FIJO">Fijo</option>
                </select>
                <div className="ven-aj-valor">
                  <InputNumero
                    valor={a.valor}
                    onValor={v => updateAjuste(i, { valor: v })}
                    etiqueta={`Valor del ajuste ${i + 1}`}
                  />
                </div>
                <div className="ven-aj-monto">
                  <span className={a.tipo === 'DESCUENTO' ? 'ven-monto-neg' : 'ven-monto-pos'}>
                    {a.tipo === 'DESCUENTO' ? '−' : '+'}{formatearMoneda(totales.ajustes_calculados[i] ?? 0, moneda)}
                  </span>
                </div>
                <button
                  type="button"
                  className="ter-action-btn ter-action-danger"
                  onClick={() => removeAjuste(i)}
                  title="Eliminar ajuste"
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom: totales + notas ── */}
      <div className="ven-bottom-row">
        {/* Totales */}
        <div className="ven-totales-resumen">
          <div className="ven-total-row">
            <span>Subtotal</span>
            <strong>{formatearMoneda(totales.subtotal, moneda)}</strong>
          </div>
          {ajustes.map((a, i) => (
            <div key={i} className="ven-total-row ven-total-ajuste">
              <span>{a.tipo === 'DESCUENTO' ? '− ' : '+ '}{a.nombre || AJUSTE_TIPO_LABEL[a.tipo]}</span>
              <span>
                {a.tipo === 'DESCUENTO' ? '−' : '+'} {formatearMoneda(totales.ajustes_calculados[i] ?? 0, moneda)}
              </span>
            </div>
          ))}
          <div className="ven-total-row ven-total-final">
            <span>Total</span>
            <strong>{formatearMoneda(totales.total, moneda)}</strong>
          </div>
          {ajustes.some(a => a.modo === 'PORCENTAJE') && (
            // A12: no se cambia el cálculo, se dice lo que hace. Los porcentajes NO se
            // acumulan entre sí — un 10% de descuento y un 16% de impuesto se calculan
            // los dos sobre el subtotal, no el segundo sobre el resultado del primero.
            <p className="input-hint">
              Los ajustes en % se calculan sobre el subtotal de líneas, no unos sobre otros.
            </p>
          )}
        </div>

        {/* Notas públicas */}
        {onNotasChange !== undefined && (
          <div className="ven-notas-inline">
            <label className="ven-notas-label">
              Notas <span className="input-hint-inline">(visibles en el PDF)</span>
            </label>
            <textarea
              className="input input-textarea ven-notas-textarea"
              rows={4}
              value={notas ?? ''}
              onChange={e => onNotasChange(e.target.value)}
              placeholder="Condiciones, garantías, referencias…"
            />
          </div>
        )}
      </div>

      {/* Notas internas — al fondo */}
      {onNotasInternasChange !== undefined && (
        <div className="ven-form-section mt-3">
          <label className="label-secondary">
            Notas internas <span className="input-hint-inline">(no se imprimen)</span>
          </label>
          <textarea
            className="input input-textarea mt-2"
            rows={2}
            value={notasInternas ?? ''}
            onChange={e => onNotasInternasChange(e.target.value)}
            placeholder="Observaciones para uso interno del equipo…"
          />
        </div>
      )}

      {eligiendo && (
        <SelectorArticulo
          productos={productos}
          moneda={moneda}
          almacenId={almacenId}
          onAnadir={anadirDelCatalogo}
          onCerrar={() => setEligiendo(false)}
        />
      )}

    </div>
  )
}

