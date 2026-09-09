-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 244 — `movimientos_tesoreria.tipo`: normalizar y cerrar el vocabulario
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CÓMO APARECIÓ. Verificando `tes_saldos_a_fecha` (mig. 243) contra los saldos de
-- CLI-0003, los ingresos del rango no cuadraban con la diferencia de saldos. La
-- causa: la columna `tipo` tenía CUATRO valores en la base, no dos.
--
--   INGRESO  748.708,94   ← el vocabulario de Tesorería
--   EGRESO   155.795,00
--   ENTRADA  223.320,50   ← el vocabulario de INVENTARIO, en la tabla equivocada
--   SALIDA    79.500,00
--
-- POR QUÉ IMPORTA, y no es cosmético. Todo el código que suma esta tabla —los
-- saldos de Tesorería, la caja del panel, el flujo de caja del informe— parte en dos
-- con la misma forma:
--
--     if (m.tipo === 'INGRESO') suma += monto   else suma −= monto
--
-- o sea que **todo lo que no diga exactamente `INGRESO` se resta**. Los 15 cobros
-- marcados `ENTRADA` (223.320,50) entraban en el saldo con el signo cambiado: el
-- error en las cuentas afectadas era del DOBLE de esa cifra. Los `SALIDA` acertaban
-- por casualidad, porque el `else` ya restaba.
--
-- ALCANCE: **solo CLI-0003** (Negocio Test), 27 filas escritas de una vez el
-- 2026-06-26 18:26:28 — una siembra de datos de demo con el vocabulario de
-- `movimientos_inventario` (`ENTRADA | SALIDA | AJUSTE | TRANSFERENCIA`), que es
-- donde esas palabras sí significan algo. Ningún cliente real las tiene y ninguna
-- ruta del código las escribe: los ocho `insert` sobre esta tabla ponen `'INGRESO'`
-- o `'EGRESO'` literales, y el formulario valida contra `TIPOS_MOVIMIENTO`.
--
-- POR QUÉ EL CHECK. La columna era texto libre sin restricción: una siembra con la
-- palabra de al lado entra sin protestar y sale como un saldo con el signo cambiado,
-- que es un número creíble y falso —el mismo fallo de fondo que el techo de las
-- 1.000 filas—. Con el CHECK, un error así deja de ser un saldo raro y pasa a ser un
-- insert que falla.
--
-- Depende de: 022 (tesorería).

-- ── 1. Normalizar lo sembrado ────────────────────────────────────────────────
-- `ENTRADA` es dinero que entra y `SALIDA` dinero que sale: la traducción es directa
-- y no hay más valores que traducir (comprobado: `select distinct tipo`).
update public.movimientos_tesoreria set tipo = 'INGRESO' where tipo = 'ENTRADA';
update public.movimientos_tesoreria set tipo = 'EGRESO'  where tipo = 'SALIDA';

-- ── 2. Cerrar el vocabulario ─────────────────────────────────────────────────
alter table public.movimientos_tesoreria
  drop constraint if exists movimientos_tesoreria_tipo_check;

alter table public.movimientos_tesoreria
  add constraint movimientos_tesoreria_tipo_check
  check (tipo in ('INGRESO', 'EGRESO'));

comment on column public.movimientos_tesoreria.tipo is
  'INGRESO | EGRESO. Cerrado por CHECK en la mig. 244: era texto libre y una siembra con el '
  'vocabulario de inventario (ENTRADA/SALIDA) metió 27 movimientos que todos los sumadores '
  'contaban con el signo cambiado, porque parten en dos con «si no es INGRESO, resta».';
