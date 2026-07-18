'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

// ── Modal: copiar registros a otra empresa EN LOTE (un solo destino) ──────────
//
// A diferencia de CopiarAEmpresaModal (individual, que pide moneda e importe por
// registro), en lote cada ficha conserva su propia moneda/salario/límite: aquí
// solo se elige la empresa destino. La acción de lote deduplica por nombre y omite
// los que ya pertenezcan al destino o ya existan allí, reportando cuántos.
// Compartido por Terceros (3.1) y Personal (3.2).

export default function CopiarLoteEmpresaModal({
  count, sustantivo, empresas, onClose, onConfirm,
}: {
  /** Nº de registros seleccionados (para el título). */
  count: number
  /** Palabra para el título: "registro", "empleado"… (singular). */
  sustantivo: string
  empresas: { empresa_id: string; nombre: string }[]
  onClose: () => void
  onConfirm: (empresaDestino: string) => void
}) {
  const [destino, setDestino] = useState('')
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Copiar {count} {sustantivo}{count === 1 ? '' : 's'} a otra empresa</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="input-group">
            <label htmlFor="copiar-lote-destino">Empresa destino <span className="required">*</span></label>
            <select id="copiar-lote-destino" className="input" value={destino} onChange={e => setDestino(e.target.value)}>
              <option value="" disabled>Selecciona…</option>
              {empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
            </select>
          </div>
          <p className="input-hint">
            Se crea una ficha independiente en la empresa destino, cada una con su propia
            moneda y saldos. Los que ya pertenezcan a esa empresa o ya existan por nombre se omiten.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={!destino} onClick={() => onConfirm(destino)}>Copiar</button>
        </div>
      </div>
    </div>
  )
}
