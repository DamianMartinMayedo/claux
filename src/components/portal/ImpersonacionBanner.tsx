'use client'

import Link from 'next/link'
import { LogOut, ShieldAlert, Upload } from 'lucide-react'
import { useTransition } from 'react'
import { salirDeImpersonacion } from '@/app/actions/admin/impersonar'

/**
 * Aviso persistente mientras el equipo CLAUX está dentro del portal de un cliente
 * como sesión de configuración (impersonación). El botón sale y vuelve al admin.
 */
export default function ImpersonacionBanner({ adminEmail }: { adminEmail: string }) {
  const [saliendo, startSalir] = useTransition()

  return (
    <div className="imp-banner" role="status">
      <ShieldAlert className="imp-banner-icon" size={18} />
      <p className="imp-banner-text">
        Estás dentro como <strong>configuración de CLAUX</strong>
        <span className="imp-banner-email"> · {adminEmail}</span>
      </p>
      <Link href="/portal/importar" className="btn btn-aviso btn-sm imp-banner-btn">
        <Upload size={15} /> Importar datos
      </Link>
      <button
        type="button"
        className="btn btn-aviso btn-sm imp-banner-btn"
        onClick={() => startSalir(() => { void salirDeImpersonacion() })}
        disabled={saliendo}
      >
        {saliendo
          ? <><span className="spinner spinner-xs" /> Saliendo…</>
          : <><LogOut size={15} /> Salir</>}
      </button>
    </div>
  )
}
