-- 186 · Clasificador de cuentas por defecto · F1.3 — la semilla
--
-- Una sola función porque una semilla tiene que ser ATÓMICA: sembrar las
-- categorías y anotar en `clients.claves_sembradas` lo que se sembró son el mismo
-- hecho. Desde supabase-js serían dos llamadas, y entre las dos cabe un fallo de
-- red que dejaría al cliente con categorías que el sistema cree no haber sembrado
-- — y a la siguiente pasada las volvería a intentar.
--
-- `p_ensayo` es el ensayo previo obligatorio (§12.1 b del clasificador). Devuelve
-- exactamente lo mismo que la pasada real pero sin escribir nada: «se crearán 24 ·
-- 3 no se cargan porque ya las tenías». Una semilla no se deshace sola.
--
-- El pack NO vive aquí. Las filas llegan en `p_filas` desde `src/lib/catalogo/`,
-- por la misma razón que la mig. 185: `conceptos_pl` se deriva de la definición
-- global del pack y un cliente sin el módulo no tiene filas que leer.

-- La respuesta a la pregunta que desambigua el sector `servicios` (§9.3): «¿piezas
-- y materiales, o solo tu tiempo?». Se guarda para poder RE-preguntarla: es la
-- ruta de 4 de 6 clientes reales y equivocarse en ella sin marcha atrás es un
-- problema de adopción, no el fallo de una pantalla.
alter table public.clients
  add column if not exists pack_servicios text;

comment on column public.clients.pack_servicios is
  'Respuesta del cliente a la pregunta que desambigua el sector «servicios»: materiales → pack S4 (talleres), conocimiento → pack S11 (profesionales). Re-preguntable desde la pantalla de Categorías.';

