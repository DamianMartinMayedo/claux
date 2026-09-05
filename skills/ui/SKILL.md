---
name: ui
description: Fuente ÚNICA y COMPLETA de UI del design system de CLAUX (reglas + tablas + tokens + iconos + textos + gotchas). Usar SIEMPRE que se cree, edite o revise CUALQUIER componente, página, layout, estilo o CSS — incluso si la tarea solo dice "añade un botón", "cambia un color", "crea una página", "maqueta esto" o "ajusta el espaciado". Si la tarea toca un .tsx con JSX visible o un parcial de src/app/styles/, esta skill aplica y basta: no hace falta abrir ningún otro doc para UI. Regla central: NUNCA estilos inline.
---

# CLAUX UI — Design system y reglas de implementación

Esta skill es la **fuente única** de todo lo de UI. Para una tarea de UI no necesitas abrir ningún otro documento. Los **valores exactos** de tokens viven en código: `src/app/styles/01-tokens.css` (fuente viva, no se copian aquí para que no deriven).

## 0. Dónde vive el CSS

El CSS real está partido en **9 parciales por orden de cascada** en `src/app/styles/`. Encima hay **tres hojas de entrada** que solo orquestan `@import` (su orden es la cascada, no reordenar; no escribas reglas ahí): cada superficie carga la suya y así no baja el CSS de las demás.

| Hoja de entrada | La cargan | Parciales |
|---|---|---|
| `entrada-gestion.css` | `portal/`, `admin/` | 01–07 |
| `entrada-marca.css` | `(landing)/`, `legal/`, `diagnostico/` | 01–04 + 08 |
| `entrada-academia.css` | `(academia)/`, `ayuda/` | 01–04 + 08 + 09 |

**Al crear una clase, mira quién la va a pintar**: una clase en `06-portal.css` NO existe para la landing ni para la Academia, y una en `09-academia.css` no existe para el portal. Si una pieza es compartida (el login, la cabecera pública), su CSS va en un parcial que carguen todos los que la usan — normalmente `03-components.css`.

Los parciales:

| Parcial | Dominio (dónde crear una clase nueva) |
|---|---|
| `01-tokens.css` | Custom properties (color/espaciado/texto/radio/sombra/tipografía). Fuente de valores. |
| `02-base-layout.css` | Reset, base del documento, contenedores de layout |
| `03-components.css` | Componentes genéricos: `.btn*`, `.input*`, `.table*`, `.modal*`, `.badge*`, `.card*`, `.alert*` |
| `04-responsive-dark.css` | Ajustes responsive y de modo oscuro |
| `05-admin-paginas.css` | Pantallas del `/admin` |
| `06-portal.css` | Portal y módulos del cliente |
| `07-ventas-actividad.css` | Ventas / actividad financiera |
| `08-landing.css` | Landing, diagnóstico (`.dg-*`) y la cabecera/pie públicos compartidos |
| `09-academia.css` | Academia y centro de ayuda (`.acad-*`) |

**Localiza una clase antes de crear**: `grep -rn "nombre-aproximado" src/app/styles/`. El sistema ya tiene botones, inputs, navegación, tablas, modales, badges, cards, alertas y estados.

## 1. Regla nº1 — prohibido el estilo inline

Nunca escribas `style={{ ... }}` en JSX ni `style=""` en HTML. Sin excepciones de comodidad ("es solo un margen") — esa es exactamente la vía por la que el sistema se degrada.

**Proceso obligatorio al necesitar un estilo:**
1. **Busca** una clase existente (`grep` arriba).
2. **Reutiliza** si existe; **extiende** con un modificador si casi existe (`.btn-danger` junto a `.btn-primary`).
3. **Crea** la clase en el parcial de su dominio (tabla §0), en kebab-case con prefijo de componente (`.reserva-card`, `.menu-item-precio`), bajo un comentario separador `/* ── Componente ── */`.

