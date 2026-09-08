'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition } from 'react'
import Image from 'next/image'
import { type Empresa } from '@/app/actions/portal/empresas'
import { registrarInteresModulo } from '@/app/actions/portal/soporte'
import { empresaColorVar } from '@/components/portal/EmpresaTag'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { ArrowRight, Briefcase, Check, Coins, Mail, MapPin, Pencil, Plus } from 'lucide-react'
import EmpresaModal, { type ModalState } from './_EmpresaModal'
import { COLORES_EMPRESA } from '@/lib/colores-empresa'

// La paleta vive en `lib/colores-empresa`: la comparten la validación del
// servidor (`guardarEmpresa`) y el paso de puesta en marcha del dashboard.
const COLORES = COLORES_EMPRESA

interface Moneda { codigo: string; nombre: string; simbolo: string }

interface Props {
  empresas:    Empresa[]
  monedas:     Moneda[]
  maxEmpresas: number | null
  nivelNombre: string
  esAdmin:     boolean
  soloLectura: boolean
}

// ── Tarjeta ───────────────────────────────────────────────────────────────────

function EmpresaCard({
  empresa, onEditar, puedeEditar,
}: { empresa: Empresa; onEditar: (e: Empresa) => void; puedeEditar: boolean }) {
  const inicial  = empresa.nombre.charAt(0).toUpperCase()
  const esActiva = empresa.estado === 'ACTIVO'
  const color    = empresa.color ?? COLORES[0]
  const colorVar = empresaColorVar(color)

  return (
    <div className="emp-card">
      <div className="emp-card-band" style={colorVar} />
      <div className="emp-card-body">
        <div className="emp-card-top">
          {empresa.logo_url
            ? (
              <div className="emp-avatar-lg emp-avatar-with-logo" style={colorVar}>
                <Image src={empresa.logo_url} alt={empresa.nombre} width={48} height={48} onError={e => {
                  const el = e.currentTarget
                  el.style.display = 'none'
                  // El logo no cargó: revelar el avatar de color quitando el modificador.
                  el.parentElement!.classList.remove('emp-avatar-with-logo')
                  el.parentElement!.textContent = inicial
                }} />
              </div>
            )
            : <div className="emp-avatar-lg" style={colorVar}>{inicial}</div>
          }
          <div className="emp-card-top-right">
            {empresa.letra_facturacion && (
              <span
                className="emp-letra-badge"
                title={`Letra de facturación: ${empresa.letra_facturacion}`}
                style={colorVar}
              >
                {empresa.letra_facturacion}
              </span>
            )}
            <span className={`emp-card-estado ${esActiva ? 'emp-estado-activo' : 'emp-estado-inactivo'}`}>
              {esActiva ? 'Activa' : 'Inactiva'}
            </span>
          </div>
        </div>

        <div className="emp-card-nombre" title={empresa.nombre}>{empresa.nombre}</div>
        <div className="emp-card-fiscal">
          {[empresa.nombre_fiscal, empresa.rif_nit ? `NIF/NIT: ${empresa.rif_nit}` : null]
            .filter(Boolean).join(' · ')}
        </div>

        <div className="emp-card-meta">
          {(empresa.ciudad || empresa.pais) && (
            <div className="emp-meta-row">
              <MapPin size={12} strokeWidth={2} />
              {[empresa.ciudad, empresa.pais].filter(Boolean).join(', ')}
            </div>
          )}
          {empresa.email && (
            <div className="emp-meta-row">
              <Mail size={12} strokeWidth={2} />
              <span className="text-truncate">{empresa.email}</span>
            </div>
          )}
          {empresa.moneda_funcional && (
            <div className="emp-meta-row">
              <Coins size={12} strokeWidth={2} />
              Moneda: <strong>{empresa.moneda_funcional}</strong>
            </div>
          )}
        </div>
      </div>

      {puedeEditar && (
        <div className="emp-card-footer">
          <button className="btn btn-secondary btn-sm flex-1" onClick={() => onEditar(empresa)}>
            <Pencil size={13} />
            Editar
          </button>
        </div>
      )}
    </div>
  )
}

// ── Grid principal ────────────────────────────────────────────────────────────

