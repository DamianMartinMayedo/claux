import { requireAccesoPagina } from '@/lib/admin-guard'
import { Building2, Calculator, CreditCard, Scale } from 'lucide-react'
import { getSetting } from '@/app/actions/settings'
import { PAGINAS_LEGALES } from '@/lib/publico/legal'
import { CLAVES_PROVEEDOR, DEFECTO_PROVEEDOR } from '@/lib/documentos/proveedor'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import { AJUSTES_PRESUPUESTO } from '@/lib/presupuesto/config'
import ProveedorForm from './ProveedorForm'
import FacturacionForm from './FacturacionForm'
import PresupuestoForm from './PresupuestoForm'
import LegalForm from './LegalForm'
import ConfiguracionTabs from './ConfiguracionTabs'

export default async function ConfiguracionPage() {
  await requireAccesoPagina('configuracion')
  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const diasTrial      = parseInt(await getSetting('dias_trial_default', '15'), 10) || 0

  // Datos legales del proveedor (rellenan el contrato y el NDA que firma el cliente).
  const [provNombre, provNif, provDom, provEmail, provTel, provIae] = await Promise.all([
    getSetting(CLAVES_PROVEEDOR.nombre,    DEFECTO_PROVEEDOR.nombre),
    getSetting(CLAVES_PROVEEDOR.nif,       DEFECTO_PROVEEDOR.nif),
    getSetting(CLAVES_PROVEEDOR.domicilio, DEFECTO_PROVEEDOR.domicilio),
    getSetting(CLAVES_PROVEEDOR.email,     DEFECTO_PROVEEDOR.email),
    getSetting(CLAVES_PROVEEDOR.telefono,  DEFECTO_PROVEEDOR.telefono),
    getSetting(CLAVES_PROVEEDOR.iae,       DEFECTO_PROVEEDOR.iae),
  ])

  // Los precios del presupuesto de instalación (mig. 168): antes eran constantes del código.
  const parametros = await cargarParametros()
  const escalaresPresupuesto = Object.fromEntries(
    (Object.keys(AJUSTES_PRESUPUESTO) as (keyof typeof AJUSTES_PRESUPUESTO)[])
      .map(k => [k, parametros[k]]),
  )

  const slugsLegales = Object.keys(PAGINAS_LEGALES)
  const textosLegales = Object.fromEntries(
    await Promise.all(
      slugsLegales.map(async (slug) => [slug, await getSetting(PAGINAS_LEGALES[slug].clave, '')] as const),
    ),
  )

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración</h1>
          <p className="page-subtitle">Datos del proveedor, facturación, precios y textos legales</p>
        </div>
      </div>

      <ConfiguracionTabs
        proveedor={
          <section className="card card-lg config-section">
            <div className="config-section-header">
              <div className="config-section-icon">
                <Building2 size={20} />
              </div>
              <div>
                <h2 className="config-section-title">Datos del proveedor</h2>
                <p className="config-section-sub">
                  Identificación legal de CLAUX en el contrato y el NDA (parte firmante)
                </p>
              </div>
            </div>

            <ProveedorForm
              nombre={provNombre} nif={provNif} domicilio={provDom}
              email={provEmail} telefono={provTel} iae={provIae}
            />
          </section>
        }
        facturacion={
          <section className="card card-lg config-section">
            <div className="config-section-header">
              <div className="config-section-icon">
                <CreditCard size={20} />
              </div>
              <div>
                <h2 className="config-section-title">Facturación</h2>
                <p className="config-section-sub">Descuento anual y días de prueba</p>
              </div>
            </div>

            <FacturacionForm
              descuentoAnual={descuentoAnual}
              diasTrial={diasTrial}
            />
          </section>
        }
        presupuesto={
          /* `config-section-ancha`: la rejilla de precios son seis columnas y el tope de
             760px de una sección sola la estrangulaba. */
          <section className="card card-lg config-section config-section-ancha">
            <div className="config-section-header">
              <div className="config-section-icon">
                <Calculator size={20} />
              </div>
              <div>
                <h2 className="config-section-title">Presupuesto de instalación</h2>
                <p className="config-section-sub">
                  Tarifa por hora y lo que cuesta cada línea según el volumen
                </p>
              </div>
            </div>

            <PresupuestoForm
              escalares={escalaresPresupuesto}
              lineas={parametros.lineas}
            />
          </section>
        }
        legales={
          <section className="card card-lg config-section">
            <div className="config-section-header">
              <div className="config-section-icon">
                <Scale size={20} />
              </div>
              <div>
                <h2 className="config-section-title">Textos legales</h2>
                <p className="config-section-sub">
                  Aviso legal, privacidad y cookies: se publican en el acto, sin desplegar
                </p>
              </div>
            </div>

            <LegalForm textos={textosLegales} />
          </section>
        }
      />
    </div>
  )
}
