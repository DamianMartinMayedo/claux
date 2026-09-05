// ── El logotipo CLAUX dentro de la propuesta ─────────────────────────────────
//
// Va inline (un <symbol> y varios <use>) y no como <img src="/logo_color.svg">,
// que es lo que hace el resto del repo, por el COLOR: el fichero trae el teal
// vivo clavado dentro y esta hoja lo pinta sobre dos fondos —crema y verde
// profundo—. Sobre la crema ese tono es relleno, no tinta: se queda en un gris
// verdoso. Con el trazo en `currentColor` el membrete decide, y sale en teal
// oscuro sobre el papel y en blanco sobre el verde.
//
// Y el dibujo va UNA vez. El membrete se repite en todas las diapositivas menos
// la portada; con el SVG entero en cada una serían veinticinco kilobytes de HTML
// para pintar lo mismo dieciséis veces, y esta página se abre en Cuba.

/**
 * Las cinco letras, tal cual `public/logo_color.svg` y en su orden, sin el
 * `fill` del fichero: aquí lo pone `currentColor`.
 *
 * Y son de DOS clases: la C, la A y la U son `<path>` y la L y la X son
 * `<polygon>` —letras de trazos rectos, que el programa de dibujo exporta como
 * polígono—. Copiar solo los `<path>` deja el logotipo escrito «C AU», con dos
 * huecos, y no falla nada: se ve mal y ya. Si el logotipo cambia, se recopian
 * de ahí las cinco.
 */
const LETRAS: ['path' | 'polygon', string][] = [
  ['path', 'M201.23,214.37c-3.94,10.37-10.37,18.83-19.27,25.4-8.91,6.57-21.39,9.85-37.44,9.85-14.89,0-28.32-3.43-40.29-10.29-11.97-6.86-21.39-17.59-28.25-32.19-6.86-14.6-10.29-33.72-10.29-57.37,0-18.1,2.11-33.43,6.35-45.98,4.23-12.55,9.78-22.7,16.64-30.44,6.86-7.73,14.45-13.28,22.77-16.64,8.32-3.35,16.71-5.04,25.18-5.04,9.64,0,18.76,2.12,27.37,6.35,8.61,4.24,15.62,10.44,21.02,18.61,5.4,8.18,8.1,18.39,8.1,30.66l58.25-15.33c-.29-14.3-3.28-27.15-8.98-38.54-5.69-11.39-13.51-21.02-23.43-28.9-9.93-7.88-21.75-13.94-35.47-18.17-13.73-4.23-28.62-6.35-44.67-6.35-20.73,0-39.57,3.36-56.49,10.07-16.94,6.72-31.61,16.72-44.01,30-12.41,13.29-21.9,29.42-28.47,48.39C3.28,107.45,0,129.19,0,153.72s3.21,45.55,9.63,63.94c6.42,18.39,15.83,33.8,28.25,46.2,12.41,12.41,27.44,21.75,45.11,28.03,17.66,6.27,37.73,9.42,60.22,9.42s40-2.78,55.18-8.32c15.18-5.54,27.44-13.36,36.79-23.43,9.34-10.07,16.2-21.9,20.58-35.47,4.38-13.58,6.71-28.1,7.01-43.58l-55.18-9.2c-.29,11.68-2.41,22.7-6.35,33.06Z'],
  ['polygon', '371.37 6.13 308.31 6.13 308.31 295.17 321.45 295.17 371.37 295.17 493.56 295.17 493.56 242.18 371.37 242.18 371.37 6.13'],
  ['path', 'M614.86,6.13l-98.97,289.04h68.32l17.52-56.93h118.35l17.41,56.93h68.32L706.83,6.13h-91.97ZM614.93,195.32l42.85-139.27h6.57l42.6,139.27h-92.02Z'],
  ['path', 'M1027.85,179.56c0,14.89-2.41,27.23-7.23,37.01-4.82,9.79-12.12,17.01-21.9,21.68-9.79,4.67-22.27,7.01-37.44,7.01s-27.15-2.33-36.79-7.01c-9.63-4.67-16.86-11.89-21.68-21.68-4.82-9.78-7.23-22.12-7.23-37.01V6.13h-63.5v175.61c0,14.6,1.68,28.03,5.04,40.29,3.35,12.26,8.47,23.29,15.33,33.06,6.86,9.79,15.4,18.11,25.62,24.96,10.22,6.86,22.26,12.12,36.13,15.77,13.86,3.65,29.7,5.47,47.52,5.47,42.92,0,75.11-10.44,96.57-31.31,21.46-20.87,32.19-50.29,32.19-88.25V6.13h-62.63v173.42Z'],
  ['polygon', '1316.45 148.9 1414.99 6.13 1340.97 6.13 1273.97 116.49 1271.34 116.49 1204.77 6.13 1131.2 6.13 1228.42 150.21 1129.01 295.17 1202.58 295.17 1271.34 182.18 1273.53 182.18 1344.04 295.17 1417.61 295.17 1316.45 148.9'],
]

const CAJA = '0 0 1417.61 301.3'

/**
 * El dibujo, escondido, una sola vez por documento. Va al principio de la
 * página y no se ve.
 *
 * No se oculta con `display: none`, que es lo natural: Chrome se deja sin pintar
 * los `<use>` que apuntan a un símbolo así **al imprimir**, y el PDF saldría con
 * el membrete sin logotipo. Con la caja a cero el símbolo sigue "presente".
 */
export function MarcaSprite() {
  return (
    <svg className="pp-sprite" aria-hidden="true" focusable="false">
      <symbol id="pp-marca" viewBox={CAJA}>
        {LETRAS.map(([forma, v], i) => (
          forma === 'path' ? <path key={i} d={v} /> : <polygon key={i} points={v} />
        ))}
      </symbol>
    </svg>
  )
}

/** Una aparición del logotipo. Sin `rotulo` es decoración —el membrete lo repite
 *  en cada diapositiva y un lector de pantalla no tiene por qué oírlo dieciséis
 *  veces—; con él, es la marca de la portada y sí se anuncia. */
export function Marca({ className, rotulo }: { className: string; rotulo?: string }) {
  return (
    <svg
      className={className} viewBox={CAJA}
      {...(rotulo ? { role: 'img', 'aria-label': rotulo } : { 'aria-hidden': true, focusable: false })}
    >
      <use href="#pp-marca" />
    </svg>
  )
}
