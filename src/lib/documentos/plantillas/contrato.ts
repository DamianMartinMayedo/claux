// ── Plantilla del contrato de prestación de servicio ──
//
// Texto legal versionado (ver nota de versión en nda.ts). Respecto a la plantilla
// original se añaden dos cláusulas para la operativa de firma dinámica: la de
// protección de datos (RGPD, encargado del tratamiento) y la de aceptación y
// firma electrónica (eIDAS). El resto del articulado se mantiene, renumerado.

import { identificacionProveedor } from '../proveedor'
import { clausulaFirmaElectronica, identificacionCliente, type DatosCliente, type DatosProveedor, type DocumentoResuelto } from '../render'

export const VERSION_CONTRATO = 'contrato-2026-08'

export function construirContrato(cliente: DatosCliente, prov: DatosProveedor): DocumentoResuelto {
  return {
    tipo: 'contrato',
    version: VERSION_CONTRATO,
    titulo: 'Contrato de prestación de servicio',
    subtitulo: 'CLAUX — Cliente',
    cuerpo: [
      {
        tipo: 'seccion',
        titulo: '1. Partes',
        parrafos: [
          `De una parte, ${identificacionProveedor(prov)}`,
          `De otra parte, ${identificacionCliente(cliente)}`,
          'Ambas partes se reconocen mutuamente capacidad legal suficiente para suscribir el '
          + 'presente contrato (en adelante, el «Contrato»).',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '2. Objeto',
        parrafos: [
          'CLAUX presta al Cliente acceso a la plataforma de gestión CLAUX, en la modalidad de '
          + 'software como servicio (SaaS), incluyendo los módulos, addons y funcionalidades '
          + 'detallados en el Anexo I, a cambio del precio establecido en la cláusula 5.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '3. Periodo de prueba',
        parrafos: [
          'El Cliente dispone de 15 días naturales de prueba gratuita desde la activación de la '
          + 'cuenta, sin obligación de pago ni de continuar con el servicio.',
          'Si el Cliente no cancela antes de finalizar el período de prueba, el servicio continúa '
          + 'automáticamente y se factura conforme a la cláusula 5.',
          'Durante el período de prueba, el Cliente puede introducir datos reales de su negocio; '
          + 'dichos datos quedan sujetos a las mismas condiciones de tratamiento que si fuera cliente '
          + 'de pago (cláusulas 9 y 10).',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '4. Módulos contratados',
        parrafos: [
          'Los módulos, addons y funcionalidades activados para el Cliente, junto con sus precios '
          + 'vigentes, se detallan en el Anexo I. Cualquier cambio en los módulos contratados durante '
          + 'la vigencia del Contrato se reflejará en la facturación del período siguiente.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '5. Precio y forma de pago',
        parrafos: [
          'El precio se factura en dólares estadounidenses (USD), según los módulos contratados y el '
          + 'Anexo I vigente.',
          'El Cliente puede optar por facturación mensual o anual; la modalidad anual puede tener un '
          + 'descuento sobre el importe mensual equivalente según promociones activas.',
          'Medios de pago aceptados: transferencia bancaria, link de pago, efectivo, o el medio que '
          + 'las partes acuerden expresamente.',
          'El precio aplicado al Cliente podrá reflejar descuentos u otras condiciones promocionales '
          + 'vigentes en el momento de la contratación; de aplicar, estas condiciones quedarán '
          + 'reflejadas en el Anexo I.',
          'CLAUX podrá actualizar sus tarifas con un preaviso mínimo de 30 días; el nuevo precio '
          + 'aplicará a partir del siguiente período de facturación.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '6. Configuración y puesta en marcha',
        parrafos: [
          'La configuración incluye la activación de los módulos contratados, su configuración '
          + 'inicial y la migración de datos según el volumen del negocio del Cliente, con un alcance '
          + 'estándar de hasta 10 horas de asesoría.',
          'El plazo estimado de puesta en marcha es de hasta 1 mes desde el alta, salvo negocios que '
          + 'no requieran migración de datos, en cuyo caso el plazo será menor.',
          'El coste de configuración, según lo reflejado en el Anexo I, se paga en dos partes: 50% al '
          + 'iniciar la configuración y 50% al finalizarla.',
          'Horas de asesoría o volumen de migración adicionales al alcance estándar se cotizan y '
          + 'facturan aparte, previo acuerdo con el Cliente.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '7. Duración, renovación y cancelación',
        parrafos: [
          'El Contrato entra en vigor en la fecha de activación de la cuenta y se renueva '
          + 'automáticamente por el mismo período de facturación (mensual o anual) salvo cancelación.',
          'El Cliente puede cancelar el servicio en cualquier momento, con un preaviso de 30 días. El '
          + 'servicio permanece activo y facturable hasta el final de dicho preaviso.',
          'CLAUX podrá resolver el Contrato por incumplimiento grave del Cliente, incluyendo el '
          + 'impago prolongado conforme a la cláusula 8.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '8. Suspensión por impago',
        parrafos: [
          'Si el Cliente no abona una factura en su fecha de vencimiento, CLAUX podrá suspender el '
          + 'acceso a la plataforma transcurridos 15 días desde dicho vencimiento, previo aviso al '
          + 'Cliente.',
          'El acceso se restablece al regularizarse el pago pendiente. La suspensión no exime al '
          + 'Cliente de abonar los importes adeudados.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '9. Datos del Cliente',
        parrafos: [
          'Los datos que el Cliente introduce en CLAUX (información de su negocio, empleados, '
          + 'clientes, proveedores, movimientos financieros) son propiedad exclusiva del Cliente.',
          'CLAUX trata dichos datos únicamente para prestar el servicio contratado, y no los cede, '
          + 'vende ni utiliza con fines distintos.',
          'El Cliente puede solicitar la exportación de sus datos en cualquier momento durante la '
          + 'vigencia del Contrato.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '10. Protección de datos personales',
        parrafos: [
          'En la medida en que el Cliente introduzca en la plataforma datos personales de terceros '
          + '(empleados, clientes o proveedores), el Cliente actúa como responsable del tratamiento y '
          + 'CLAUX como encargada del tratamiento, en los términos del artículo 28 del Reglamento '
          + '(UE) 2016/679 (RGPD) y de la Ley Orgánica 3/2018 (LOPDGDD).',
          'CLAUX tratará dichos datos únicamente siguiendo las instrucciones documentadas del Cliente '
          + 'y con la única finalidad de prestar el servicio contratado; aplicará medidas técnicas y '
          + 'organizativas apropiadas para garantizar su seguridad; y mantendrá la confidencialidad '
          + 'sobre ellos, obligando en los mismos términos a cualquier persona que los trate bajo su '
          + 'autoridad.',
          'CLAUX podrá recurrir a subencargados (proveedores de alojamiento e infraestructura) que '
          + 'ofrezcan garantías equivalentes de protección; asistirá al Cliente en la atención de los '
          + 'derechos de los interesados y en sus obligaciones de seguridad; y, a la finalización del '
          + 'Contrato, suprimirá o devolverá los datos conforme a la cláusula 11.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '11. Datos tras la cancelación',
        parrafos: [
          'Una vez finalizado el Contrato, CLAUX conserva los datos del Cliente durante 90 días, '
          + 'período durante el cual el Cliente puede solicitar su exportación.',
          'Transcurrido dicho plazo sin solicitud expresa del Cliente, CLAUX podrá eliminar '
          + 'definitivamente los datos de sus sistemas.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '12. Confidencialidad',
        parrafos: [
          'Ambas partes se comprometen a mantener la confidencialidad de la información no pública a '
          + 'la que tengan acceso con motivo de este Contrato. Esta obligación se rige, de forma '
          + 'complementaria, por el Acuerdo de Confidencialidad (NDA) suscrito entre las partes, cuyos '
          + 'términos permanecen vigentes durante toda la relación contractual.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '13. Propiedad intelectual',
        parrafos: [
          'El Cliente no adquiere derecho alguno sobre la marca CLAUX, su código, diseño o '
          + 'documentación. El Cliente conserva todos los derechos sobre sus propios datos y '
          + 'contenidos introducidos en la plataforma.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '14. Nivel de servicio y responsabilidad',
        parrafos: [
          'CLAUX pondrá los medios razonables para mantener el servicio disponible y funcionando '
          + 'correctamente, sin garantizar una disponibilidad del 100%.',
          'CLAUX no se hace responsable de pérdidas de datos derivadas de causas ajenas a su control '
          + '(fallos de conectividad del Cliente, uso indebido de la plataforma, fuerza mayor).',
          'La responsabilidad total de CLAUX frente al Cliente, por cualquier concepto derivado de '
          + 'este Contrato, no excederá el importe pagado por el Cliente en los 3 meses previos al '
          + 'hecho que origine la reclamación.',
        ],
      },
      clausulaFirmaElectronica(15),
      {
        tipo: 'seccion',
        titulo: '16. Ley aplicable y jurisdicción',
        parrafos: [
          'El presente Contrato se rige por la legislación española. Para cualquier controversia '
          + 'derivada de su interpretación o cumplimiento, las partes se someten a los juzgados y '
          + 'tribunales que resulten competentes conforme a derecho, sin perjuicio de intentar '
          + 'previamente una solución amistosa.',
        ],
      },
    ],
  }
}
