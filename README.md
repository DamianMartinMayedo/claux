# CLAUX

Plataforma SaaS multi-tenant para digitalizar negocios locales cubanos, principalmente restaurantes. Incluye menú QR, reservas, bot de Telegram y módulos de gestión (contabilidad, inventario, RRHH).

## Requisitos

- Node.js 20+
- npm 10+

## Variables de entorno

Crea un archivo `.env.local` en la raíz:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
PORTAL_JWT_SECRET=
```

## Arranque

```bash
npm install
npm run dev
```

## Estructura de rutas

- `/admin` — Panel de superadministración (clientes, planes, pagos)
- `/portal` — Portal de clientes (ERP de gestión por negocio)

## Agentes de IA

Agentes de IA: leer AGENTS.md antes de tocar nada.
