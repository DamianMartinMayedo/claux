'use client'

import Lectura from '@/lib/academia/Lectura'
import BotonTema from '@/lib/academia/BotonTema'

/**
 * Lo que la Academia necesita en cliente: el comportamiento de lectura y el
 * interruptor de tema.
 *
 * Los dos son compartidos con el centro de ayuda público (`/ayuda`), que monta
 * lo mismo: el comportamiento —resaltado del apartado, plegado del índice,
 * saltos animados, copiar enlace, abrir lo `avanzado` al saltar o al imprimir—
 * vive en `lib/academia/Lectura`, y el botón en `lib/academia/BotonTema`. Aquí
 * solo se juntan, porque en la Academia van al mismo sitio de la cabecera.
 *
 * QUÉ pieza está abierta no se calcula en cliente: cada pieza es una página y el
 * servidor la marca por la URL.
 */
export default function AcademiaChrome() {
  return (
    <>
      <Lectura />
      <BotonTema />
    </>
  )
}
