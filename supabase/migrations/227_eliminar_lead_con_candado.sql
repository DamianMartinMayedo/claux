-- ================================================================
-- MIGRACIÓN 227: borrar una solicitud de diagnóstico, con candado
--
-- La limpieza de leads de prueba comprobaba el candado desde la
-- aplicación (leer presupuestos → borrar). Dos agujeros, los dos
-- reales y encontrados con los datos de producción delante:
--
-- 1) EL CANDADO MIRABA DONDE NO HAY NADA. Solo bloqueaba al lead con
--    un presupuesto que lo referenciase por `diagnostico_id`, y 5 de
--    los 6 presupuestos de producción tienen ese campo a null: se
--    crean desde cero, no desde el lead. Resultado: Silvia Padrón
--    (CLI-0013) y Oniel Díaz (CLI-0008) —dos CLIENTES— quedaban
--    borrables, y el único protegido era Elina Díaz, que todavía no
--    es cliente. Justo al revés.
--
--    La señal que no falla no está en otra tabla: está en la propia
--    fila. `estado = 'contactado'` significa que una persona la
--    trabajó, y `contacto_solicitado_at` que el lead pulsó «quiero
--    que me contacten». Ninguna de las dos se pone sola.
--
-- 2) COMPROBAR Y BORRAR NO ERAN LA MISMA OPERACIÓN. Entre la lectura
--    y el delete cabía que alguien creara un presupuesto desde ese
--    lead, y como la FK es `on delete set null` el presupuesto se
--    quedaba sin origen y en silencio. Aquí se cierra: el `for
--    update` sobre la fila del lead choca con el `for key share` que
--    toma la FK al insertar el presupuesto, así que las dos cosas se
--    ponen en fila.
--
-- Devuelve un código, no un booleano: quien llama necesita saber por
-- qué no se borró para poder decírselo a quien lo intentó.
-- ================================================================

create or replace function eliminar_lead(p_id bigint)
returns text
language plpgsql
as $$
declare
  v_estado  text;
  v_pidio   timestamptz;
  v_presups bigint[];
begin
  -- El `for update` es el candado de concurrencia (ver cabecera). Si la fila ya
  -- no está, se responde `no_existe` y quien llama lo trata como hecho: la lista
  -- pudo quedarse abierta en otra pestaña.
  select estado, contacto_solicitado_at
    into v_estado, v_pidio
    from diagnosticos
   where id = p_id
     for update;
  if not found then
    return 'no_existe';
  end if;

  select coalesce(array_agg(id order by id), '{}')
    into v_presups
    from presupuestos_instalacion
   where diagnostico_id = p_id;
  if array_length(v_presups, 1) is not null then
    return 'presupuesto';
  end if;

  -- Pidió que le llamemos. Va ANTES que 'contactado' aunque sea el caso menos
  -- común: es el candado que no se levanta, y ponerlo después mandaría a quien
  -- lo intenta a marcar la solicitud como nueva para volver a chocar con este.
  if v_pidio is not null then
    return 'pidio_contacto';
  end if;

  -- Marcada como contactada: alguien la trabajó. Este sí se levanta desde la
  -- propia pantalla («Marcar como nueva») si de verdad era una prueba.
  if v_estado = 'contactado' then
    return 'contactado';
  end if;

  delete from diagnosticos where id = p_id;
  return 'ok';
end;
$$;

comment on function eliminar_lead(bigint) is
  'Borra una solicitud de diagnóstico si nadie la ha trabajado. Devuelve ok | no_existe | presupuesto | pidio_contacto | contactado.';
