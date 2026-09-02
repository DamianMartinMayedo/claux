-- ================================================================
-- MIGRACIÓN 228: borrar una ampliación, con candado
--
-- Hermana de la 227 (`eliminar_lead`). Las ampliaciones son filas de
-- `soporte_mensajes` con `modulo_clave` — «me interesa X» pulsado
-- desde el portal de un cliente— y hasta ahora no se podían borrar:
-- solo cambiarles el estado. Resultado en producción: de las cinco
-- que hay, tres son del cliente `Restaurante test` y llevan desde
-- julio inflando el contador de «sin contactar» de la pantalla de
-- Ventas, que es justo el número que decide a quién se llama.
--
-- Aquí el «es de prueba» NO se adivina con una heurística como en los
-- leads: `clients.es_prueba` ya existe y es la bandera que el propio
-- panel usa para dejar a esos clientes fuera de las estadísticas. Si
-- el cliente es real, su petición no se borra — aunque sea vieja,
-- aunque ya esté activada: es la prueba de que pidió algo.
--
-- Dos candados, y cada uno se gana el sitio:
--   · el cliente tiene que ser de prueba (`es_prueba`). El caso «no
--     existe» devuelve `sin_cliente` y no se puede dar —la FK a
--     `clients` es `on delete cascade`, así que la fila se va con el
--     cliente—, pero se comprueba igual: la lección de la 227 es no
--     deducir «se puede borrar» de la ausencia de un vínculo.
--   · sin respuesta escrita. Si alguien contestó, hay una conversación
--     dentro y borrarla la pierde.
-- El estado (`RESUELTO`) no bloquea: en un cliente de prueba, una
-- ampliación activada es exactamente una fila de prueba terminada.
--
-- El `for update` cierra la carrera con `actualizarEstadoAmpliacion` y
-- con `responderMensajeSoporte`, que tocan esta misma fila.
-- ================================================================

create or replace function eliminar_ampliacion(p_id bigint)
returns text
language plpgsql
as $$
declare
  v_client    text;
  v_modulo    text;
  v_respuesta text;
  v_es_prueba boolean;
begin
  select client_id, modulo_clave, respuesta
    into v_client, v_modulo, v_respuesta
    from soporte_mensajes
   where id = p_id
     for update;
  if not found then
    return 'no_existe';
  end if;

  -- Un mensaje de soporte sin `modulo_clave` no es una ampliación: se atiende en
  -- /admin/soporte y tiene su propio flujo. Desde Ventas no se toca.
  if v_modulo is null then
    return 'no_es_ampliacion';
  end if;

  select es_prueba into v_es_prueba
    from clients where client_id = v_client;
  if not found then
    return 'sin_cliente';
  end if;
  if not coalesce(v_es_prueba, false) then
    return 'cliente_real';
  end if;

  if v_respuesta is not null then
    return 'respondida';
  end if;

  delete from soporte_mensajes where id = p_id;
  return 'ok';
end;
$$;

comment on function eliminar_ampliacion(bigint) is
  'Borra una ampliación (soporte_mensajes con modulo_clave) solo si es de un cliente de prueba y nadie la ha respondido. Devuelve ok | no_existe | no_es_ampliacion | sin_cliente | cliente_real | respondida.';
