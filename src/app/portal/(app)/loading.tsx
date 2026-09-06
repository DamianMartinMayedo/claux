import CargandoPantalla from '@/components/CargandoPantalla'

// Frontera de streaming del contenido del portal. Sin ella, la respuesta entera
// espera a que terminen layout Y página: el navegador no recibe NADA hasta que
// la última consulta vuelve de Supabase, y el usuario se queda mirando la
// pantalla anterior. Con ella, la cabecera y el menú salen en cuanto resuelve el
// layout y el contenido llega después — que con la latencia de Cuba son segundos
// de diferencia (loading innegociable, skills/ui/SKILL.md §5).
export default function PortalCargando() {
  return <CargandoPantalla />
}
