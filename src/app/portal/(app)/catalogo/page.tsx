import { notFound }        from 'next/navigation'
import { requireModulo }   from '@/app/actions/portal/auth'
import { obtenerCatalogo } from '@/app/actions/portal/catalogo'
import CatalogoEditor       from './CatalogoEditor'

export const dynamic = 'force-dynamic'

export default async function CatalogoPage() {
  await requireModulo('catalogo_qr')
  const data = await obtenerCatalogo()
  if (!data) notFound()
  return <CatalogoEditor data={data} />
}
