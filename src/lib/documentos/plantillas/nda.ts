// ── Plantilla del NDA (acuerdo de confidencialidad) ──
//
// Texto legal versionado. La VERSIÓN se sube cuando cambia el texto: una firma
// guarda la versión que aceptó, así que cambiar el texto sin subir la versión
// haría que una firma vieja apunte a un texto que ya no es el que se aceptó.

import { identificacionProveedor } from '../proveedor'
import { clausulaFirmaElectronica, type DatosCliente, type DatosProveedor, type DocumentoResuelto } from '../render'

export const VERSION_NDA = 'nda-2026-08'

export function construirNda(cliente: DatosCliente, prov: DatosProveedor): DocumentoResuelto {
  const responsable = cliente.nombre_responsable?.trim() || 'su representante'
  return {
    tipo: 'nda',
    version: VERSION_NDA,
    titulo: 'Acuerdo de confidencialidad (NDA)',
    subtitulo: 'CLAUX — Cliente',
    cuerpo: [
      {
        tipo: 'seccion',
        titulo: '1. Partes',
        parrafos: [
          `De una parte, ${identificacionProveedor(prov)}`,
          `De otra parte, ${cliente.nombre_empresa}, representado por ${responsable} `
          + '(en adelante, «el Cliente»).',
          'En conjunto, «las Partes».',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '2. Objeto',
        parrafos: [
          'Con motivo de la evaluación, configuración y uso de la plataforma CLAUX, cada Parte '
          + 'puede tener acceso a información confidencial de la otra. Mediante este acuerdo (en '
          + 'adelante, el «NDA»), las Partes se comprometen a proteger dicha información conforme a '
          + 'lo establecido a continuación.',
        ],
      },
      {
        tipo: 'lista',
        titulo: '3. Información confidencial',
        items: [
          'Los datos operativos, financieros, de personal y de clientes del negocio del Cliente, '
          + 'introducidos o visibles en la plataforma CLAUX.',
          'Cualquier información comercial, técnica o de producto de CLAUX a la que el Cliente tenga '
          + 'acceso (funcionalidades no públicas, tarifas especiales, hoja de ruta).',
          'Las condiciones económicas pactadas entre las Partes, salvo que deban divulgarse por '
          + 'obligación legal.',
        ],
      },
      {
        tipo: 'lista',
        titulo: '4. Obligaciones de las Partes',
        items: [
          'Utilizar la información confidencial de la otra Parte exclusivamente para los fines de la '
          + 'relación entre CLAUX y el Cliente.',
          'No divulgar dicha información a terceros sin autorización previa por escrito de la otra '
          + 'Parte, salvo a empleados, colaboradores o asesores que la necesiten y estén igualmente '
          + 'obligados a confidencialidad.',
          'Aplicar medidas de seguridad razonables para evitar el acceso, uso o divulgación no '
          + 'autorizados.',
          'CLAUX no comparte, vende ni analiza los datos del Cliente con fines comerciales, '
          + 'publicitarios o de terceros, y no colabora de forma proactiva ni voluntaria con ninguna '
          + 'autoridad respecto a la información del Cliente.',
          'CLAUX es una herramienta de gestión para uso interno del propio negocio del Cliente — no '
          + 'un sistema de reporte automático hacia ninguna entidad externa.',
        ],
      },
      {
        tipo: 'lista',
        titulo: '5. Excepciones',
        items: [
          'Sea o pase a ser de dominio público sin incumplimiento de este NDA.',
          'La Parte receptora ya conocía de forma lícita antes de recibirla de la otra Parte.',
          'Deba divulgarse por obligación legal o requerimiento de una autoridad competente, en cuyo '
          + 'caso se notificará a la otra Parte cuando sea legalmente posible.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '6. Duración',
        parrafos: [
          'Las obligaciones de este NDA permanecen vigentes durante toda la relación entre las '
          + 'Partes, y se extienden por 2 años adicionales tras la finalización del Contrato de '
          + 'servicio, cualquiera sea la causa de dicha finalización.',
        ],
      },
      {
        tipo: 'seccion',
        titulo: '7. Datos del Cliente al finalizar la relación',
        parrafos: [
          'El tratamiento, conservación y eliminación de los datos del Cliente tras la finalización '
          + 'del Contrato de servicio se rige por lo establecido en dicho Contrato, y no por este '
          + 'NDA, que se limita a la obligación de confidencialidad sobre dicha información mientras '
          + 'CLAUX la conserve.',
        ],
      },
      clausulaFirmaElectronica(8),
      {
        tipo: 'seccion',
        titulo: '9. Ley aplicable y jurisdicción',
        parrafos: [
          'El presente NDA se rige por la legislación española. Para cualquier controversia derivada '
          + 'de su interpretación o cumplimiento, las partes se someten a los juzgados y tribunales '
          + 'que resulten competentes conforme a derecho.',
        ],
      },
    ],
  }
}