Si lo que necesitas es una **variante de algo compartido** (un botón, un badge), va en `03-components.css` con el resto de la familia — no la reescribas a mano dentro de tu componente. `.imp-banner-btn` se escribió así, clavado a su banner, y el resultado fue que el dossier no pudo reutilizarlo y acabó con un botón teal sobre un aviso ámbar. Botones disponibles: `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger(-text)`, `.btn-success`, `.btn-info` y **`.btn-aviso`** (la acción de dentro de una caja de color claro, como `.dos-desfase` o `.imp-banner`; no es «un botón ámbar» para usar suelto). Tamaños: `.btn-sm`, `.btn-lg`, `.btn-full`.

**Botón sobre fondo de color (regla).** En un aviso de color —`.alert-error/-success/-warning/-info` o cualquier caja de `--color-*-bg`— la acción va con **el color oscuro del aviso en el borde y el papel de fondo**: eso es `.btn-aviso`, y un `.btn-secondary` (borde `--color-border`) se pierde contra el fondo claro. Dentro de un `.alert-*` no hay nada que recordar: cada variante declara `--aviso-color`, `.btn-aviso` lo toma y el `.btn-secondary` se corrige solo. En una caja de color propia, declara tú `--aviso-color: var(--color-<estado>)` y usa `.btn-aviso`. El `.btn-ghost` es la excepción deliberada —el «ahora no» de un aviso—: no se le pone borde, solo el color del aviso.

**Única excepción válida:** un valor que solo se conoce en runtime (ancho de barra de progreso, color elegido por el tenant). Aun así no se estila inline: se pasa como custom property y la clase la consume:

```tsx
<div className="progress-bar" style={{ '--progress': `${pct}%` } as React.CSSProperties} />
```
```css
.progress-bar::after { width: var(--progress); }
```

## 2. Tokens siempre, valores mágicos nunca

Todo color, espaciado, tamaño de texto, radio, sombra y transición sale de custom properties: `var(--color-*)`, `var(--space-*)`, `var(--text-*)`, `var(--radius-*)`, `var(--shadow-*)`, `var(--transition)`. Prohibido hardcodear hex, px arbitrarios o duraciones. Si un valor no existe y se repetirá, se crea el token en `01-tokens.css`, no el valor suelto. **No copies hex desde memoria ni desde docs viejos**: cita el token y, si dudas del valor, abre `01-tokens.css`.

Resumen de familias (nombres, no valores — mira `01-tokens.css`):
- **Paleta:** teal de marca (`--color-primary*`) + ámbar caribe (`--color-amber*`). El color se reserva para CTA/acentos.
- **Cromo vs tinta** — la trampa que más veces se ha roto. El tono vivo (`--color-primary`, `--color-amber`) es RELLENO grande: banda, degradado, barra de gráfico, con texto blanco encima. Como TINTA —icono, texto, borde o trazo sobre fondo pálido— desaparece (el ámbar vivo da 1.9:1 sobre su propio chip; el mínimo es 3:1). Para tinta hay token propio: `--color-primary-text`, `--color-amber-text`. Y `-active` es un tercer papel: tono estable de banda, no cambia con el tema porque siempre lleva blanco encima.
- **Superficies** (crema cálida): `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-surface-offset(-2)`, `--color-divider`, `--color-border(-strong/-focus)`.
- **Texto** (carbón cálido): `--color-text`, `--color-text-muted`, `--color-text-faint`, `--color-text-inv`.
- **Estados**: cada uno es un **par color + fondo**: `--color-success` + `--color-success-bg` (idem `error`, `warning`, `info`, y `purple/indigo/rose` para badges). Ojo al naming: el fondo es **`-bg`**, no `-highlight`.
- **Tipografía:** dos familias vía `--font-display` (títulos y `--text-xl`↑) y `--font-body` (todo lo operativo: labels, cuerpo, botones, tablas). Escala `--text-xs … --text-5xl` + `--text-hero`. Nunca fijes `font-family` a mano.

**Dark mode gratis:** cada token de color declara su par en una sola línea con `light-dark(claro, oscuro)`, y el tema lo elige `color-scheme` (el SO en `:root`, el usuario vía `[data-theme]`). **Nunca añadas un bloque `[data-theme="dark"]` con paleta**: había dos copiados a mano y se desincronizaban en silencio. Token nuevo = una línea con su par. Excepción: los tonos de banda (`-active`) y `--paper-*` no llevan par, a propósito. Verifica cualquier componente nuevo en **ambos temas** — y si su fondo es un token sin par, en oscuro te queda un recuadro crema.

