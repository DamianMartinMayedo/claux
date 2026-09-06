import { requireAccesoPagina } from '@/lib/admin-guard'
import { listarMensajesSoporte, listarFaqAdmin } from '@/app/actions/soporte'
import { createAdminClient } from '@/lib/supabase/admin'
import { estadoFuncionesIa } from '@/lib/ia/interruptores'
import SoporteAdminView from './SoporteAdminView'

export const dynamic = 'force-dynamic'

export default async function AdminSoportePage() {
  await requireAccesoPagina('soporte')
  const db = createAdminClient()
  const [mensajes, faqs, { data: catalogo }, iaOn] = await Promise.all([
    listarMensajesSoporte(),
    listarFaqAdmin(),
    db.from('modulos_catalogo').select('clave, nombre').eq('activo', true).order('orden'),
    estadoFuncionesIa(['soporte_borrador', 'soporte_clasificar', 'soporte_faq'] as const),
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
        iaBorrador={iaOn.soporte_borrador}
        iaClasificar={iaOn.soporte_clasificar}
        iaFaq={iaOn.soporte_faq}
      />
    </div>
  )
}
