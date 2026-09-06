import CargandoPantalla from '@/components/CargandoPantalla'

// La ficha de un cliente hereda el `loading.tsx` de la lista si no pone el suyo, y
// entonces la espera del detalle se anuncia como «Clientes». Aquí el título es el
// nombre de la empresa, que todavía no se sabe: mejor sin título que con uno falso.
export default function ClienteDetalleCargando() {
  return <CargandoPantalla />
}
