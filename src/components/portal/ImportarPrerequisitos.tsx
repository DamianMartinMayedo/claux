import PrerequisitoAviso from './PrerequisitoAviso'

export default function ImportarPrerequisitos({
  empresa,
  moneda,
}: {
  empresa: boolean
  moneda: boolean
}) {
  if (!empresa && !moneda) return null

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Importar datos</h1>
          <p className="page-subtitle">Carga masiva de tus datos desde un archivo CSV o Excel.</p>
        </div>
      </div>
      <div className="card">
        <PrerequisitoAviso acciones={[
          ...(empresa ? [{ label: 'Crear empresa', href: '/portal/empresas' }] : []),
          ...(moneda ? [{ label: 'Configurar moneda', href: '/portal/monedas' }] : []),
        ]}>
          {empresa && moneda
            ? <>Para poder importar, configura <strong>una empresa</strong> y <strong>una moneda activa</strong>.</>
            : empresa
              ? <>Para poder importar necesitas configurar <strong>una empresa</strong>.</>
              : <>Para poder importar necesitas configurar <strong>una moneda activa</strong>.</>}
        </PrerequisitoAviso>
      </div>
    </div>
  )
}
