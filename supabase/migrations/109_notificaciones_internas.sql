-- Notificaciones internas del portal (bandeja del negocio).
--
-- Avisos accionables para el dueño DENTRO del portal: vencimientos, eventos y
-- umbrales de sus propios módulos. No son correo (el correo a CLAUX ya existe en
-- emails_log): viven en la campana de la cabecera y en /portal/notificaciones.
--
-- Bandeja COMPARTIDA del tenant: una fila por evento, sin fan-out por usuario y
-- sin tabla de lecturas — marcar leído afecta a todos los admins. Solo los
-- usuarios con rol admin_empresa ven la campana.
--
-- Sin RLS (patrón del repo: cada query filtra por client_id).

CREATE TABLE IF NOT EXISTS notificaciones (
  id           BIGSERIAL PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  -- Contexto multi-empresa (deep-link y etiqueta). TEXT, como empresas.empresa_id.
  empresa_id   TEXT REFERENCES empresas(empresa_id) ON DELETE SET NULL,
  tipo         TEXT NOT NULL,
  categoria    TEXT NOT NULL,
  severidad    TEXT NOT NULL DEFAULT 'info' CHECK (severidad IN ('info','aviso','urgente')),
  titulo       TEXT NOT NULL,
  cuerpo       TEXT NOT NULL DEFAULT '',
  enlace       TEXT,
  -- Entidad de origen: idempotencia del cron + resolución automática.
  entidad_tipo TEXT,
  entidad_id   TEXT,
  -- Escalón temporal del aviso: 30d|15d|5d|1d|vencido. Parte de la clave de dedupe.
  umbral       TEXT,
  estado       TEXT NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva','leida','archivada')),
  -- El popup de severidad 'aviso' se muestra UNA vez; el 'urgente' reaparece.
  popup_mostrado BOOLEAN NOT NULL DEFAULT FALSE,
  -- La condición de origen ya no aplica (contrato renovado, factura cobrada…).
  resuelta     BOOLEAN NOT NULL DEFAULT FALSE,
  leida_por    TEXT,
  leida_at     TIMESTAMPTZ,
  meta         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bandeja y contador de no-leídas.
CREATE INDEX IF NOT EXISTS idx_notif_bandeja
  ON notificaciones (client_id, estado, created_at DESC);

-- Idempotencia: el cron puede correr N veces al día sin duplicar el mismo escalón.
-- `tipo` va DENTRO de la clave a propósito: sin él, dos tipos distintos que
-- apuntan a la misma entidad y umbral (p. ej. cxc_vencida y factura_vencida sobre
-- una factura) colisionarían y uno se perdería en silencio.
-- coalesce(umbral,'') porque en Postgres los NULL son distintos entre sí y los
-- avisos por evento (sin umbral) se duplicarían.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_idem
  ON notificaciones (client_id, tipo, entidad_tipo, entidad_id, COALESCE(umbral,''))
  WHERE entidad_id IS NOT NULL;

-- Preferencias por tenant. Fila ausente = valores por defecto del catálogo
-- (src/lib/notificaciones/catalogo.ts), así que no hace falta sembrar nada.
CREATE TABLE IF NOT EXISTS notificacion_config (
  client_id          TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  tipo               TEXT NOT NULL,
  activa             BOOLEAN NOT NULL DEFAULT TRUE,
  -- Sube o baja la agresividad respecto al default del catálogo.
  severidad_override TEXT CHECK (severidad_override IN ('info','aviso','urgente')),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, tipo)
);

-- SIN Realtime, a propósito. La campana se refresca al volver a la pestaña, no
-- por websocket: `postgres_changes` filtra por las políticas RLS del rol que se
-- suscribe, y el navegador del portal se conecta como `anon` (sus usuarios son
-- client_users con JWT propio, no Supabase Auth). Para que llegara el evento
-- haría falta una policy de SELECT para `anon`, y eso expondría la bandeja de
-- TODOS los tenants a una clave que es pública. Suscribirse igualmente abriría
-- un websocket que nunca entrega nada — coste puro en la conexión cubana.
-- Si algún día el portal pasa a Supabase Auth, se añade aquí el ALTER PUBLICATION.
