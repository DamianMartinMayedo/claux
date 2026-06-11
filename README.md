# CLAUX

Plataforma SaaS multi-tenant para digitalizar negocios locales cubanos, principalmente restaurantes. Incluye menú QR, reservas, bot de Telegram y módulos de gestión (contabilidad, inventario, RRHH).

## Requisitos

- Node.js 20.9+ (probado en 24.x)
- npm 10+

## Variables de entorno

Copia `.env.example` a `.env.local` y rellena los valores reales (Supabase → Project Settings → API).
`.env.local` nunca se commitea. Variables:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase (obligatorias)
- `PORTAL_JWT_SECRET` — firma del JWT del portal (obligatoria; `openssl rand -hex 32`)
- `ELTOQUE_API_KEY` — tasas de cambio (opcional)
- `DEV_BYPASS_AUTH` y `DEV_PORTAL_*` — solo desarrollo local (ver abajo)

## Desarrollo local

```bash
npm install
npm run dev          # Turbopack (por defecto)
```

> **Aviso:** en local la app se conecta a la **Supabase compartida en la nube**. Los datos **NO son
> locales** — cualquier cambio afecta al entorno compartido.

**Capar el login para probar más rápido.** En `.env.local`:

- `DEV_BYPASS_AUTH=true` → entras directo a `/admin` sin login.
- Para capar también el portal, añade `DEV_PORTAL_CLIENT_ID=<un client_id real>` (y opcionalmente
  `DEV_PORTAL_USER_ID` / `DEV_PORTAL_ROL`). Sin ese client_id, el portal sigue pidiendo login.

El bypass tiene **doble candado**: requiere `NODE_ENV=development` (lo fija `next dev`) **y**
`DEV_BYPASS_AUTH=true`. En `next build`/`next start` (`NODE_ENV=production`) queda **inerte** aunque la
variable esté en true. Déjalo en `false` cuando no estés probando.

**Si `npm run dev` falla o da 500 con errores de binarios nativos** (`@next/swc-darwin-arm64`,
`lightningcss.darwin-arm64.node`, `@tailwindcss/oxide`… típicamente "library load disallowed by system
policy" o "Cannot find module") — macOS puso en cuarentena los binarios nativos. Arréglalo de una vez:

```bash
npm run fix-native   # quita la cuarentena de node_modules y borra la cache .next
npm run dev
# alternativa: usar Webpack en vez de Turbopack
npm run dev:webpack
```

## Estructura de rutas

- `/admin` — Panel de superadministración (clientes, planes, pagos)
- `/portal` — Portal de clientes (ERP de gestión por negocio)

## Agentes de IA

Agentes de IA: leer AGENTS.md antes de tocar nada.
