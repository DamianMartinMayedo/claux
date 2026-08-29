/**
 * El rótulo del manual, en un solo sitio.
 *
 * La RUTA es `/academia` y ahí se queda: cambiarla mueve una carpeta y rompe los
 * enlaces ya repartidos. El NOMBRE VISIBLE —cabecera, título de la pestaña, pie
 * y portada— se lee de aquí, así que rebautizarlo es cambiar esta línea.
 *
 * Es «Academia» y no «Ayuda» a propósito: `Ayuda` es el nombre reservado a la
 * capa PÚBLICA (`claux.es/ayuda`), que es una proyección filtrada de este manual.
 * Si la raíz se llamara igual que una de sus salidas, no habría forma de nombrar
 * la diferencia — y aquí dentro hay material que el cliente no debe ver.
 */

export const MARCA = 'Academia'

export const MARCA_LARGA = `CLAUX ${MARCA}`

/*
 * Un solo rótulo para todos. Hubo uno por rol —«CLAUX Partners» para el
 * revendedor— mientras el revendedor era un rol aparte; ahora quien vende es un
 * vendedor, del equipo o de fuera, y un nombre que cambia según quién mira ya no
 * distingue nada: solo obligaría a llamar «Partners» al manual del equipo. La
 * puerta sigue siendo `/partners`; el manual, en todas partes, es «Academia».
 */

/** Título de pestaña de una página del manual. */
export function tituloPagina(pagina?: string): string {
  return pagina ? `${pagina} · ${MARCA_LARGA}` : MARCA_LARGA
}
