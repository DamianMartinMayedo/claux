import { requireModulo } from '@/app/actions/portal/auth'
import EnConstruccion from '@/components/portal/EnConstruccion'

export default async function IAPage() {
  await requireModulo('asistente_ia')
  return <EnConstruccion titulo="Asistente IA" subtitulo="Análisis de tu negocio, proyecciones y asistente conversacional." />
}
