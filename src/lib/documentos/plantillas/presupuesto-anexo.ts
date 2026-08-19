// ── Plantilla del presupuesto (Anexo I del contrato) ──
//
// A diferencia del NDA y el contrato (texto fijo), el presupuesto es DINÁMICO por
// cliente: son sus módulos contratados con sus tarifas. El builder es puro; los
// datos los reúne la server action (`documentos.ts`), que prefiere el
// `presupuestos_instalacion` aprobado del cliente y, si no lo hay, autogenera el
// Anexo desde los módulos activos.
//
// La VERSIÓN codifica el contenido: si el presupuesto cambia (otro módulo, otra
// tarifa), cambia la versión, y como la firma es única por (cliente, tipo,
// versión), el cambio exige una firma nueva en vez de quedar con la vieja.

import type { DatosCliente, DatosProveedor, DocumentoResuelto, Elemento } from '../render'

export interface LineaAnexo {
  concepto: string
  tipo:     string   // 'Módulo' | 'Addon' | 'Funcionalidad' | 'Pago único'
  precio:   string   // ya formateado, p. ej. '$15.00/mes' o '—'
}

export interface AnexoInput {
  /** Versión que sella este presupuesto (p. ej. 'presupuesto-42' o 'modulos-…'). */
  version:          string
  fuente:           'presupuesto' | 'modulos'
  lineas:           LineaAnexo[]
  periodicidad:     string   // 'Mensual' | 'Anual'
  importeInicial:   string   // suma inicial (config + primer período), ya formateada
  importePeriodico: string   // importe recurrente por período, ya formateado
  /** Coste de instalación (pago único), solo cuando viene del presupuesto de instalación. */
  instalacion?:     { total: string; nota?: string }
}

export function construirPresupuestoAnexo(
  cliente: DatosCliente,
  prov: DatosProveedor,
  anexo: AnexoInput,
): DocumentoResuelto {
  const empresa = cliente.razon_social?.trim() || cliente.nombre_empresa
  const responsable = cliente.representante_nombre?.trim() || 'su representante'

  const cuerpo: Elemento[] = [
    {
      tipo: 'seccion',
      parrafos: [
        `Anexo I del Contrato de prestación de servicio entre ${prov.nombre} (CLAUX) y `
        + `${empresa}, representado por ${responsable}.`,
        'Detalle de los módulos, addons y funcionalidades activados para el Cliente y sus precios '
        + 'aplicados. Este Anexo forma parte del Contrato y refleja la contratación vigente en la '
        + 'fecha de aceptación.',
      ],
    },
    {
      tipo: 'tabla',
      titulo: 'Módulos contratados y tarifario',
      columnas: ['Módulo / servicio', 'Tipo', 'Precio aplicado'],
      filas: anexo.lineas.map(l => [l.concepto, l.tipo, l.precio]),
    },
  ]

  const resumen: string[] = [
    `Periodicidad: ${anexo.periodicidad}.`,
    `Importe periódico: ${anexo.importePeriodico}.`,
    `Importe inicial: ${anexo.importeInicial}.`,
  ]
  if (anexo.instalacion) {
    resumen.push(`Configuración y puesta en marcha (pago único): ${anexo.instalacion.total}.`)
    if (anexo.instalacion.nota) resumen.push(anexo.instalacion.nota)
  }
  cuerpo.push({ tipo: 'seccion', titulo: 'Resumen económico', parrafos: resumen })

  cuerpo.push({
    tipo: 'seccion',
    parrafos: [
      'Los importes se facturan en dólares estadounidenses (USD) conforme a la cláusula 5 del '
      + 'Contrato. Cualquier cambio en los módulos contratados se reflejará en la facturación del '
      + 'período siguiente.',
    ],
  })

  return {
    tipo: 'presupuesto',
    version: anexo.version,
    titulo: 'Presupuesto — Anexo I',
    subtitulo: cliente.nombre_empresa,
    cuerpo,
  }
}
