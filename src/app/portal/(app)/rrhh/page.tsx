import { requireModulo } from '@/app/actions/portal/auth'
import EnConstruccion from '@/components/portal/EnConstruccion'

export default async function RrhhPage() {
  await requireModulo('rrhh')
  return <EnConstruccion titulo="RRHH" subtitulo="Empleados, turnos y nómina." />
}
