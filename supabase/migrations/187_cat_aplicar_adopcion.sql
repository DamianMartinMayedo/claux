-- ── F1.4 · Aplicar la adopción del catálogo, de una pieza ────────────────────
--
-- El asistente de adopción propone y el dueño marca; esto es lo que EJECUTA lo
-- marcado. Va en una RPC y no en TypeScript por dos razones:
--
--  1. Es una operación con varias escrituras que solo tienen sentido juntas —
--     fundir dos categorías mueve hijas, reasigna apuntes y borra la vieja. A
--     medio hacer deja el árbol peor que antes de empezar.
--  2. El ENSAYO tiene que ser el MISMO camino que la pasada real. Un ensayo que
--     solo valida (y no escribe) miente el día que la escritura falla por algo
--     que la validación no miraba. Aquí se escribe siempre y, si es ensayo, se
--     deshace: lo que informa es exactamente lo que iba a pasar.
--
-- Operaciones (`p_ops`, array json, se aplican EN ORDEN):
--   {tipo:'reactivar', id}            una archivada vuelve
--   {tipo:'anclar',    id, clave}     esta categoría suya ES la entrada <clave> del pack
--   {tipo:'mover',     id, padre}     una subcategoría cambia de raíz
--   {tipo:'fundir',    id, en}        `id` se absorbe en `en` (apuntes incluidos) y desaparece
--   {tipo:'rol',       id, rol}       cambia el papel de una raíz en el informe
--
-- Nada se aplica en cascada ni «de paso»: lo que no venga en `p_ops` no se toca.

