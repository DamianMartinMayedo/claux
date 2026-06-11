import { createClient } from '@/lib/supabase/server'
import NuevoPlanModal from './NuevoPlanModal'
import PlanesTabla    from './PlanesTabla'

export default async function PlanesPage() {
  const supabase = await createClient()

  const { data: planes } = await supabase
    .from('plans')
    .select('*')
    .order('precio_usd')

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Planes</h1>
          <p className="page-subtitle">
            {planes?.length ?? 0} plan{planes?.length !== 1 ? 'es' : ''} configurado{planes?.length !== 1 ? 's' : ''}
            {' · '}Haz clic en una fila para ver el detalle
          </p>
        </div>
        <NuevoPlanModal />
      </div>

      {!planes || planes.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <h3 className="table-empty-title">Sin planes configurados</h3>
            <p>Crea tu primer plan con el botón de arriba.</p>
          </div>
        </div>
      ) : (
        <PlanesTabla planes={planes} />
      )}
    </div>
  )
}
