-- ─────────────────────────────────────────────────────────────────────────────
-- 211 · La ligadura operador ↔ punto de venta, con FOREIGN KEY de verdad
-- ─────────────────────────────────────────────────────────────────────────────
-- La mig. 208 creó `caja_operadores_cajas` con `caja_id` y `operador_id` en texto y
-- SIN declarar las dos claves ajenas. Dos consecuencias, y la segunda costó una
-- versión entera:
--
--   1. Integridad: una fila podía apuntar a un cajero borrado o a una caja que ya no
--      existe. Un cajero fantasma en el desplegable del mostrador.
--   2. **La semilla no bajaba los operadores.** `construirSeed` los pedía con un embed
--      de PostgREST (`caja_operadores!inner(...)`), y el embed EXIGE una FK declarada
--      para deducir la relación. Sin ella la petición fallaba con «could not find a
--      relationship», el `?? []` del código la convertía en «esta caja no tiene
--      cajeros» y el dueño podía ligar trabajadores en el portal todas las veces que
--      quisiera: el desplegable del dispositivo no aparecía nunca. Ni un error en
--      consola, ni un log. La semilla ya no usa el embed (dos consultas y el cruce en
--      JS, para no depender de que PostgREST deduzca nada), pero la FK se declara
--      igual: es lo que evita el punto 1 y lo que hace que el embed funcione si algún
--      día alguien lo vuelve a escribir.
--
-- `on delete cascade` en las dos: borrar un cajero o un punto de venta se lleva sus
-- ligaduras. No hay nada que conservar en una fila que ya no une nada — y lo que sí se
-- conserva del histórico es el NOMBRE congelado en `caja_sesiones` (mig. 208), que no
-- depende de esta tabla.
--
-- Verificado antes de aplicar: 0 filas huérfanas por los dos lados.

alter table public.caja_operadores_cajas
  drop constraint if exists fk_caja_op_cajas_operador,
  add  constraint fk_caja_op_cajas_operador
       foreign key (operador_id) references public.caja_operadores (operador_id)
       on delete cascade;

alter table public.caja_operadores_cajas
  drop constraint if exists fk_caja_op_cajas_caja,
  add  constraint fk_caja_op_cajas_caja
       foreign key (caja_id) references public.cajas (caja_id)
       on delete cascade;
