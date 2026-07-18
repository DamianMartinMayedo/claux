'use client'

import { useEffect, useState } from 'react'
import { Info, AlertTriangle, AlertOctagon } from 'lucide-react'
import { TZ_NEGOCIO } from '@/lib/fecha-tz'
import type { Severidad } from '@/lib/notificaciones/catalogo'

/** Icono por nivel de agresividad. El color lo pone la clase, no el icono. */
export function IconoSeveridad({ severidad, size = 16 }: { severidad: Severidad; size?: number }) {
  if (severidad === 'urgente') return <AlertOctagon size={size} strokeWidth={2} />
  if (severidad === 'aviso')   return <AlertTriangle size={size} strokeWidth={2} />
  return <Info size={size} strokeWidth={2} />
}

function fechaAbsoluta(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: TZ_NEGOCIO,
  })
}

function fechaRelativa(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutos < 1)    return 'ahora mismo'
  if (minutos < 60)   return `hace ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24)     return `hace ${horas} h`
  const dias = Math.round(horas / 24)
  if (dias === 1)     return 'ayer'
  if (dias < 30)      return `hace ${dias} días`
  return fechaAbsoluta(iso)
}

/**
 * Tiempo transcurrido. Arranca con la fecha absoluta (fijada a la zona del
 * negocio, así el HTML del servidor y el del navegador coinciden) y pasa a
 * relativa tras montar: calcular "hace X" en el render inicial depende de
 * Date.now(), que difiere entre servidor y cliente y rompe la hidratación.
 */
export function TiempoRelativo({ iso }: { iso: string }) {
  const [texto, setTexto] = useState(() => fechaAbsoluta(iso))
  useEffect(() => { setTexto(fechaRelativa(iso)) }, [iso])
  return <span className="ntf-tiempo">{texto}</span>
}