**Tailwind v4 está SOLO como reset** (`@import "tailwindcss"`). Prohibido usar clases utilitarias de Tailwind en el markup.

## 3. Sistema de tablas — ÚNICO (todas iguales, presentes y futuras)

Toda tabla usa el sistema base `.table` + `.table-wrapper` de `03-components.css`. **No crees clases propias** de alineación, ancho de columna de acciones ni de importes — ya existen. Referencias: `TercerosView.tsx` (con botones), `VentasView.tsx` (sin botones).

**Alineación de columnas** — la MISMA clase modificadora va en el `<th>` y en el `<td>`:
- Cifras/importes/cantidades → **`col-num`** (derecha + `tabular-nums`). No uses `text-right` ni `*-col-monto`.
- Centrado → **`col-center`**. Acciones → **`col-actions`** (se ciñe al contenido, derecha).
- Texto libre largo → **`cell-truncate`** en el `<td>` (UNA línea + elipsis; para un nombre o un número).
- Texto libre que necesita dos líneas (conceptos y categorías contables: «Servicios Comprados a Entidades · Servicios Otros de Telecomunicaciones») → **`cell-clamp`** + `title` con el texto completo. Va en el **elemento del texto**, no en el `<td>`: el clamp necesita `display:-webkit-box` y eso le quita el `table-cell` a la celda y descuadra la fila. Sin tope, esas celdas crecían a cinco líneas y la tabla dejaba de poder barrerse con la vista.

**Responsive (obligatorio):** cada `<td>` lleva **`data-label="<Cabecera>"`**. Bajo 640px la tabla se vuelve tarjetas apiladas (`etiqueta: valor`); sin ese atributo la tarjeta sale sin etiquetas. Las celdas `col-actions` no necesitan `data-label`.

**Acciones de fila:** con **2+ acciones**, un único menú `⋯` con `RowActions` (`src/components/portal/RowActions.tsx`) — nunca una fila de botones-icono (se amontonan). Items: `<button className="row-actions-item">` o `<Link className="row-actions-item">` (+ `-danger`/`-success`) con icono **y** texto. El menú va `fixed` (escapa del `overflow` de `.card-table`) y ya hace `stopPropagation`. Los enlaces heredan el color del texto; solo `-danger` va rojo. Con **1 sola acción**, icono directo (`.ter-action-btn`). Referencia: `GastosView.tsx`, `TercerosView.tsx`.

**Selección múltiple:** los tres van juntos y viven en `src/components/portal/`: `useRowSelection` (qué filas hay marcadas), `<HeaderCheck>` en el `th.col-check` (el «Seleccionar todo», con el estado intermedio que solo se puede poner por JS) y `<BulkBar>` con las acciones en lote — no redefinas el checkbox de cabecera en la vista.

**Filas clickables** (tabla con detalle): `<tr className="table-row-clickable" onClick={() => router.push(...)}>`; el `<Link>` del nombre lleva `onClick={(e) => e.stopPropagation()}`.

**Color de empresa** (tablas multi-empresa): `<tr className="… row-empresa-accent" style={empresaColorVar(colorOf(id))}>` (única excepción al no-inline: custom property de runtime). Acento lateral izquierdo; en tarjeta pasa a `border-left`. No añadas más color que ese acento.

**Columnas ordenables — un solo sistema (`src/components/TableSort.tsx`).** Toda tabla de listado del portal ordena por columna con `useOrden` + `<ThOrden>`; no escribas tu propio `sort` ni tu propia flecha.

```tsx
// Ordenar va ANTES de paginar: al revés se ordenaría solo la página visible.
const ord = useOrden(filtradas, {
  nombre: { label: 'Nombre', valor: t => t.nombre },
  total:  { label: 'Total',  valor: t => Number(t.total) },
})
const { pageItems, ...pag } = usePagination(ord.filas)
…
<ThOrden orden={ord} clave="nombre">Nombre / ID fiscal</ThOrden>
<ThOrden orden={ord} clave="total" className="col-num" />
```

