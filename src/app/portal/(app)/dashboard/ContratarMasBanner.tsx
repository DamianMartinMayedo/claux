'use client'

import { useState, useTransition, type ReactNode } from 'react'
import {
  Wallet, Boxes, Store, UserCircle, Calendar, CalendarDays,
  Handshake, QrCode, Presentation, Sparkles, ArrowRight, Check,
  ChevronDown, ChevronUp, TrendingUp,
} from 'lucide-react'
import { registrarInteresModulo } from '@/app/actions/portal/soporte'
import { useNotificacionesOpcional } from '@/components/portal/notificaciones/NotificacionesContext'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import type { ModuloOferta } from '@/app/actions/portal/dashboard'

// Banner de captación. Dos formas según lo lleno que esté el dashboard:
//
//  · DESTACADO (≤2 módulos CON PANEL): banda de marca con lo que le falta, cada
//    cosa con su icono y su gancho. A quien tiene poco hay que ENSEÑARLE qué más
//    hay; el dashboard tiene sitio de sobra y el cartel no le tapa nada.
//  · DISCRETO (≥3): una línea al pie. Sigue estando, pero no compite con sus datos.
//
// Se cuentan módulos CON PANEL, no «lo contratado»: un cliente puede tener tres
// cosas (IA, imprenta, catálogo) y el dashboard seguir vacío.
//
// El interés NO se manda por `mailto:`: eso depende de que el dueño tenga cliente
// de correo configurado (si no, el clic no hace nada) y sobre todo no deja rastro
// —el equipo no se entera de quién quiso qué—. Se registra en el servidor, se ve
// en /admin/soporte y avisa al buzón comercial.

const ICONOS: Record<string, ReactNode> = {
  base:           <Wallet size={20} />,
  inventario:     <Boxes size={20} />,
  caja:           <Store size={20} />,
  rrhh:           <UserCircle size={20} />,
  reservas_citas: <Calendar size={20} />,
  agenda:         <CalendarDays size={20} />,
  servicios:      <Handshake size={20} />,
  catalogo_qr:    <QrCode size={20} />,
  dossier:        <Presentation size={20} />,
  asistente_ia:   <Sparkles size={20} />,
  // No es un módulo: es subir de nivel cuando algo se ha llenado (dashboard.ts).
  nivel_superior: <TrendingUp size={20} />,
}

// Cuántas se ven sin desplegar. Cuatro entran de un vistazo; la lista completa
// (hasta diez) se hojea, no se lee, y el dashboard no es un catálogo.
const VISIBLES = 4

export default function ContratarMasBanner({
  faltan, destacado, email,
}: { faltan: ModuloOferta[]; destacado: boolean; email: string }) {
  // El estado ARRANCA con lo que ya pidió (viene del servidor): antes vivía solo
  // en memoria y al recargar volvía a decir «Me interesa», como si el clic no
  // hubiera pasado nunca.
  const [pedidos, setPedidos] = useState<Record<string, string>>(() =>
    Object.fromEntries(faltan.filter(m => m.pedidoEl).map(m => [m.clave, m.pedidoEl!])))
  const [enviando, setEnviando] = useState<string | null>(null)
  const [verTodo,  setVerTodo]  = useState(false)
  const [, startTransition] = useTransition()
  // La campana solo se refresca al volver a la pestaña (throttle de 60 s): sin
  // esto el aviso de «lo pediste» existía en BD pero no aparecía hasta más tarde,
  // que para el dueño es lo mismo que no existir.
  const notificaciones = useNotificacionesOpcional()

  if (faltan.length === 0) return null

  function pedir(clave: string, label: string) {
    if (enviando || pedidos[clave]) return
    setEnviando(clave)
    startTransition(async () => {
      const r = await registrarInteresModulo(clave, label)
      setEnviando(null)
      if (!r.ok) { toastError(r.error ?? 'No se pudo enviar.'); return }
      setPedidos(prev => ({ ...prev, [clave]: 'ahora' }))
      toastSuccess('Recibido. Te contactamos enseguida.')
      void notificaciones?.refrescar()
    })
  }

  if (!destacado) {
    return (
      <section className="dash-cta-pie">
        <span>¿Te falta algo? Puedes activar {faltan.length} funcionalidades más.</span>
        <a href={`mailto:${email}?subject=${encodeURIComponent('Quiero ampliar mi CLAUX')}`} className="dash-cta-pie-link">
          Escríbenos
        </a>
      </section>
    )
  }

  // Las de más SIEMPRE están montadas (solo cambia si se ven): una animación de
  // cierre necesita que el nodo siga ahí mientras se pliega. `inert` las saca del
  // tabulador y del lector de pantalla mientras están plegadas.
  const principales = faltan.slice(0, VISIBLES)
  const resto = faltan.slice(VISIBLES)

  const tarjeta = (m: ModuloOferta) => {
    const pedido = pedidos[m.clave]
    const cargando = enviando === m.clave
    return (
      <button
        key={m.clave} type="button" className="dash-oferta-item"
        onClick={() => pedir(m.clave, m.label)}
        disabled={cargando || !!pedido}
      >
        <span className="dash-oferta-icono" aria-hidden="true">{ICONOS[m.clave] ?? <Sparkles size={20} />}</span>
        <span className="dash-oferta-nombre">{m.label}</span>
        <span className="dash-oferta-gancho">{m.gancho}</span>
        <span className={`dash-oferta-accion${pedido ? ' is-hecho' : ''}`}>
          {cargando
            ? <><span className="spinner spinner-sm" /> Enviando…</>
            : pedido
              ? <><Check size={13} aria-hidden="true" />
                  {pedido === 'ahora' ? 'Te contactamos' : `Pedido el ${pedido} · te contactamos`}</>
              : <>Me interesa <ArrowRight size={13} aria-hidden="true" /></>}
        </span>
      </button>
    )
  }

  return (
    <section className="dash-cta">
      <div className="dash-cta-head">
        <span className="dash-cta-badge"><Sparkles size={13} aria-hidden="true" /> Amplía tu CLAUX</span>
        <h2 className="dash-cta-titulo">Tu negocio puede hacer más</h2>
        <p className="dash-cta-sub">
          Esto es lo que puedes activar. Lo dejamos funcionando y con tus datos dentro.
        </p>
      </div>

      <div className="dash-cta-oferta">
        {principales.map(tarjeta)}
      </div>

      {resto.length > 0 && (
        <div className={`dash-cta-mas${verTodo ? ' is-abierto' : ''}`} inert={!verTodo}>
          <div className="dash-cta-mas-caja">
            <div className="dash-cta-oferta">{resto.map(tarjeta)}</div>
          </div>
        </div>
      )}

      {/* Sin esto solo se veían cuatro de hasta diez cosas: el resto no existía
          para el dueño. Despliega aquí mismo, no lleva a otra página — cargar una
          pantalla nueva para leer una lista es caro con la conexión de Cuba. */}
      {resto.length > 0 && (
        <button type="button" className="dash-cta-vertodo" onClick={() => setVerTodo(v => !v)}>
          {verTodo
            ? <>Ver menos <ChevronUp size={15} aria-hidden="true" /></>
            : <>Ver todo lo que puedes activar ({resto.length} más) <ChevronDown size={15} aria-hidden="true" /></>}
        </button>
      )}

      <p className="dash-cta-nota">
        ¿Prefieres contarnos qué necesitas?{' '}
        <a href={`mailto:${email}?subject=${encodeURIComponent('Quiero ampliar mi CLAUX')}`} className="dash-cta-nota-link enlace-sobre-banda">
          {email}
        </a>
      </p>
    </section>
  )
}
