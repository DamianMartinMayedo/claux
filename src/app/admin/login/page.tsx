import LoginCuenta from '@/components/LoginCuenta'

/** La puerta del equipo. El formulario es el mismo que el de `/partners`: lo que
 *  cambia es cómo se presenta y adónde entra. */
export default function LoginPage() {
  return (
    <LoginCuenta
      subtitulo="Panel de administración"
      destino="/admin/dashboard"
      pie="CLAUX v0.1 — Super Admin"
    />
  )
}