create or replace function public.cat_sembrar_pack(
  p_client_id text,
  p_filas     jsonb,           -- [{clave,nombre,padre,rol,descripcion}, …] raíces primero
  p_ensayo    boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila         jsonb;
  v_clave        text;
  v_nombre       text;
  v_padre        text;
  v_rol          text;
  v_desc         text;
  v_id           text;
  v_padre_id     text;
  v_sembradas    jsonb;
  v_creadas      jsonb := '[]'::jsonb;
  v_ya           jsonb := '[]'::jsonb;   -- ya la tiene con esa clave_catalogo
  v_ocupadas     jsonb := '[]'::jsonb;   -- el nombre ya es suyo (activa o archivada)
  v_retiradas    jsonb := '[]'::jsonb;   -- se sembró y el dueño la borró: no vuelve
  v_ancladas     jsonb := '[]'::jsonb;   -- raíz suya que pasa a ser ancla del pack
  -- Mapa clave_catalogo → categoria_id resuelto en esta pasada, para que las hijas
  -- encuentren a su madre aunque la madre ya existiera o se acabe de crear.
  v_ids          jsonb := '{}'::jsonb;
begin
  if p_client_id is null or p_filas is null then
    raise exception 'cat_sembrar_pack: faltan argumentos';
  end if;

  select coalesce(claves_sembradas, '[]'::jsonb) into v_sembradas
  from public.clients where client_id = p_client_id
  for update;

  if not found then
    raise exception 'cat_sembrar_pack: el cliente % no existe', p_client_id;
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas)
  loop
    v_clave  := v_fila->>'clave';
    v_nombre := v_fila->>'nombre';
    v_padre  := nullif(v_fila->>'padre', '');
    v_rol    := coalesce(v_fila->>'rol', 'OPERATIVO');
    v_desc   := nullif(v_fila->>'descripcion', '');
    v_id     := null;

    -- (1) ¿Ya la tiene? Por `clave_catalogo` (resiembra, o segunda pasada tras un
    -- fallo a medias) O por `clave_sistema`.
    --
    -- 🔴 Las dos se miran porque para estas entradas VALEN LO MISMO (invariante de
    -- `src/lib/catalogo/catalogo.ts`). El caso real: un cliente confirma su primera
    -- nómina antes de sembrar, y `cat_gasto_sistema` le crea «Salarios» con
    -- `clave_sistema` pero sin `clave_catalogo`. Mirando solo la de catálogo, la
    -- semilla no la vería, tampoco encontraría el nombre —el módulo usa el suyo
    -- histórico, «Compras», no «Compras y mercancía»— y le crearía una SEGUNDA
    -- raíz de coste de ventas. El informe le saldría partido en dos.
    select categoria_id into v_id
    from public.categorias_gastos
    where client_id = p_client_id
      and (clave_catalogo = v_clave or clave_sistema = v_clave)
    order by (clave_catalogo = v_clave) desc
    limit 1;

    if v_id is not null then
      -- Se le pone la clave de catálogo si le faltaba: a partir de ahora las dos
      -- identidades apuntan a la misma fila y no hay forma de duplicarla.
      if not p_ensayo then
        update public.categorias_gastos
           set clave_catalogo = v_clave, updated_at = now()
         where categoria_id = v_id and clave_catalogo is null;
      end if;
      v_ya  := v_ya  || to_jsonb(v_nombre);
      v_ids := v_ids || jsonb_build_object(v_clave, v_id);
      continue;
    end if;

    -- (2) ¿Se sembró antes y el dueño la borró? No se resucita. Distinguir «nunca
    -- sembrada» de «sembrada y retirada» es justo para lo que existe la columna:
    -- devolverle cada mes una categoría que él quitó a propósito destruye la
    -- confianza en su propia pantalla.
    if v_sembradas ? v_clave then
      v_retiradas := v_retiradas || to_jsonb(v_nombre);
      continue;
    end if;

    -- El padre, ya resuelto en esta misma pasada (las raíces van primero).
    v_padre_id := case when v_padre is null then null else v_ids->>v_padre end;
    -- Si la madre no se pudo resolver, la hija se queda fuera. Colgarla de la raíz
    -- la pondría en un renglón que no es el suyo, y eso no se ve.
    if v_padre is not null and v_padre_id is null then
      continue;
    end if;

    -- (3) ¿El nombre ya es suyo, en ese mismo nivel? Cuenta también las
    -- ARCHIVADAS: el índice único `(client_id, coalesce(parent_id,''), nombre)` no
    -- mira el estado, así que insertar daría 23505 sin salida desde la interfaz.
    select categoria_id into v_id
    from public.categorias_gastos
    where client_id = p_client_id
      and lower(trim(nombre)) = lower(trim(v_nombre))
      and coalesce(parent_id, '') = coalesce(v_padre_id, '');

    if v_id is not null then
      -- Una RAÍZ suya con ese nombre se vuelve el ancla del pack: gana la
      -- `clave_catalogo` y nada más — ni el rol, ni el nombre, ni el estado. Es la
      -- variante C′ (§1.12 del plan): el árbol del cliente no se toca.
      --
      -- Una HIJA no se ancla aquí. Emparejar «Luz» con «Electricidad» es trabajo
      -- del asistente de adopción, que lo PROPONE y deja decidir; hacerlo solo
      -- sería un cambio invisible y permanente en su informe.
      if v_padre_id is null then
        if not p_ensayo then
          update public.categorias_gastos
             set clave_catalogo = v_clave, updated_at = now()
           where categoria_id = v_id;
        end if;
        v_ancladas := v_ancladas || to_jsonb(v_nombre);
        v_ids      := v_ids || jsonb_build_object(v_clave, v_id);
      else
        v_ocupadas := v_ocupadas || to_jsonb(v_nombre);
      end if;
      continue;
    end if;

    -- (4) Se crea. `es_sistema` NO se pone ni cuando la entrada tiene clave de
    -- sistema: la fila nace renombrable y archivable, y solo deja de serlo el día
    -- que un módulo la reclama por `cat_gasto_sistema` — que la encuentra por su
    -- `clave_catalogo`.
    -- Mismo formato que `generarCategoriaGastoId()` y que la mig. 185.
    v_id := 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    if not p_ensayo then
      insert into public.categorias_gastos (
        categoria_id, client_id, nombre, descripcion, parent_id,
        rol_pl, estado, es_sistema, clave_catalogo, updated_at
      ) values (
        v_id, p_client_id, v_nombre, v_desc, v_padre_id,
        -- El rol vive en la RAÍZ: el estado de resultados sube al padre y el de la
        -- hija no lo lee nadie (mig. 134). Se escribe el de su raíz para que la
        -- columna no diga una cosa distinta de la que se calcula.
        v_rol, 'ACTIVO', false, v_clave, now()
      )
      on conflict (client_id, clave_catalogo) where clave_catalogo is not null
      do nothing;
    end if;

    v_creadas := v_creadas || to_jsonb(v_nombre);
    v_ids     := v_ids || jsonb_build_object(v_clave, v_id);
  end loop;

  -- Se anota lo que el cliente TIENE del pack —creado, anclado o ya existente—,
  -- que es justo lo que `v_ids` acumula. Lo que no llegó a sembrarse (una hija
  -- cuyo nombre ya era suyo) NO se anota: si mañana él renombra la suya, la
  -- semilla debe poder darle la del pack. Anotarla ahora la dejaría fuera para
  -- siempre por algo que nunca ocurrió.
  if not p_ensayo then
    update public.clients
       set claves_sembradas = (
             select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
             from (
               select jsonb_array_elements(v_sembradas) as v
               union
               select to_jsonb(k) from jsonb_object_keys(v_ids) k
             ) t
           )
     where client_id = p_client_id;
  end if;

  return jsonb_build_object(
    'ensayo',    p_ensayo,
    'creadas',   v_creadas,
    'ancladas',  v_ancladas,
    'ya_tenia',  v_ya,
    'ocupadas',  v_ocupadas,
    'retiradas', v_retiradas
  );
end $$;

comment on function public.cat_sembrar_pack(text, jsonb, boolean) is
  'Siembra el pack de categorías por defecto de un cliente. Atómica: las categorías y clients.claves_sembradas se escriben juntas. Con p_ensayo=true no escribe nada y devuelve el mismo resumen (ensayo previo obligatorio). Nunca escribe clave_sistema, nunca resucita lo que el dueño borró, y nunca empareja hijas por nombre — eso lo propone el asistente de adopción.';

revoke all on function public.cat_sembrar_pack(text, jsonb, boolean) from public, anon, authenticated;
