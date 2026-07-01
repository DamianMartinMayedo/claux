import type { IaPanel } from '@/app/actions/portal/ia'

// Bloque informativo y compacto en el perfil: el cliente solo VE su consumo de IA
// del mes. El nombre/tono del agente los fija el equipo CLAUX desde el admin.
export default function IaUsoCard({ panel }: { panel: IaPanel }) {
  const { uso, nombreAgente } = panel
  return (
    <div className="ia-uso-compact">
      <span className="ia-uso-compact-head">Asistente {nombreAgente}</span>
      <span className="ia-uso-compact-stat">
        {uso.conversaciones.toLocaleString('es-ES')} / {uso.cupo.toLocaleString('es-ES')} consultas este mes
      </span>
      {uso.cercaDelTope && <span className="badge badge-warning">cerca del límite</span>}
    </div>
  )
}
