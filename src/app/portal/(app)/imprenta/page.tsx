import { requireModulo } from '@/app/actions/portal/auth'
import EnConstruccion from '@/components/portal/EnConstruccion'

export default async function ImprentaPage() {
  await requireModulo('documentos_imprenta')
  return <EnConstruccion titulo="Documentos de imprenta" subtitulo="Envío de documentos por correo antes de recogerlos." />
}
