-- ================================================================
-- MIGRACIÓN 083: Soporte — FAQ (editable desde admin) y mensajes de clientes
--
-- soporte_faq       → preguntas frecuentes GLOBALES de CLAUX (no por cliente).
--                     El portal muestra las de 'general' + las de los módulos
--                     que el cliente tiene contratados (modulos_activos).
-- soporte_mensajes  → mensajes que los clientes envían desde el portal; el admin
--                     los recibe y gestiona (NUEVO/LEIDO/RESUELTO). Sin correo aún.
-- ================================================================

CREATE TABLE IF NOT EXISTS soporte_faq (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  modulo_clave TEXT NOT NULL DEFAULT 'general',  -- clave de módulo/funcionalidad o 'general'
  pregunta     TEXT NOT NULL,
  respuesta    TEXT NOT NULL,
  orden        INT  NOT NULL DEFAULT 0,
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_soporte_faq_modulo ON soporte_faq (modulo_clave);

CREATE TABLE IF NOT EXISTS soporte_mensajes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES client_users(user_id) ON DELETE SET NULL,
  email      TEXT,                              -- email del remitente (persiste aunque se borre el user)
  asunto     TEXT NOT NULL,
  mensaje    TEXT NOT NULL,
  estado     TEXT NOT NULL DEFAULT 'NUEVO' CHECK (estado IN ('NUEVO','LEIDO','RESUELTO')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_soporte_msg_estado ON soporte_mensajes (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_soporte_msg_client ON soporte_mensajes (client_id);

-- ── RLS + grants a service_role (la app opera con service_role) ────────────────
ALTER TABLE public.soporte_faq      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soporte_mensajes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.soporte_faq      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.soporte_mensajes TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='soporte_faq_id_seq' AND relkind='S') THEN
    GRANT USAGE, SELECT ON SEQUENCE public.soporte_faq_id_seq TO service_role; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='soporte_mensajes_id_seq' AND relkind='S') THEN
    GRANT USAGE, SELECT ON SEQUENCE public.soporte_mensajes_id_seq TO service_role; END IF;
END $$;

-- ── Semillas de FAQ (el admin puede editarlas/ampliarlas) ──────────────────────
INSERT INTO soporte_faq (modulo_clave, pregunta, respuesta, orden) VALUES
  ('general', '¿Cómo cambio mi contraseña?', 'Entra en tu Perfil (arriba a la derecha) y usa la opción de cambiar contraseña. Si es tu primer acceso con una contraseña temporal, el sistema te pedirá crear una propia.', 1),
  ('general', '¿Cómo añado usuarios a mi equipo?', 'Ve a la sección Usuarios. Como administrador puedes crear operadores, asignarles empresas y elegir a qué módulos acceden (ver o editar).', 2),
  ('general', '¿Cómo contacto con el equipo de CLAUX?', 'Desde esta misma pantalla de Soporte, escríbenos con el formulario de contacto. Recibiremos tu mensaje y te responderemos lo antes posible.', 3),
  ('base', '¿Cómo registro un gasto o un cobro?', 'En Gastos y cobros pulsa "Nuevo gasto" o "Nuevo cobro", completa el importe, la empresa y la fecha. Al pagarlo o cobrarlo, el movimiento se refleja en Tesorería.', 1),
  ('inventario', '¿Cómo doy de alta un producto?', 'En Productos pulsa "Nuevo producto". Después podrás gestionar sus existencias desde Inventario y Almacenes.', 1),
  ('reservas_citas', '¿Dónde veo las reservas del día?', 'En la sección Reservas tienes la agenda del día con las reservas confirmadas y su estado.', 1);

notify pgrst, 'reload schema';
