// El chat del asistente es un botón flotante con su propio estado, montado en el
// layout del portal. Cualquier pantalla puede pedirle que se abra sin subir ese
// estado al layout ni pasar props por medio portal: un evento del navegador y ya.
// Lo usa el cierre de «Ayuda y soporte», que con el addon contratado ofrece
// preguntarle al asistente en vez de escribir al equipo.
export const EVENTO_ABRIR_IA = 'claux:ia-abrir'

export function abrirChatIa() {
  window.dispatchEvent(new Event(EVENTO_ABRIR_IA))
}