create or replace function cat_aplicar_adopcion(
  p_client_id text,
  p_ops       jsonb,
  p_ensayo    boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op       jsonb;
  v_tipo     text;
  v_id       text;
  v_cat      categorias_gastos%rowtype;
  v_dst      categorias_gastos%rowtype;
  v_n        int;
  v_hijas    int := 0;
  v_apuntes  int := 0;
  v_movs     int := 0;
  v_hechas   jsonb := '[]'::jsonb;
  v_omitidas jsonb := '[]'::jsonb;
begin
  -- Una propuesta que ya no encaja —el dueño tocó el árbol en otra pestaña— se
  -- anota en `omitidas` y el bucle sigue: no puede tirar las quince que sí encajan.
  if p_client_id is null or p_client_id = '' then
    raise exception 'cat_aplicar_adopcion: falta client_id';
  end if;

  -- Serializa contra otra adopción o contra la semilla corriendo a la vez.
  perform 1 from clients where client_id = p_client_id for update;

  begin
    for v_op in select value from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
      v_tipo := v_op->>'tipo';
      v_id   := v_op->>'id';

      select * into v_cat from categorias_gastos
       where client_id = p_client_id and categoria_id = v_id;

      if not found then
        v_omitidas := v_omitidas || jsonb_build_object(
          'id', v_id, 'tipo', v_tipo, 'motivo', 'no_existe');
        continue;
      end if;

      -- ── Reactivar ───────────────────────────────────────────────────────────
      if v_tipo = 'reactivar' then
        update categorias_gastos set estado = 'ACTIVO', updated_at = now()
         where client_id = p_client_id and categoria_id = v_id;
        v_hechas := v_hechas || jsonb_build_object('id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre);

      -- ── Anclar a una entrada del pack ───────────────────────────────────────
      elsif v_tipo = 'anclar' then
        -- La clave del catálogo es de UNA fila por cliente: si ya la tiene otra,
        -- anclar aquí dejaría dos filas diciendo ser la misma entrada.
        select count(*) into v_n from categorias_gastos
         where client_id = p_client_id
           and clave_catalogo = (v_op->>'clave')
           and categoria_id <> v_id;
        if v_n > 0 then
          v_omitidas := v_omitidas || jsonb_build_object(
            'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre, 'motivo', 'clave_ocupada');
        else
          update categorias_gastos
             set clave_catalogo = (v_op->>'clave'), updated_at = now()
           where client_id = p_client_id and categoria_id = v_id;
          v_hechas := v_hechas || jsonb_build_object(
            'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre, 'clave', v_op->>'clave');
        end if;

      -- ── Cambiar el papel en el informe ──────────────────────────────────────
      elsif v_tipo = 'rol' then
        -- En una subcategoría el rol no se lee (mig. 134): escribirlo daría la
        -- falsa impresión de haber cambiado algo.
        if v_cat.parent_id is not null then
          v_omitidas := v_omitidas || jsonb_build_object(
            'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre, 'motivo', 'es_subcategoria');
        else
          update categorias_gastos set rol_pl = (v_op->>'rol'), updated_at = now()
           where client_id = p_client_id and categoria_id = v_id;
          v_hechas := v_hechas || jsonb_build_object(
            'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre,
            'rol_antes', v_cat.rol_pl, 'rol', v_op->>'rol');
        end if;

      -- ── Mover una subcategoría a otra raíz ──────────────────────────────────
      elsif v_tipo = 'mover' then
        select * into v_dst from categorias_gastos
         where client_id = p_client_id and categoria_id = (v_op->>'padre');

        if not found then
          v_omitidas := v_omitidas || jsonb_build_object(
            'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre, 'motivo', 'destino_no_existe');
        elsif v_dst.parent_id is not null then
          -- El árbol es de dos niveles duros: una nieta no la sabe leer el informe.
          v_omitidas := v_omitidas || jsonb_build_object(
            'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre, 'motivo', 'destino_no_es_raiz');
        else
          select count(*) into v_n from categorias_gastos
           where client_id = p_client_id and parent_id = v_id;
          if v_n > 0 then
            v_omitidas := v_omitidas || jsonb_build_object(
              'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre, 'motivo', 'tiene_hijas');
          else
            -- El índice único NO mira el estado: una archivada con ese nombre en
            -- el destino bloquea igual, y el 23505 tiraría la sesión entera.
            select count(*) into v_n from categorias_gastos
             where client_id = p_client_id and parent_id = (v_op->>'padre')
               and nombre = v_cat.nombre and categoria_id <> v_id;
            if v_n > 0 then
              v_omitidas := v_omitidas || jsonb_build_object(
                'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre,
                'motivo', 'nombre_ocupado', 'destino', v_dst.nombre);
            else
              update categorias_gastos
                 set parent_id = (v_op->>'padre'), updated_at = now()
               where client_id = p_client_id and categoria_id = v_id;
              v_hechas := v_hechas || jsonb_build_object(
                'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre,
                'destino', v_dst.nombre, 'rol_destino', v_dst.rol_pl);
            end if;
          end if;
        end if;

      -- ── Fundir dos categorías del cliente en una ────────────────────────────
      elsif v_tipo = 'fundir' then
        select * into v_dst from categorias_gastos
         where client_id = p_client_id and categoria_id = (v_op->>'en');

        if not found then
          v_omitidas := v_omitidas || jsonb_build_object(
            'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre, 'motivo', 'destino_no_existe');
        elsif v_cat.es_sistema then
          -- La escribe un módulo por `clave_sistema`: si desapareciera, el
          -- siguiente gasto automático la volvería a crear.
          v_omitidas := v_omitidas || jsonb_build_object(
            'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre, 'motivo', 'es_de_sistema');
        elsif (v_cat.parent_id is null) <> (v_dst.parent_id is null) then
          v_omitidas := v_omitidas || jsonb_build_object(
            'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre, 'motivo', 'niveles_distintos');
        else
          -- Las hijas de la absorbida pasan a la que queda, salvo que allí ya
          -- exista ese nombre: esa se queda donde está y se dice.
          v_hijas := 0;
          update categorias_gastos h
             set parent_id = v_dst.categoria_id, updated_at = now()
           where h.client_id = p_client_id and h.parent_id = v_id
             and not exists (
               select 1 from categorias_gastos o
                where o.client_id = p_client_id and o.parent_id = v_dst.categoria_id
                  and o.nombre = h.nombre);
          get diagnostics v_hijas = row_count;

          select count(*) into v_n from categorias_gastos
           where client_id = p_client_id and parent_id = v_id;

          -- Los apuntes se llevan también el nombre: `gastos_cobros.categoria`
          -- es texto congelado y dejarlo diciendo el nombre viejo convierte el
          -- histórico en dos cuentas otra vez, esta vez sin arreglo posible.
          update gastos_cobros
             set categoria_id = v_dst.categoria_id, categoria = v_dst.nombre
           where client_id = p_client_id and categoria_id = v_id;
          get diagnostics v_apuntes = row_count;

          update movimientos_tesoreria
             set categoria_id = v_dst.categoria_id
           where client_id = p_client_id and categoria_id = v_id;
          get diagnostics v_movs = row_count;

          if v_n > 0 then
            -- Le quedan hijas que no cabían por nombre: borrarla se las llevaría
            -- por delante en cascada.
            v_omitidas := v_omitidas || jsonb_build_object(
              'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre,
              'motivo', 'hijas_con_nombre_ocupado', 'hijas', v_n);
          else
            delete from categorias_gastos
             where client_id = p_client_id and categoria_id = v_id;
            v_hechas := v_hechas || jsonb_build_object(
              'id', v_id, 'tipo', v_tipo, 'nombre', v_cat.nombre,
              'destino', v_dst.nombre, 'hijas', v_hijas,
              'apuntes', v_apuntes + v_movs);
          end if;
        end if;

      else
        v_omitidas := v_omitidas || jsonb_build_object(
          'id', v_id, 'tipo', coalesce(v_tipo, '?'), 'motivo', 'tipo_desconocido');
      end if;
    end loop;

    -- El ensayo recorre EXACTAMENTE el mismo camino y se deshace aquí. Las
    -- variables de PL/pgSQL no son transaccionales, así que el informe sobrevive
    -- al rollback del bloque; las escrituras, no.
    if p_ensayo then
      raise exception 'ENSAYO_ADOPCION' using errcode = 'P0001';
    end if;

  exception when others then
    if sqlerrm <> 'ENSAYO_ADOPCION' then
      raise;
    end if;
  end;

  return jsonb_build_object(
    'ensayo',   p_ensayo,
    'hechas',   v_hechas,
    'omitidas', v_omitidas
  );
end;
$$;

comment on function cat_aplicar_adopcion(text, jsonb, boolean) is
  'F1.4 · aplica las operaciones marcadas en el asistente de adopción. p_ensayo=true recorre el mismo camino y lo deshace.';

revoke all on function cat_aplicar_adopcion(text, jsonb, boolean) from public, anon, authenticated;
