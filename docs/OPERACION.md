# CLAUX — Trabajar en este repositorio

Cómo se verifica, se despliega y se toca la base de datos, y las trampas que ya costaron
tiempo. Nada de producto: eso está en `CONTEXTO.md`.

> Solo hace falta si vas a **escribir código**. Para analizar procesos sin tocar nada,
> `CONTEXTO.md` + `PROCESOS.md` bastan.

## Verificar antes de dar algo por terminado

```bash
npm run build
```

**No basta `tsc --noEmit`, y este es el motivo:** en un fichero con `'use server'` solo se
pueden exportar funciones `async`. Un `const`, un array o un objeto exportado ahí compila
en local con TypeScript y **revienta el build de Vercel**. Solo `next build` lo caza.

```bash
npm run audit:gating
```

Obligatorio al añadir o tocar **acciones del portal**. Comprueba que toda escritura tiene
su candado de módulo. Debe salir en verde; si aparece un módulo sin candado, el script lo
lista y devuelve error.

```bash
npm run audit:columnas
```

Centinela de columnas: comprueba contra la BD real que ningún `select` literal pide una
columna que no existe. **PostgREST no ignora la columna que sobra: falla la consulta
entera**, y con el `?? []` habitual eso se lee como «no hay nada» — así se apagaron en
silencio el calendario de cobros, el widget de Servicios (y su insight de IA) y las
descargas de Suscripciones y de Gastos. Correrlo tras cualquier migración que renombre o
borre una columna, y al cerrar cualquier fase de trabajo.

```bash
npm run audit:filtros
```

Centinela de filtros. Obligatorio al tocar un **listado, un filtro o una descarga**. Ninguno
de los fallos que caza da un error: todos devuelven un resultado creíble que es falso.

- Un `.limit(N)` de listado sin `count: 'exact'` — el listado se recorta y nadie puede decir
  cuántas filas faltan; el contador acaba diciendo «500 de 500» sobre el conjunto ya
  recortado. Es lo que se vio en el cliente DEUS: una tabla que no traía nada de años
  anteriores.
- Una vista con rango cuya descarga no lo recibe: el desplegable dice «Todo el listado» y el
  fichero se lleva la historia entera.
- Un `resumen` con una variable de estado en crudo: el desplegable imprime «PENDIENTE»,
  «INGRESO» o un UUID en vez de las palabras del dueño.
- `TABLAS_CON_EMPRESA` desaparecida o sin aplicar en `leer()`: sin ella, un usuario asignado
  a una empresa se descarga las de todas.
- `new Date().toISOString()` usado como «hoy»: eso es UTC y La Habana va a UTC−4/−5, así que
  a partir de las 20:00 «hoy» ya es mañana — el último día del mes, «Este mes» devolvía un
  listado vacío con la píldora encendida. Fuente única: `hoyEnTz()` de `lib/fecha-tz.ts`.
- Un centinela propio de «sin categoría» / «sin tercero» en un valor de filtro: había dos, y
  el de Productos se traducía a cadena vacía al mandarlo, o sea que pedir «Sin categoría»
  descargaba todo el catálogo. Usa `SIN_CATEGORIA` / `SIN_TERCERO` de `lib/listados.ts`.

`npx eslint <ficheros>` para lo tocado. El build de este proyecto es pesado: si el proceso
muere con **exit 137** es la máquina quedándose sin memoria, no un fallo del código.

## Base de datos

Las migraciones viven en `supabase/migrations/` numeradas, y se aplican directamente al
proyecto de Supabase. Al crear una tabla nueva:

- **Si activas RLS, tiene que llevar política.** Una tabla con RLS activada y sin política
  no devuelve nada… **solo en producción**. En local no se nota porque el cliente de
  servicio se la salta, así que el síntoma es «funciona en local y en producción sale
  vacío». Ver `CONTEXTO §2 › Esquema y datos`.
- **Añádela a la purga del tenant.** `eliminar_cliente()` enumera tablas a mano y se queda
  atrás sola. Hay un centinela (`tablas_tenant_sin_purgar()`) para detectarlo.

## Fronteras que no se cruzan

- **El portal no llama a acciones del admin.** Una acción con `requireAdmin` invocada desde
  el portal da **500 en producción** (el usuario de portal se autentica con `client_users`,
  no con Supabase Auth). Para leer configuración global desde el portal existe
  `leerSetting`, no `getSetting`.
- **Subir a Supabase Storage se hace con `Blob`, nunca con un `Buffer` de Node.** El buffer
  se corrompe en el entorno serverless de Vercel y el archivo llega roto.
- **Nada de `<datalist>`.** El design system tiene su propio autocompletado; el motivo está
  en `skills/ui/SKILL.md` §3.1 y no es cosmético.

## Despliegue

Producción es **claux.es** (Vercel), y despliega solo al empujar a `main`. Dos puertas de
entrada distintas: `/admin/login` (Supabase Auth, equipo CLAUX) y `/portal/login`
(`client_users`, el cliente).

**Los crons se declaran en `vercel.json` y solo se recogen al redesplegar.** Vercel los
programa en **UTC**; el negocio vive en La Habana, que cambia de UTC−4 a UTC−5 con el
horario de verano. Para fijar una hora del reloj cubano se programan las dos horas UTC
posibles y el endpoint deja pasar la que toca (`relojNegocio()` en `src/lib/fecha-tz.ts`).
El cron de tasas es el ejemplo a copiar.

## Diagnóstico rápido

| Síntoma | Dónde mirar primero |
|---|---|
| El build de Vercel falla y en local no | Un export no-`async` en un fichero `'use server'` |
| Una pantalla carga vacía solo en producción | Tabla con RLS activada y sin política |
| Un correo no llega | La tabla `emails_log`: el error real está ahí («API key is invalid» = clave mal puesta) |
| Un archivo subido llega corrupto | `Buffer` en vez de `Blob` al subir a Storage |
| Un proceso local muere con 137 | Memoria de la máquina, no el código |

## Convenciones

- Se trabaja **directamente sobre `main`**; sin ramas de feature salvo petición expresa.
- La documentación nueva va en `docs/` y se registra en el índice de `AGENTS.md`.
  Prohibido crear `.md` en la raíz.
- `docs/planes/` está en `.gitignore`: son borradores locales que **no viajan con el
  repositorio**. Lo que deba sobrevivir tiene que subir a `CONTEXTO.md`.