`valor` devuelve el dato que se compara (texto, número, fecha ISO o booleano), **no** el JSX de la celda: se ordena por el dato, no por cómo se pinta. Sin `children`, el `<th>` muestra `label`; el `className` de alineación (`col-num`, `col-center`) va en el `ThOrden`, igual que en un `<th>`. Tres estados por columna: ascendente → descendente → sin ordenar. Los vacíos caen siempre al final, se ordene como se ordene.

**No se ordenan** (déjalas como `<th>`, con un comentario si no es obvio): las columnas cuyo valor es una cifra **por moneda** (no hay un número que comparar), las tablas cuyo orden lo fija el dueño a mano (catálogo, categorías) y las líneas de un documento (factura, compra, nómina), donde el orden ES el documento.

Bajo 640px la cabecera vuelve como una fila de chips desplazable —la tabla ya es tarjetas apiladas—, así que ordenar funciona igual en el móvil, que es donde se usa el portal.

## 3.1 Autocompletado — un solo patrón, y NUNCA `<datalist>`

Todo campo de texto con sugerencias usa la familia **`.ac-*`** de `03-components.css` (`.ac-wrap`, `.ac-lista`, `.ac-item`, `.ac-nom`, y opcionales `.ac-cod` / `.ac-extra`), a través de uno de los dos componentes que ya existen:

- **`AutocompletarTexto`** (`src/components/portal/AutocompletarTexto.tsx`) — texto libre con sugerencias: se guarda lo escrito, elegir es solo escribir rápido. **Sin código ni chip**: en un campo libre no hay referencia que enseñar y una inventada es ruido. Es el que se usa por defecto.
- **`DescripcionCatalogo`** — la variante CON vínculo: elegir enlaza la línea a un artículo y el chip del código (`.ac-chip`) lo informa dentro del input.

**Prohibido `<datalist>`.** No se puede estilar (en cada navegador es otro control y en Android abre un desplegable del sistema, así que el mismo campo se ve distinto en cada sitio) y empareja por **coincidencia de texto**: donde eso creaba un vínculo, matizar una palabra lo rompía en silencio (se perdían el coste congelado y el descuento de existencias sin decir nada). El vínculo lo crea el CLIC en la sugerencia, nunca el parecido del texto.

Detalles ya resueltos en los componentes, no los reinventes: `blur` con 120 ms de retardo (sin él el clic en una sugerencia no llega a registrarse), navegación con ↑/↓/Enter/Escape, `Enter` que **elige y no envía el formulario**, y la lista `position:absolute` que flota — el contenedor de una fila con autocompletado **no puede llevar `overflow:hidden`**.

## 3.2 Pestañas internas — un solo componente

Toda pestaña interna usa **`<Tabs>`** (`src/components/Tabs.tsx`) + clases `.tabs`/`.tab`/`.tab-count` de `03-components.css`. Es presentacional y **controlado**: el padre guarda la pestaña activa (`useState`) y pasa `tabs`, `active`, `onChange`. Conteos opcionales con `count` (pill); `countTone: 'warning'` para conteos de alerta (p. ej. sin leer). **No crees familias nuevas** de pestañas: `.usr-/.ven-/.detail-/.prd-/.res-/.rrhh-/.caja-/.pv-` son **legado a converger**, no a imitar. El portal todavía usa algunas; al tocar esas vistas, migra a `<Tabs>`. Desde un Server Component, extrae un envoltorio cliente (patrón: `configuracion/ConfiguracionTabs.tsx`, recibe los paneles ya resueltos como props).

**Segundo nivel ⇒ `<SubTabs>`** (`src/components/SubTabs.tsx`), no `.tabs` en pequeño. Recibe `tabs` (`{ href, label, count?, countTone? }`), `ariaLabel` y, opcionalmente, `activo`; la activa la decide la **URL** por prefijo más largo (así el detalle `…/propuestas/12` sigue marcando «Propuestas»), porque un segundo nivel navega —cada sub-pestaña es una ruta— en vez de guardar estado. Con **menos de dos** visibles no se pinta: los permisos filtran la lista y un menú de un elemento no es un menú. Clases `.subtabs`/`.subtab`; el pill de conteo es el mismo `.tab-count`. **No lo maquilles con `.tabs`**: rebajar la familia no funciona —dos filas con la misma forma pegadas se leen como una sola barra y no se ve cuál cuelga de cuál—, por eso el segundo nivel cambia de forma (pastillero en bandeja, sangrado, con guía vertical). Referencia: `components/admin/PropuestasTabs.tsx`, que solo declara rutas y permisos.

