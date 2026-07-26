-- Notificaciones internas del ADMIN (bandeja del equipo de CLAUX).
--
-- Es el espejo de la bandeja del portal (migración 109) para el panel interno:
-- leads, ampliaciones, soporte, cobros y plataforma. Misma mecánica —campana en
-- la cabecera, popups por severidad, preferencias por tipo— con dos diferencias
-- que obligan a tabla propia en vez de reusar `notificaciones`:
--
--  1. `notificaciones.client_id` es NOT NULL y TODAS las queries del portal
--     filtran por él. Colar aquí filas con client_id nulo obligaría a tocar cada
--     una, con riesgo de fuga entre bandejas.
--  2. El candado no es el módulo contratado sino el PERMISO de sección del admin
--     (`seccion`), que en el portal no existe.
--
-- Estado de lectura COMPARTIDO por el equipo, igual que en el portal: la bandeja
-- es la cola de trabajo, y que alguien marque leído un lead es precisamente la
-- señal de "ya lo atiende alguien". Si el equipo crece y estorba, se añade una
-- tabla de lecturas por email (y hay que rehacer acciones y campana).
--
-- RLS habilitada sin políticas + grant a service_role: patrón del repo (011).
-- Sin RLS, la clave anon podría leer la tabla vía PostgREST.

CREATE TABLE IF NOT EXISTS admin_notificaciones (
  id             BIGSERIAL PRIMARY KEY,
  tipo           TEXT NOT NULL,
  categoria      TEXT NOT NULL,
  severidad      TEXT NOT NULL DEFAULT 'info' CHECK (severidad IN ('info','aviso','urgente')),
  -- Permiso de sección que hace falta para verla (SeccionKey de src/lib/roles.ts).
  -- NULL = aviso de plataforma: solo super_admin.
  seccion        TEXT,
  titulo         TEXT NOT NULL,
  cuerpo         TEXT NOT NULL DEFAULT '',
  enlace         TEXT,
  -- Entidad de origen: idempotencia del cron + resolución automática después.
  entidad_tipo   TEXT,
  entidad_id     TEXT,
  -- Escalón temporal: 15d|5d|1d|vencido. Parte de la clave de dedupe.
  umbral         TEXT,
  -- Cliente al que se refiere, si aplica: agrupa y permite enlazar a su ficha.
  -- ON DELETE CASCADE para que borrar un cliente no deje avisos huérfanos que
  -- enlacen a una ficha que ya no existe.
  client_id      TEXT REFERENCES clients(client_id) ON DELETE CASCADE,
  estado         TEXT NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva','leida','archivada')),
  -- El popup de severidad 'aviso' se muestra UNA vez; el 'urgente' reaparece.
  popup_mostrado BOOLEAN NOT NULL DEFAULT FALSE,
  -- La condición de origen ya no aplica (lead contactado, soporte respondido…).
  resuelta       BOOLEAN NOT NULL DEFAULT FALSE,
  leida_por      TEXT,
  leida_at       TIMESTAMPTZ,
  meta           JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bandeja y contador de no-leídas.
CREATE INDEX IF NOT EXISTS idx_admin_notif_bandeja
  ON admin_notificaciones (estado, created_at DESC);

-- Idempotencia: el cron puede correr N veces al día sin duplicar el mismo
-- escalón. `tipo` va DENTRO de la clave (dos tipos sobre la misma entidad son
-- avisos distintos) y coalesce(umbral,'') porque en Postgres dos NULL no son
-- iguales y los avisos por evento se duplicarían.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_notif_idem
  ON admin_notificaciones (tipo, entidad_tipo, entidad_id, COALESCE(umbral,''))
  WHERE entidad_id IS NOT NULL;

-- Preferencias del EQUIPO por tipo (no por persona: el estado de lectura también
-- es compartido). Fila ausente = default del catálogo en
-- src/lib/notificaciones/admin/catalogo.ts, así que no hay que sembrar nada.
CREATE TABLE IF NOT EXISTS admin_notificacion_config (
  tipo               TEXT PRIMARY KEY,
  activa             BOOLEAN NOT NULL DEFAULT TRUE,
  severidad_override TEXT CHECK (severidad_override IN ('info','aviso','urgente')),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Grants y RLS (patrón 011: service_role explícito, sin políticas) ──────────

ALTER TABLE admin_notificaciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notificacion_config ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_notificaciones      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_notificacion_config TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.admin_notificaciones_id_seq       TO service_role;

NOTIFY pgrst, 'reload schema';
