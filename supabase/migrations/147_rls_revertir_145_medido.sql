-- ================================================================
-- MIGRACIÓN 147: revertir la 145 — estaba fundamentada en una premisa falsa
--
-- QUÉ DECÍA LA 145. Que las cinco tablas nuevas de nómina tenían RLS activado y
-- cero políticas, y que por eso «el admin en producción no las carga». Se apoyaba en
-- la mig. 085, que arregló ese fallo real en su día.
--
-- POR QUÉ ERA FALSA. La 085 sigue siendo correcta para las tablas de entonces, pero
-- el diagnóstico NO se comprobó contra el código actual antes de aplicarlo: se dio
-- por hecho que el admin lee cualquier tabla con el cliente autenticado. Medido
-- ahora, tabla por tabla, el admin autenticado (`@/lib/supabase/server`, el único
-- que respeta RLS) alcanza exactamente CATORCE tablas:
--
--   admin_users · audit_log · client_users · clients · diagnostico_necesidades ·
--   ia_modelos · ia_uso · modulos_catalogo · payments · plantillas_sector ·
--   presupuestos_instalacion · settings · soporte_faq · soporte_mensajes
--
-- Ninguna de las cinco de nómina está ahí, y ninguna de las otras 21 sin política
-- tampoco. Todo lo demás —el portal entero, las páginas públicas, el generador de
-- notificaciones, las métricas del admin (`actions/admin/metricas.ts`, que lo dice
-- en su propia cabecera)— entra por `createAdminClient()`, es decir `service_role`,
-- que **ignora RLS**. Para esas tablas «RLS activado y sin política» no es un
-- agujero: es la configuración MÁS CERRADA posible, y es la que tenían.
--
-- Así que la 145 no arregló nada. Concedió a `authenticated` acceso total a cinco
-- tablas que nadie lee por esa vía.
--
-- POR QUÉ SE REVIERTE EN VEZ DE DEJARLO ASÍ. Hoy el daño es cero: solo los
-- super-admins tienen sesión de Supabase Auth, y ya tienen acceso a todo. Pero:
--
--  1) `docs/CONTEXTO.md` deja escrito que para reactivar Realtime en el portal hay
--     que **mover los usuarios del portal a Supabase Auth**. El día que eso pase,
--     cada política `for all to authenticated using (true)` se convierte en una
--     fuga entre inquilinos: el aislamiento por `client_id` lo hace la aplicación,
--     no RLS. Cada política gratuita agranda el radio de ese cambio ya planificado.
--  2) La cabecera de la 145 dejaba escrita una regla equivocada —«cada create table
--     reabre el agujero, añade su política»—, que invita a repetir el error tabla a
--     tabla. Un comentario incorrecto en el repo se propaga: el siguiente que lo lea
--     (persona o agente) lo aplicará.
--
-- LA REGLA CORRECTA. Una tabla lleva política `admin_full_access` cuando **una
-- pantalla o acción del admin la lee con el cliente autenticado**, y solo entonces.
-- No por defecto, y no por analogía con la 085. Si algo «no carga en el admin en
-- producción», antes de añadir la política hay que comprobar por qué cliente entra
-- esa lectura: si es `service_role`, el problema es otro y la política no lo arregla.
--
-- CUANDO SÍ HARÁ FALTA. `parametros_fiscales_cuba` tiene pendiente su pantalla en
-- `/admin/configuracion` (los tipos de ONAT se mantienen ahí, no por migración). Ese
-- fichero, `admin/(protected)/configuracion/page.tsx`, SÍ usa el cliente
-- autenticado. El día que la pantalla se escriba, su política entra **en la misma
-- migración que la pantalla**, no antes.
-- ================================================================

drop policy if exists "admin_full_access" on public.nomina_linea_conceptos;
drop policy if exists "admin_full_access" on public.deducciones_reglas;
drop policy if exists "admin_full_access" on public.empresa_config_nomina;
drop policy if exists "admin_full_access" on public.incidencias_nomina;
drop policy if exists "admin_full_access" on public.parametros_fiscales_cuba;

-- Verificación: las cinco vuelven a estar cerradas (RLS on, sin políticas), que es
-- el estado en el que las crearon las migs. 140-144.
do $$
declare con_politica text;
begin
  select string_agg(c.relname, ', ') into con_politica
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_policy p on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relname in ('nomina_linea_conceptos','deducciones_reglas',
                      'empresa_config_nomina','incidencias_nomina',
                      'parametros_fiscales_cuba');

  if con_politica is not null then
    raise exception 'Siguen con política: %', con_politica;
  end if;
end $$;