## 3.3 Filtros — un solo sistema, y una sola declaración

Todo listado del portal filtra con **`<Filtros>`** (`src/components/portal/Filtros.tsx`), que recibe una **declaración** (`src/lib/filtros.ts`). De esa única declaración salen **tres cosas** que antes se escribían por separado: la barra, el `FiltroExport` de la descarga y el texto de «lo que vas a descargar». Escribirlas a mano es cómo la pantalla y el fichero acabaron diciendo cosas distintas (un desplegable imprimía un UUID; pedir «Sin categoría» descargaba todo el catálogo). Vista de referencia: `gastos/GastosView.tsx` + su `page.tsx` + `actions/portal/gastos.ts`.

Reglas:

- **El estado vive en la URL, nunca en `useState`.** Refrescar —o que se caiga la conexión, que en Cuba es el caso normal— no puede tirar lo que el dueño acaba de poner, y volver del detalle de un documento tiene que devolverlo a lo que estaba mirando.
- **Un filtro busca siempre en TODO.** Se declara `donde`: `servidor` (cambia qué se trae, como lo archivado), `escalado` (el navegador mientras el listado quepa entero, la consulta en cuanto haya filas sin traer) o `cliente` (**solo** si el conjunto nunca se trunca). Un filtro que mira las 500 filas más recientes miente sin decirlo.
- **La etiqueta vive junto al valor** (`opciones: [{ valor, label }]`), en las palabras del dueño: «Pendiente», nunca `PENDIENTE`.
- Lo que la descarga **no puede** reproducir se marca `sinExportar` y el desplegable lo dice. Un filtro que no se puede aplicar **se dice, no se ignora**.
- **Una fila**, no dos: rango + buscador + los dos filtros más usados; el resto en «Filtros (N)». Y chips de lo puesto con «×» y «Limpiar» — los pone `<Filtros>` solo.
- **El rango es UN botón que dice el rango aplicado** (`.rango-boton`), no una fila de píldoras: eran 9 de los 13 controles de la barra, para el filtro que menos se toca. Los presets y las fechas viven en su panel. `.rango-pill` ya no existe.
- **Las píldoras solo si son POCAS.** `<Filtros>` degrada `widget: 'pastillas'` a `<select>` por encima de **4 opciones** — con seis empresas dejan de ser un atajo y se comen la fila. Lo decide el componente, así que la vista no tiene que saber cuántas empresas tiene el cliente. El `count` de una opción **solo se pinta en píldoras**.
- Cada filtro declara su **`rotulo`** corto («Categoría», «Proveedor»): es lo que se pinta encima del control en el panel. No se deduce del `label` — singularizar en español es adivinar.
- Techo de un listado ⇒ **`<AvisoTope>`**, que dice cuántas faltan y las trae. Nunca «acota el rango».
- Pastilla de filtro: **`.filter-pill`** (con `.filter-pill-count` si el número es información, como los tramos de CxC/CxP). `.rango-pill` es la del rango, dentro de `RangoBusqueda`. **`.cxx-chip`, `.actividad-filter-pills`, `.dgn-chips` y `.soporte-filtros` son legado a converger**, no a imitar.
- Mismo aspecto ⇒ mismo comportamiento. Una caja de búsqueda no puede exigir Enter en una pantalla y filtrar al teclear en otra.
- **Todo selector de TERCERO dice de qué empresa es. Sin excepción.** `third_parties` es por empresa, así que el mismo proveedor real tiene una ficha por cada empresa que le compra: una lista plana enseña «CLAUDIA» tres veces, idénticas. Y agrupar por **nombre** para quitar el duplicado es peor — fusiona tres fichas y filtrar por ella enseña las deudas de las tres sin decirlo. En un **filtro**, `opcionesTercero()` de `lib/filtros.ts` (id como valor, empresa como `<optgroup>`); en un **formulario**, se elige la empresa primero y la lista se acota a ella (`_CompraFormModal`, `_ProductoFormModal`). **Nunca** comparar terceros por nombre, ni en pantalla ni en la descarga.
- Al tocar filtros o descargas: **`npm run audit:filtros`** en verde.

