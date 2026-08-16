-- ================================================================
-- MIGRACIÓN 196: Permisos por usuario «Por defecto + matriz»
--
-- Un único eje de escritura por usuario:
--   client_users.permiso_defecto  ∈ {sin_acceso, ver, editar}  → aplica a TODOS los
--     módulos contratados, incluidos los futuros.
--   usuario_modulo.permiso        ∈ {sin_acceso, ver, editar}  → excepción por módulo
--     (sustituye a puede_editar). Solo hay fila cuando difiere del defecto.
--
-- Efectivo por módulo = override ?? defecto. visible = ≠ sin_acceso; editable = editar.
-- Retira el solapamiento del interruptor maestro `solo_lectura` como ENTRADA: ya no se
-- edita a mano. Pasa a ser un DERIVADO cacheado (= «no puede editar NINGÚN módulo»), que
-- `getPortalSession`/`perfil`/el badge de la lista leen barato sin recalcular. La app lo
-- reescribe en cada guardado de usuario. Ver docs/planes/permisos-por-defecto-y-matriz.md.
-- ================================================================

-- ── Nuevas columnas ──────────────────────────────────────────────────────────
ALTER TABLE public.client_users
  ADD COLUMN IF NOT EXISTS permiso_defecto TEXT NOT NULL DEFAULT 'editar'
    CHECK (permiso_defecto IN ('sin_acceso', 'ver', 'editar'));

ALTER TABLE public.usuario_modulo
  ADD COLUMN IF NOT EXISTS permiso TEXT NOT NULL DEFAULT 'ver'
    CHECK (permiso IN ('sin_acceso', 'ver', 'editar'));

-- ── Backfill: preserva el comportamiento efectivo exacto ─────────────────────
-- Excepciones por módulo: si el usuario era solo_lectura, la edición estaba apagada
-- globalmente → colapsan a 'ver'; si no, mapea puede_editar.
UPDATE public.usuario_modulo um SET permiso = CASE
  WHEN (SELECT cu.solo_lectura FROM public.client_users cu WHERE cu.user_id = um.user_id) THEN 'ver'
  WHEN um.puede_editar THEN 'editar'
  ELSE 'ver'
END;

-- Permiso por defecto:
--   operador CON filas de módulo  → 'sin_acceso' (solo veía las listadas)
--   resto (admin, u operador sin filas) → 'ver' si solo_lectura, si no 'editar'
UPDATE public.client_users cu SET permiso_defecto = CASE
  WHEN cu.rol = 'usuario'
       AND EXISTS (SELECT 1 FROM public.usuario_modulo um WHERE um.user_id = cu.user_id)
    THEN 'sin_acceso'
  WHEN cu.solo_lectura THEN 'ver'
  ELSE 'editar'
END;

-- ── Recalcular `solo_lectura` como DERIVADO del modelo nuevo ─────────────────
-- = «no puede editar NINGÚN módulo contratado». Deja la columna cacheada coherente con
-- lo que calcula el login (misma fórmula que calcularAcceso). Sin esto, un operador con
-- solo permisos 'ver' por módulo quedaría con la columna vieja (solo_lectura=false) y el
-- badge/perfil mentirían (los guards por módulo bloquean igual, es solo cosmético).
WITH calc AS (
  SELECT cu.user_id,
    CASE
      -- admin: la matriz se ignora; edita algo sólo si el defecto es 'editar' y hay contratados
      WHEN cu.rol = 'admin_empresa' THEN NOT (
        cu.permiso_defecto = 'editar'
        AND COALESCE(array_length(c.modulos_activos, 1), 0) > 0
      )
      -- operador: edita algo si algún módulo contratado tiene efectivo (override ?? defecto) = 'editar'
      ELSE NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(c.modulos_activos, ARRAY[]::text[])) AS m(clave)
        WHERE COALESCE(
          (SELECT um.permiso FROM public.usuario_modulo um
             WHERE um.user_id = cu.user_id AND um.modulo_clave = m.clave),
          cu.permiso_defecto
        ) = 'editar'
      )
    END AS derived_sl
  FROM public.client_users cu
  JOIN public.clients c ON c.client_id = cu.client_id
)
UPDATE public.client_users cu
SET solo_lectura = calc.derived_sl
FROM calc
WHERE calc.user_id = cu.user_id
  AND cu.solo_lectura IS DISTINCT FROM calc.derived_sl;

-- ── Recarga caché de PostgREST ───────────────────────────────────────────────
notify pgrst, 'reload schema';
