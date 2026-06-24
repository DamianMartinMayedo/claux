import { requireModulo } from '@/app/actions/portal/auth'
import EnConstruccion from '@/components/portal/EnConstruccion'

export default async function ContabilidadPage() {
  await requireModulo('base')
  return <EnConstruccion titulo="Contabilidad" subtitulo="Asientos, cuentas y cierres contables." />
}