## 4. Iconos

Sin emojis en la UI. Iconos **exclusivamente SVG inline** con `width`/`height` como atributos (no solo CSS), `viewBox="0 0 24 24"`, `fill="none" stroke="currentColor" strokeWidth="2"`. Para que no se compriman en el sidebar, usa una clase con `flex-shrink:0` en CSS — **no** `style={{flexShrink:0}}` inline.

## 5. Reglas UX innegociables

- Indicador de carga visible desde el primer clic hasta la respuesta.
- El botón de acción se deshabilita inmediatamente tras el clic; se reactiva solo si la operación falla.
- Sin respuesta en 15 s → mensaje amigable con opción de cancelar. Nunca pantalla congelada.
- Acciones críticas (registrar pago, anular factura, confirmar reserva, cerrar período) → resumen + confirmación explícita.
- **Prohibidos `confirm()`, `alert()` y `prompt()` del navegador**: son del sistema, no de CLAUX, y en móvil se ven como un aviso del navegador. Todo borrado (y cualquier acción irreversible) confirma con **`<ConfirmDialog>`** de `src/components/portal/Dialog.tsx` (`danger`, `confirmLabel="Eliminar"`); los errores van a toast, no a `alert()`. El estado de confirmación vive en el **padre** (`const [confirmarBorrado, setConfirmarBorrado] = useState<T|null>(null)`), nunca dentro de la fila o del menú `RowActions`: el botón solo hace `setConfirmarBorrado(item)`. Referencia: `CatalogoEditor.tsx`, `ModulosPageClient.tsx`. Sobre un panel flotante (chat IA), el diálogo ya va en `dialog-top` (z-index por encima).
- Tras guardar, feedback de éxito visible con el identificador generado.
- El texto visible se escribe con las reglas de §5.1. No es cosmética: un texto que sobra se lee tantas veces como se abre la pantalla.

## 5.1 El texto de la interfaz — PROFESIONAL Y CONCISO

El registro de toda la plataforma (portal, admin, páginas públicas): **profesional y conciso**. Se enuncia, no se conversa. Es una herramienta de trabajo que alguien abre veinte veces al día, no una campaña ni un asistente simpático. Aplica a todo lo que se lee en pantalla: títulos, subtítulos, botones, etiquetas, columnas, vacíos, avisos, errores, toasts, ayudas y textos de modal.

- **Lo más corto que siga siendo exacto.** Una idea, una frase. Si el texto se entiende sin la segunda frase, la segunda frase se borra entera —no se acorta—. El caso típico: un título que dice el problema y un botón que dice la acción no necesitan nada en medio.
- **No se explica el mecanismo.** «Se abre en una pestaña nueva», «tu mensaje llega al panel de CLAUX», «se leen sin entrar en el portal»: es cierto, no aporta y envejece con el código. La razón técnica va en el comentario del código, que es donde sirve.
- **No se vende dentro del producto.** Quien lo lee ya es cliente. Nada de adjetivos de folleto ni de frases que justifican lo buena que es una función («conoce tu negocio y responde al momento»). Se nombra lo que hace y se ofrece la acción.
- **Ni euforia ni disculpas.** Sin exclamaciones («¡Listo!», «¡Genial!»), sin emoticonos, sin «Lo sentimos mucho». Un error dice **qué ha pasado y qué hacer**, en una frase; un éxito dice qué quedó hecho, con su identificador.
- **Botón = verbo + objeto** («Enviar mensaje», «Registrar pago»), sin coletillas ni signos. Un vacío dice qué es la pantalla y ofrece la acción; nada de frases de ánimo.
- **Profesional NO es formal ni técnico.** Se mantiene el tuteo, que es la voz ya instalada en el portal, y se siguen prohibidas la jerga interna y la nomenclatura del código («Recurso» → «Profesional», «Tercero» → el nombre que use el negocio). Preciso y sobrio, no distante.

> Este apartado es la fuente única del registro de los textos de la plataforma. El del **manual** (`/academia`, `/ayuda`) es otro —neutro, en tercera persona, sin tuteo— y vive en `docs/CONTEXTO.md § Academia`.

