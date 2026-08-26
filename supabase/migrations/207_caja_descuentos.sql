-- 207 · Caja — descuentos a mano (por línea y por ticket)
--
-- El cajero negocia en el mostrador: «este libro tiene una tara, 10 %» (línea) o «te dejo
-- la compra entera en 4.500» (ticket). Hasta hoy eso solo se podía hacer tecleando un
-- precio distinto, y entonces lo regalado no existe en ninguna parte.
--
-- Se calca el par que el resto del sistema ya usa en `documento_lineas` (mig. 015):
-- `descuento_pct` + `descuento_importe`, con el MODO DERIVADO —pct > 0 ⇒ porcentaje, si no
-- monto fijo— en lugar de una tercera columna que diga cuál manda. Vocabulario idéntico al
-- de la factura: quien lea las dos tablas no tiene que aprender dos cosas.
--
-- Invariante que se mantiene: `caja_ticket_lineas.subtotal` sigue siendo el NETO de la
-- línea (bruto − descuento de línea), porque es lo que suma la guardia de la ingesta. El
-- descuento de TICKET sí es una deducción aparte, y por eso la guardia pasa a comprobar
-- `Σ subtotal − descuento_importe ≈ total` (ver src/lib/caja/ingesta.ts).
--
-- Sin techo, sin motivo y sin PIN: decisión del dueño (2026-08-25). El TPV no bloquea,
-- hace visible — el mismo criterio que el `permitir_negativo` del stock. El control es que
-- lo regalado se vea en Ventas, en el detalle del ticket, en el resumen del turno y en el Z.

-- ── 1. Descuento por línea ───────────────────────────────────────────────────
alter table public.caja_ticket_lineas
  add column if not exists descuento_pct     numeric(6,2)  not null default 0,
  add column if not exists descuento_importe numeric(18,2) not null default 0;

-- ── 2. Descuento de ticket + bruto de cabecera ───────────────────────────────
-- `bruto` es lo que habría costado sin ningún descuento (de línea ni de ticket). Se guarda
-- calculado en vez de derivarlo al leer porque el listado de Ventas lo pinta en cada fila y
-- las líneas viven en otra tabla: derivarlo obligaría a un join por cada listado.
alter table public.caja_tickets
  add column if not exists bruto             numeric(18,2) not null default 0,
  add column if not exists descuento_pct     numeric(6,2)  not null default 0,
  add column if not exists descuento_importe numeric(18,2) not null default 0;

-- Los tickets que ya existen no tuvieron descuento: su bruto es su total. Sin esto el
-- listado pintaría «bruto 0 → total 4.500», que se lee como un error del sistema.
update public.caja_tickets set bruto = total where bruto = 0 and total <> 0;

-- ── 3. Índice para «solo ventas con descuento» ───────────────────────────────
-- Parcial: los tickets con descuento son la excepción (unos pocos por turno), así que el
-- índice pesa nada y el filtro del listado no recorre la tabla entera.
create index if not exists idx_caja_tickets_con_descuento
  on public.caja_tickets (client_id, empresa_id, fecha)
  where descuento_importe > 0;
