import { listarMensajesSoporte, listarFaqAdmin } from '@/app/actions/soporte'
import { createAdminClient } from '@/lib/supabase/admin'
import SoporteAdminView from './SoporteAdminView'

export const dynamic = 'force-dynamic'

export default async function AdminSoportePage() {
  const db = createAdminClient()
  const [mensajes, faqs, { data: catalogo }] = await Promise.all([
    listarMensajesSoporte(),
    listarFaqAdmin(),
    db.from('modulos_catalogo').select('clave, nombre').eq('activo', true).order('orden'),
  ])

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Soporte</h1>
          <p className="page-subtitle">Mensajes de los clientes y preguntas frecuentes.</p>
        </div>
      </div>

      <SoporteAdminView
        mensajes={mensajes}
        faqs={faqs}
        catalogo={(catalogo ?? []) as { clave: string; nombre: string }[]}
      />
    </div>
  )
}
