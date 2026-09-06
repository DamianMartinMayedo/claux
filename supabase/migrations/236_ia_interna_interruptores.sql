-- ─────────────────────────────────────────────────────────────────────────────
-- 236 · La IA interna: más orígenes, interruptor y precio
--
-- Tres cosas que necesita el plan `ia-claux-plataforma` para poder enchufar la IA
-- del equipo en el admin sin perder el control de lo que gasta ni de lo que hace.
--
-- 1. ORÍGENES. El `check` de la 235 conocía cuatro sitios donde se gasta la bolsa.
--    Las fases nuevas añaden cuatro más. La granularidad es POR ÁREA y no por
--    función a propósito: ocho filas se leen de un vistazo en /admin/ia y
--    responden a la pregunta que uno se hace al mirar la factura («¿en qué se nos
--    va?»); veinte, no. El detalle por función ya lo da el catálogo del código.
--
-- 2. INTERRUPTOR. Hasta ahora la única forma de apagar la IA interna era poner el
--    tope a 0, que es apagarla MINTIENDO: el panel diría «bolsa agotada» cuando lo
--    que pasa es que la hemos apagado nosotros. Y el tope tampoco sirve para
--    apagar UNA función y dejar el resto. Dos ajustes:
--      · ia_interna_activa  — el interruptor general ('1' encendido).
--      · ia_funciones_off   — JSON con las funciones apagadas una a una.
--    Apagar NO es esconder el botón: lo comprueba `chatInterno()`, que es la única
--    puerta, así que un consumidor olvidado tampoco puede llamar al proveedor.
--
-- 3. PRECIO. `ia_uso_interno` ya guarda tokens por origen, o sea que el coste real
--    es una multiplicación… que hoy no se puede hacer porque el precio del modelo
--    no está en ninguna parte. Dos columnas por millón de tokens, NULABLES y sin
--    sembrar: el precio lo teclea el dueño en /admin/ia (una tarifa inventada por
--    una migración es peor que ninguna, porque nadie vuelve a mirarla).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 · Orígenes
alter table public.ia_uso_interno drop constraint if exists ia_uso_interno_origen_ck;
alter table public.ia_uso_interno add constraint ia_uso_interno_origen_ck
  check (origen in (
    'importador',    -- mapeo de columnas, pendientes, reglas, errores
    'propuesta',     -- borrador de la propuesta comercial
    'soporte',       -- clasificación, borrador de respuesta, FAQ
    'relleno',       -- los tres textos del catálogo de módulos
    'presupuesto',   -- rellenar desde el lead y revisar antes de emitir
    'parte',         -- el parte del equipo en el panel
    'cliente',       -- resumen de la ficha de un cliente
    'contabilidad'   -- clasificar las cuentas que trae una migración
  ));

comment on column public.ia_uso_interno.origen is
  'Área que gastó la conversación. Ocho valores (mig. 236); el catálogo por función vive en src/lib/ia/funciones.ts.';

-- 2 · Interruptores
insert into settings (key, value) values
  ('ia_interna_activa', '1'),
  ('ia_funciones_off',  '[]')
on conflict (key) do nothing;

-- 3 · Precio por millón de tokens (lo teclea el dueño; null = sin tarifa)
alter table public.ia_modelos add column if not exists precio_in  numeric(10,4);
alter table public.ia_modelos add column if not exists precio_out numeric(10,4);

comment on column public.ia_modelos.precio_in is
  'Precio por MILLÓN de tokens de entrada, en USD. Null = sin tarifa: el panel dice «sin tarifa» y no inventa un coste.';
comment on column public.ia_modelos.precio_out is
  'Precio por MILLÓN de tokens de salida, en USD. Ojo: los tokens de razonamiento se facturan aquí.';

notify pgrst, 'reload schema';