## 6. Rutas públicas por-negocio (menú/catálogo QR, reservar, citas) — presupuesto Cuba, INNEGOCIABLE

Son los enlaces que se comparten con el cliente final en conexión pésima (Cuba, 3G). **Presupuesto duro: carga mínima.** Regla excepcional, **aislada del portal** — la arquitectura ya está montada así a propósito:

- **NO cargan ninguna hoja de entrada ni nada del design system del portal.** Viven en `src/app/(public)/`, cuyo `layout.tsx` importa solo `public-base.css` (reset mínimo). Las hojas de entrada se importan en los layouts de las superficies internas (§0) — **nunca** en el root ni en `(public)/`. No importes una hoja de entrada ni tokens del portal aquí: romperías el aislamiento (el público pasó de 234 KB de CSS a ~8 KB).
- **Cada ruta trae su hoja propia con paleta namespaced**: `catalogo-publica.css` (`--cp-*`) y `reserva-publica.css` (`--rp-*`), definidas en un wrapper `.cp-page`/`.rp-page`. No aliasar los tokens del portal.
- **Fuentes del sistema** (`system-ui`), nunca fuentes web: no uses `<BrandFonts>` aquí.
- Imágenes WebP/AVIF, sin librerías de UI pesadas, JS mínimo (Server Component siempre que se pueda). Objetivo: < 100 KB inicial, útil en 3G, PWA/offline donde aplique.

> **Landing y diagnóstico** (`/landing`, `/diagnostico`) son marketing propio de CLAUX, no mini-webs de negocio: esos **sí** usan el design system (cargan `entrada-marca.css` + fuentes de marca en su layout). El aislamiento duro es **solo** para `(public)/[slug]/*`.

### Fuentes de marca

Se sirven desde nuestro dominio (`next/font`, descargadas en el build), nunca desde Google. Dos componentes, y la diferencia es la cursiva —que se precarga entera, 45 KB, la use la página o no—:

| Componente | Lo montan | Cursiva |
|---|---|---|
| `<BrandFonts>` | `portal/`, `admin/`, `(academia)/`, `ayuda/` | sí |
| `<BrandFontsSinCursiva>` | `(landing)/`, `legal/`, `diagnostico/`, el deck `/d/[token]`, la propuesta `/p/[token]` | no |

Publican `--fuente-display` / `--fuente-body` en `:root` (no como clase en un `<div>`: los modales y los toasts se pintan con `createPortal` colgando de `<body>` y se quedarían fuera). `01-tokens.css` las consume en `--font-display` / `--font-body`, que son las que se usan en el CSS.

**Si escribes texto en cursiva** (`font-style: italic`, `<em>`, markdown con `*énfasis*`) **en una superficie de la fila de abajo, cámbiala a `<BrandFonts>`**: sin la cursiva real el navegador inclina la redonda a la fuerza, y eso no rompe nada que se vea saltar.

## 7. Accesibilidad mínima

Todo `<input>` con `<label for>` asociado por `id`. Todo botón de solo icono con `aria-label`. Contraste resuelto por tokens (no inventar combinaciones fuera de la paleta). Respetar `prefers-reduced-motion` en cualquier animación nueva.

## 8. Gotchas que ya nos mordieron (leer antes de tarjetas, menús y vistas públicas)

