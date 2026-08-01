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
