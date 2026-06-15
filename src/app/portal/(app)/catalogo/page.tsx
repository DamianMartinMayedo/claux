import { requireModulo } from '@/app/actions/portal/auth'
import EnConstruccion from '@/components/portal/EnConstruccion'

export default async function CatalogoPage() {
  await requireModulo('catalogo_qr')
  return <EnConstruccion titulo="Catálogo digital QR" subtitulo="Carta/catálogo por QR y mini-web pública." />
}
