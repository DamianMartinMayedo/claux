-- ================================================================
-- MIGRACIÓN 160: un solo conteo abierto por almacén, garantizado por la BD
--
-- QUÉ PASÓ. La 156 dejó `/portal/almacenes/[id]/conteo` **abriendo el borrador durante
-- el render de la página**. Dos consecuencias, las dos malas:
--
--   1. El botón «Contar» era un `<Link>`, y **Next.js prefetcha los enlaces**: pasar el
--      ratón por encima ya renderizaba la página en el servidor y creaba un conteo.
--   2. Varios renders simultáneos hacían el mismo `select ... where estado='BORRADOR'`
--      a la vez, ninguno encontraba nada y **todos insertaban**. La idempotencia estaba
--      escrita en TypeScript, que es donde no sirve para una carrera.
--
-- Resultado en el entorno de prueba: **352 borradores, 2 con algo contado**.
--
-- El arreglo de verdad es doble y el código va aparte: «Contar» pasa a ser un BOTÓN que
-- llama a la acción y navega al conteo ya creado, y la ruta que escribía al renderizar
-- desaparece. Aquí va lo que le toca a la base: la invariante deja de ser una intención
-- y pasa a ser un índice. Una regla que solo vive en el código de aplicación es una
-- regla que se rompe en cuanto hay dos peticiones a la vez.
--
-- ÍNDICE PARCIAL, no único a secas: un almacén puede tener MUCHOS conteos aplicados
-- (uno por mes, que es justo el historial que se quiere), pero **solo uno abierto**.
-- Dos borradores del mismo almacén son dos verdades distintas sobre lo mismo.
-- ================================================================

-- ── 1. Deduplicar antes de poder indexar ──
-- Se conserva, por almacén, el borrador que MÁS trabajo tiene hecho (líneas contadas) y,
-- a igualdad, el más reciente. Lo que se borra son hojas vacías: no se pierde ningún
-- conteo real, y una hoja vacía se vuelve a abrir cuando haga falta.
create temporary table _conteos_sobran as
with ranked as (
  select c.conteo_id,
         row_number() over (
           partition by c.client_id, c.almacen_id
           order by (select count(*) from conteo_lineas l
                     where l.conteo_id = c.conteo_id and l.contado is not null) desc,
                    c.created_at desc
         ) as rn
  from conteos c
  where c.estado = 'BORRADOR'
)
select conteo_id from ranked where rn > 1;

delete from conteo_lineas where conteo_id in (select conteo_id from _conteos_sobran);
delete from conteos      where conteo_id in (select conteo_id from _conteos_sobran);
drop table _conteos_sobran;

-- ── 2. La invariante, en la base ──
create unique index if not exists idx_conteo_borrador_unico
  on conteos (client_id, almacen_id)
  where estado = 'BORRADOR';

comment on index idx_conteo_borrador_unico is
  'Un solo conteo ABIERTO por almacen (mig. 160). Los aplicados no se limitan: son el '
  'historial. La idempotencia de abrirConteo se apoya en este indice, no en un select '
  'previo, que en dos peticiones simultaneas no ve nada y deja insertar a las dos.';

notify pgrst, 'reload schema';
