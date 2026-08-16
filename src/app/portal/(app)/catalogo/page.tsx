import { notFound }            from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerCatalogo }     from '@/app/actions/portal/catalogo'
import CatalogoEditor           from './CatalogoEditor'
import SolicitarAcceso          from '@/components/portal/SolicitarAcceso'

export const dynamic = 'force-dynamic'

export default async function CatalogoPage() {
  const { puedeEditar } = await requireAccesoModulo('catalogo_qr')
  const data = await obtenerCatalogo()
  if (!data) notFound()
  return (
    <CatalogoEditor data={data} puedeEditar={puedeEditar}>
      {!puedeEditar && <SolicitarAcceso modulo="catalogo_qr" />}
    </CatalogoEditor>
  )
}
