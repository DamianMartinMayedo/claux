-- ── Vías de pago: separar el tipo de la moneda ────────────────────────────────
--
-- El catálogo de vías venía de un proyecto venezolano y llevaba la moneda dentro
-- del nombre del tipo («Transferencia (VES)»), lo que obligaba a una vía por
-- moneda y dejaba fuera las del negocio cubano (nada en CUP). Ahora una vía es
-- (tipo × moneda): el tipo es el medio de pago y la moneda sale de las que el
-- cliente tiene configuradas en `monedas`.
--
-- Reescribe los tipos viejos conservando la moneda que llevaban en el nombre.
-- `via_primaria`/`via_secundaria` son jsonb sin constraint: esto es un saneo de
-- datos, no un cambio de esquema.

-- tipo viejo → (tipo nuevo, moneda que iba en el nombre)
with mapa(viejo, nuevo, moneda) as (values
  ('Transferencia (VES)',         'Transferencia bancaria',      'VES'),
  ('Transferencia (USD)',         'Transferencia bancaria',      'USD'),
  ('Efectivo (VES)',              'Efectivo',                    'VES'),
  ('Efectivo (USD)',              'Efectivo',                    'USD'),
  -- Pago Móvil era el medio venezolano; su equivalente funcional en Cuba es
  -- Transfermóvil (mismos datos: teléfono + tarjeta del titular).
  ('Pago Móvil',                  'Transfermóvil',               NULL),
  -- Solo cambia la capitalización.
  ('Transferencia Internacional', 'Transferencia internacional', NULL)
)
update third_parties t
set via_primaria = t.via_primaria
      || jsonb_build_object('tipo', m.nuevo)
      || case when m.moneda is null or t.via_primaria ? 'moneda'
              then '{}'::jsonb
              else jsonb_build_object('moneda', m.moneda) end
from mapa m
where t.via_primaria->>'tipo' = m.viejo;

with mapa(viejo, nuevo, moneda) as (values
  ('Transferencia (VES)',         'Transferencia bancaria',      'VES'),
  ('Transferencia (USD)',         'Transferencia bancaria',      'USD'),
  ('Efectivo (VES)',              'Efectivo',                    'VES'),
  ('Efectivo (USD)',              'Efectivo',                    'USD'),
  ('Pago Móvil',                  'Transfermóvil',               NULL),
  ('Transferencia Internacional', 'Transferencia internacional', NULL)
)
update third_parties t
set via_secundaria = t.via_secundaria
      || jsonb_build_object('tipo', m.nuevo)
      || case when m.moneda is null or t.via_secundaria ? 'moneda'
              then '{}'::jsonb
              else jsonb_build_object('moneda', m.moneda) end
from mapa m
where t.via_secundaria->>'tipo' = m.viejo;
