import { requireModulo } from '@/app/actions/portal/auth'
import EnConstruccion from '@/components/portal/EnConstruccion'

export default async function ReservasPage() {
  await requireModulo('reservas_citas')
  return <EnConstruccion titulo="Reservas y citas" subtitulo="Gestión de reservas, panel y bot de Telegram." />
}
