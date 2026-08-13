-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 188 — Fase 2 del clasificador: los tres papeles que NO son gasto
-- ═══════════════════════════════════════════════════════════════════════════
--
-- EL AGUJERO QUE CIERRA. Hoy `rol_pl` solo admite cuatro valores, y los cuatro
-- restan en el resultado. Así que cuando el dueño compra un refrigerador, saca
-- dinero para él o devuelve el principal de un préstamo, no tiene dónde
-- ponerlo: lo anota como gasto operativo, y su informe dice que perdió dinero
-- el mes que invirtió en su negocio. Es el error contable más caro que comete
-- un negocio pequeño, y hasta hoy CLAUX lo obligaba a cometerlo.
--
-- Los tres papeles nuevos:
--
--   · INVERSION    — lo que se compra y dura años (equipos, obra, vehículos).
--                    Sale dinero, pero el negocio no es más pobre: cambió
--                    dinero por una cosa.
--   · PATRIMONIO   — el dinero del dueño entrando o saliendo. Ni ingreso ni
--                    gasto: es de quién es el negocio, no cómo le va.
--   · FINANCIACION — el principal de un préstamo. Los INTERESES sí son gasto y
--                    siguen en `OTRO`: se separan justamente porque el interés
--                    es el precio del dinero y el principal es dinero prestado.
--
-- 🔴 LO QUE ESTA MIGRACIÓN NO HACE, Y ES DELIBERADO. No reclasifica ni una
-- fila. Ninguna categoría existente cambia de papel: hoy no hay forma de que
-- un cliente tenga estos roles (el CHECK los prohibía), así que ampliar el
-- dominio no puede mover ningún número de ningún informe ya emitido. Quién
-- tiene una inversión anotada como gasto operativo lo decide el dueño, mirando
-- sus categorías, con la previsualización de impacto de F1.5 delante. Una
-- migración que adivinara «esto parece una inversión» reescribiría el pasado
-- de un negocio real por heurística de nombres.
--
-- Depende de: 134 (creó la columna y el CHECK), 184 (`clave_catalogo`).

-- ── El CHECK, ampliado ───────────────────────────────────────────────────────
-- Se recrea en vez de añadirse otro: dos CHECK sobre la misma columna se
-- evalúan los dos y el mensaje de error que ve el servidor sería el del más
-- restrictivo, que es justo el que queremos retirar.

alter table public.categorias_gastos
  drop constraint if exists categorias_gastos_rol_pl_check;

alter table public.categorias_gastos
  add constraint categorias_gastos_rol_pl_check
  check (rol_pl in (
    -- Dentro del resultado
    'COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'OTRO',
    -- Fuera del resultado (fase 2)
    'INVERSION', 'PATRIMONIO', 'FINANCIACION'
  ));

comment on column public.categorias_gastos.rol_pl is
  'Papel de la categoría en el estado de resultados. Se lee SOLO en las raíces: '
  'una subcategoría hereda el de su madre (mig. 134). Los cuatro primeros valores '
  'restan en el resultado; INVERSION, PATRIMONIO y FINANCIACION quedan FUERA de él '
  '(mig. 188) — mueven dinero pero no son gasto, y contarlos como tal es el error '
  'que hace que un negocio crea que perdió el mes que invirtió.';
