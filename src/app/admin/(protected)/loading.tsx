import CargandoPantalla from '@/components/CargandoPantalla'

// Red general del admin: cualquier ruta protegida que no traiga su propio
// `loading.tsx` cae aquí. Sin ella, el navegador no recibía NADA hasta que la
// página terminaba de consultar —el admin no tenía ni uno—, así que en Cuba cada
// clic del menú dejaba la pantalla anterior congelada varios segundos. Sin título:
// esta frontera no sabe adónde vas; el que sí lo sabe lo pone (ver `clientes`,
// `pagos`, `actividad`, `soporte`).
export default function AdminCargando() {
  return <CargandoPantalla />
}