- **`transform` en hover crea bloque contenedor** → descoloca los menús `position:fixed` hijos (p. ej. `RowActions`, `.cat-card`). No uses `transform` en una tarjeta que contiene un menú `fixed`.
- **`opacity` en un contenedor se hereda a hijos `position:fixed`** (el menú `fixed` sale transparente y por detrás). Para "agotado" u otros atenuados: atenúa foto + textos, **no** el contenedor.
- **`.input-hint` (portal) ≠ `.rp-hint`** (solo existe en la hoja pública de reservar). No mezclarlas.
- **Antes de tocar una vista pública, lee su hermana del mismo ámbito** (público → público): usan paleta propia, no los tokens del portal (§6).
- **Contenedor de tamaño estable entre pasos** de un flujo (ancho fijo + `min-height`) para que la tarjeta no encoja a su contenido al cambiar de paso.
- **Reveal al hacer scroll: el estado base es VISIBLE, y el JS opta *por* la animación.** Nunca `opacity:0` de base "y ya lo mostrará el observer": si el JS no llega (3G, JS off, error de hidratación), la página queda invisible **para siempre**. Se hace al revés: el JS añade una clase al root (`.dp-anim`) y solo bajo ella el CSS oculta y revela. Referencia: `(public)/d/[token]/DeckReveal.tsx`.
- **Texto sobre un color de runtime necesita un color de texto calculado, no elegido a ojo.** Si el color lo pone el tenant, el contraste hay que derivarlo (`lib/dossier/paleta.ts` → `principalTexto`, ≥4.5:1 garantizado). Poner `color:#FFF` sobre un color derivado es inventarse una legibilidad que nadie ha comprobado. Si no tienes un texto calculado para ese color, no pongas texto encima: la etiqueta al lado.
- **Botón de acción del `.page-header` que se cae debajo del título:** el header es `flex-wrap:wrap`; si el bloque de texto no encoge, un subtítulo largo copa la fila y empuja la acción abajo (era el caso de Diagnóstico/Módulos). Ya resuelto en la base: el primer hijo lleva `flex:1 1 20rem; min-width:0` y las acciones `flex-shrink:0` (`02-base-layout.css`). Regla: el bloque de texto y la acción son **hermanos** dentro de `.page-header`; nunca metas el botón dentro del bloque de texto. **Ojo:** ese `20rem` es base del EJE PRINCIPAL — al poner `flex-direction:column` en una media query pasa a ser ALTO y la cabecera se infla a 320px de hueco vacío (nos pasó en todo el móvil). Si giras el eje, resetea la base: `flex:0 1 auto` (`04-responsive-dark.css`).
- **Hora de reloj en un componente cliente ⇒ fíjale la zona.** `toLocaleTimeString()` sin `timeZone` da una hora en el SSR (UTC en Vercel) y otra en el navegador → **mismatch de hidratación**, y encima una hora que no es la del negocio. Usa `TZ_NEGOCIO` de `src/lib/fecha-tz.ts` (America/Havana). Formatear solo la FECHA desde `'YYYY-MM-DD'` con `new Date(y, m-1, d)` es seguro y es lo que hace el resto del repo.
- **Un `not-found.tsx` en la RAÍZ se paga en todas las páginas.** Cuelga del layout raíz, así que su subárbol viaja en la carga de cada ruta y su CSS se **precarga** en todas, aunque el 404 no se pinte nunca: importar ahí `entrada-marca.css` costaba 19 KB gz por visita, menú público incluido. Por eso `app/not-found.tsx` lleva su hoja propia de 1 KB (`app/no-encontrado.css`), fuera del design system, y el de `(public)/` mete sus reglas en `public-base.css` —que el layout ya carga, así que Next la descarta por duplicada—. No los «arregles» importando el sistema. Los `not-found`/`error` de portal, admin, Academia y ayuda sí van con clases del sistema: su superficie ya cargó la hoja.

## 9. Checklist antes de dar por terminada una tarea de UI

1. ¿Cero `style={{` nuevos en el diff? (excepción: custom property de runtime documentada).
2. ¿Cero hex/px/ms hardcodeados nuevos? ¿Todo por token?
3. ¿Cero clases utilitarias de Tailwind?
4. ¿Clases nuevas en el parcial de su dominio (§0), con prefijo de componente?
5. Si hay tabla: ¿`col-*` en `th`+`td`, `data-label` en cada `td`, `RowActions` si 2+ acciones?
5b. Si hay filtros: ¿una sola declaración con `<Filtros>` (§3.3), estado en la URL, y `npm run audit:filtros` en verde?
6. ¿Probado en dark mode y en móvil 360 px?
7. ¿Estados de carga, doble-submit y feedback cubiertos si hay acciones?
8. ¿El texto visible es profesional y conciso (§5.1)? ¿Sobra alguna frase —mecanismo, adjetivos, ánimo— que se pueda borrar entera?

---
*Presupuesto: este archivo ≤ ~1.400 palabras. Si crece, factoriza — los valores exactos viven en `01-tokens.css`, no aquí.*