export default function EmpresasGrid({ empresas: init, monedas, maxEmpresas, nivelNombre, esAdmin, soloLectura }: Props) {
  const [modal, setModal] = useState<ModalState>({ open: false, empresa: null })
  // Empresas no la gobierna un módulo: el candado de escritura es «ser admin y no ser
  // solo-lectura». Un `usuario` no-admin o un solo-lectura la ve, pero sin botones.
  const puedeEditar       = esAdmin && !soloLectura
  const limiteAlcanzado   = maxEmpresas !== null && init.length >= maxEmpresas
  // Toda operación cuelga de una empresa y necesita una moneda del cliente; sin
  // ninguna moneda, crear la empresa dejaría documentos cayendo a un 'USD' que el
  // cliente no tiene. Se exige ≥1 moneda antes (mismo criterio que RRHH/tesorería).
  const sinMonedas        = monedas.length === 0
  const bloqueado         = limiteAlcanzado || sinMonedas

  // Interés en SUBIR DE NIVEL. Antes esto pedía el addon «Multiempresa», que ya no
  // existe: cuántas empresas caben lo decide el nivel, así que ofrecer el addon era
  // ofrecer algo que nadie puede contratar. La clave y la etiqueta son las mismas que
  // usa el banner del dashboard (`nivel_superior` / «Subir de nivel»), para que las
  // dos peticiones caigan en la misma fila de /admin/soporte y en el mismo embudo de
  // Ventas → Ampliaciones. Se registra en el servidor (deja rastro y avisa a
  // comercial), nunca un `mailto:`, que no deja constancia de quién pidió qué.
  const [interesEnviado,   setInteresEnviado]   = useState(false)
  const [enviandoInteres,  startInteres]        = useTransition()
  function pedirSubirNivel() {
    if (enviandoInteres || interesEnviado) return
    startInteres(async () => {
      const r = await registrarInteresModulo('nivel_superior', 'Subir de nivel')
      if (!r.ok) { toastError(r.error ?? 'No se pudo enviar.'); return }
      setInteresEnviado(true)
      toastSuccess('Solicitud recibida.')
    })
  }

  function abrirCrear() {
    if (bloqueado) return
    setModal({ open: true, empresa: null })
  }

  function abrirEditar(empresa: Empresa) {
    setModal({ open: true, empresa })
  }

  function cerrar() {
    setModal({ open: false, empresa: null })
  }

  function onSaved() {
    // La lista se refresca sola: guardarEmpresa/subirLogoEmpresa ya hacen
    // revalidatePath('/portal/empresas'). No hace falta un router.refresh() extra
    // (duplicaba el re-render del portal en cada guardado).
    cerrar()
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mis empresas</h1>
          <p className="page-subtitle">
            Gestiona los datos fiscales y configuración de cada empresa.
            {maxEmpresas !== null && (
              <span className="emp-plan-count">
                {init.length} / {maxEmpresas} empresas
              </span>
            )}
          </p>
        </div>
        {puedeEditar && (
          <button
            className="btn btn-primary"
            onClick={abrirCrear}
            disabled={bloqueado}
            title={sinMonedas
              ? 'Se requiere una moneda activa en Monedas y tasas.'
              : limiteAlcanzado ? `Límite de ${maxEmpresas} empresa${maxEmpresas === 1 ? '' : 's'} alcanzado` : undefined}
          >
            <Plus size={16} />
            Nueva empresa
          </button>
        )}
      </div>

      {sinMonedas && puedeEditar && (
        <PrerequisitoAviso acciones={[{ label: 'Crear moneda', href: '/portal/monedas' }]}>
          Para crear una empresa se necesita <strong>al menos una moneda</strong> configurada.
        </PrerequisitoAviso>
      )}

      {limiteAlcanzado && esAdmin && (
        <div className="alert alert-warning mb-5 emp-limite-cta">
          <span>
            El nivel <strong>{nivelNombre}</strong> llega a <strong>{maxEmpresas}</strong> empresa{maxEmpresas === 1 ? '' : 's'}.
            Con el siguiente caben más.
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={pedirSubirNivel}
            disabled={enviandoInteres || interesEnviado}
          >
            {enviandoInteres
              ? <><span className="spinner spinner-sm" /> Enviando…</>
              : interesEnviado
                ? <><Check size={14} strokeWidth={2.5} /> Te contactamos</>
                : <>Me interesa <ArrowRight size={14} strokeWidth={2.5} /></>}
          </button>
        </div>
      )}

      <div className="emp-grid">
        {init.map(emp => (
          <EmpresaCard key={emp.empresa_id} empresa={emp} onEditar={abrirEditar} puedeEditar={puedeEditar} />
        ))}

        {puedeEditar && !bloqueado && (
          <button className="emp-card-add" onClick={abrirCrear}>
            <Plus size={28} strokeWidth={1.5} />
            <span className="text-sm-bold">Nueva empresa</span>
          </button>
        )}

        {init.length === 0 && (
          <div className="emp-empty">
            <Briefcase size={48} strokeWidth={1} />
            <h3>Sin empresas configuradas</h3>
            <p>{sinMonedas
              ? 'Falta una moneda en Monedas y Tasas: es el paso previo a crear la empresa.'
              : 'Sin empresas: la primera habilita el registro de operaciones.'}</p>
          </div>
        )}
      </div>

      {/* Se monta solo mientras está abierto: así cada apertura arranca con estado
          limpio. Antes vivía montado siempre con key fija 'nueva', y al crear una
          segunda empresa reutilizaba la misma instancia — el logoFile de la primera
          seguía en estado y se subía a la segunda (cada empresa es independiente). */}
      {modal.open && (
        <EmpresaModal
          key={modal.empresa?.empresa_id ?? 'nueva'}
          state={modal}
          monedas={monedas}
          empresas={init}
          onClose={cerrar}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

// ── Mini-iconos de meta ───────────────────────────────────────────────────────

