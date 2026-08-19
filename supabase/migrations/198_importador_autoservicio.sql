-- ================================================================
-- MIGRACIÓN 198: Importador de autoservicio — permisos + ficha del cliente
--
-- Abre el importador (hoy solo del equipo por impersonación) al CLIENTE en
-- autoservicio. Tres columnas nuevas, sin tablas nuevas (RLS y purga heredadas):
--
--  · client_users.puede_importar  — UN interruptor por usuario (no por módulo).
--      El admin_empresa editor lo tiene implícito (en código); a otro usuario se
--      lo enciende su admin. Al activarlo, la herramienta abre TODOS los módulos
--      que el cliente tenga contratados. El candado comercial se mantiene: cada
--      entidad solo carga si el tenant contrató su módulo (requireImportarEntidad).
--  · clients.autoimport_activo    — interruptor de EMERGENCIA del equipo (def. ON).
--      false = ese cliente no puede autoservirse (el equipo sí, por impersonación).
--  · clients.migracion_estado     — gobierna el aviso de bienvenida y, en un estado,
--      la visibilidad de la herramienta. Se elige en el ALTA del cliente.
--      'a_cargo_equipo' OCULTA el importador (lo hace el equipo, no chocan).
-- Ver docs/planes/importador-autoservicio-cliente.md (§4, §5).
-- ================================================================

-- ── Permisos: interruptor de importación por usuario (Fase 1) ────────────────
ALTER TABLE public.client_users
  ADD COLUMN IF NOT EXISTS puede_importar BOOLEAN NOT NULL DEFAULT false;

-- ── Ficha del cliente: control del autoservicio (Fase 2) ─────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS autoimport_activo BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS migracion_estado TEXT NOT NULL DEFAULT 'sin_datos_previos'
    CHECK (migracion_estado IN ('sin_datos_previos', 'pendiente', 'a_cargo_equipo', 'completada'));

COMMENT ON COLUMN public.client_users.puede_importar IS
  'Importador de autoservicio: UN interruptor por usuario. El admin_empresa editor lo tiene implícito (código). No trocea por módulo; el candado comercial lo pone requireImportarEntidad (módulo contratado ∩ puedeImportar).';
COMMENT ON COLUMN public.clients.autoimport_activo IS
  'Interruptor de emergencia del equipo para el importador de autoservicio (default ON). false = el cliente no puede autoservirse (el equipo sí, por impersonación).';
COMMENT ON COLUMN public.clients.migracion_estado IS
  'sin_datos_previos | pendiente | a_cargo_equipo | completada. Gobierna el aviso «Trae tus datos» y, en a_cargo_equipo, oculta el importador de autoservicio.';
