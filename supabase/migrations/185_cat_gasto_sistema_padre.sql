-- 185 · Clasificador de cuentas por defecto · F1.1 — `cat_gasto_sistema` aprende padre
--
-- Va SOLA y PRIMERO, antes de escribir una línea de semilla: es el cuello de
-- botella del clasificador. Se llama desde TypeScript (`gastos-core.ts`) y desde
-- DENTRO de `inv_confirmar_compra` (mig. 155) y `srv_cxp_generar` (mig. 152). Si
-- queda mal, la semilla amplifica el fallo en cada cliente.
--
-- Tres problemas distintos se resuelven todos enseñándole padre:
--
--   1. Hoy solo resuelve y crea a NIVEL RAÍZ (`and parent_id is null`). Con el
--      pack, «Salarios» es una HIJA de «Personal»: la RPC no la encontraría y
--      crearía una raíz duplicada al lado.
--   2. La semilla siembra sin `es_sistema`, así que el dueño puede renombrar lo
--      sembrado. La rama por nombre dejaría de encontrarlo y crearía un duplicado.
--      Lo arregla resolver por `clave_catalogo` ANTES que por nombre.
--   3. Las raíces G1 «Compras» y G2 «Servicios de terceros» las resuelve esta
--      función, no la semilla (si no, cada cliente tendría dos raíces COSTE_VENTAS).
--      Por eso siguen llamándose sin padre, y eso tiene que seguir funcionando.
--
-- ── El pack NO vive aquí ─────────────────────────────────────────────────────
-- El catálogo es código (F1.2), no una tabla. Esta función no sabe cómo se llama
-- la raíz «Personal» ni qué rol tiene: se lo pasa quien la llama. Así el pack se
-- edita en un sitio y esta función no se vuelve a tocar cuando cambie.
--
-- ── Compatibilidad ───────────────────────────────────────────────────────────
-- Los tres parámetros nuevos son opcionales. Sin ellos el comportamiento es el de
-- la mig. 166 salvo en dos puntos deliberados, marcados abajo: la rama por nombre
-- ya no se limita al nivel raíz, y adoptar una categoría archivada la reactiva.

-- ── Auxiliares ───────────────────────────────────────────────────────────────

-- Adoptar = marcar una categoría que ya existía como el sitio donde escribe un
-- módulo. Es IRREVERSIBLE (`es_sistema` no se deshace desde la interfaz), así que
-- está en un solo sitio y hace exactamente cuatro cosas.
create or replace function public.cat_adoptar(
  p_categoria_id text, p_clave text, p_rol text
) returns void
language plpgsql
as $$
begin
  update public.categorias_gastos
     set clave_sistema = p_clave,
         es_sistema    = true,
         -- No pisa el rol si el dueño ya lo cambió: solo rellena el default.
         rol_pl        = case when rol_pl = 'OPERATIVO' then p_rol else rol_pl end,
         -- Si estaba archivada, vuelve. Un módulo a punto de escribir en una
         -- categoría invisible es peor que reactivarla: el gasto entraría en una
         -- fila que el dueño no ve en su pantalla.
         estado        = 'ACTIVO',
         updated_at    = now()
   where categoria_id = p_categoria_id;
end;
$$;

comment on function public.cat_adoptar(text, text, text) is
  'Marca una categoría existente como sitio de escritura de un módulo: fija clave_sistema, es_sistema, rellena el rol si seguía en el default y la reactiva si estaba archivada. Irreversible desde la interfaz.';

-- Crear la raíz del pack cuando el cliente todavía no la tiene. Nace SIN
-- `es_sistema`: es una fila del catálogo, no un sitio donde escriba un módulo —
-- el dueño puede renombrarla, archivarla y borrarla mientras esté vacía.
create or replace function public.cat_crear_raiz_catalogo(
  p_client_id text, p_clave_catalogo text, p_nombre text, p_rol text
) returns text
language plpgsql
as $$
declare v_id text;
begin
  v_id := 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  begin
    insert into public.categorias_gastos
      (categoria_id, client_id, nombre, parent_id, clave_catalogo, rol_pl, updated_at)
    values
      (v_id, p_client_id, p_nombre, null, p_clave_catalogo, p_rol, now());
  exception when unique_violation then
    -- Ya existe por clave (carrera) o por nombre (el dueño tenía una raíz que se
    -- llama igual, o la tenía archivada — el índice de nombre no mira `estado`).
    -- En ese caso se le pone la clave de catálogo encima: es su raíz, y ahora
    -- además es el ancla del pack. NO se le toca el rol: eso es del §12.2.
    v_id := null;
    select categoria_id into v_id
      from public.categorias_gastos
     where client_id = p_client_id and clave_catalogo = p_clave_catalogo
     limit 1;
    if v_id is null then
      select categoria_id into v_id
        from public.categorias_gastos
       where client_id = p_client_id and nombre = p_nombre and parent_id is null
         -- Si ya es el ancla de OTRA entrada del pack, no se le roba la clave.
         and clave_catalogo is null
       limit 1;
      if v_id is null then raise; end if;
      update public.categorias_gastos
         set clave_catalogo = p_clave_catalogo, estado = 'ACTIVO', updated_at = now()
       where categoria_id = v_id;
    end if;
  end;
  return v_id;
end;
$$;

comment on function public.cat_crear_raiz_catalogo(text, text, text, text) is
  'Crea la raíz del pack para un cliente, o adopta la que ya tuviera con ese nombre poniéndole la clave de catálogo. Nace sin es_sistema: es catálogo, no sitio de escritura.';

-- ── La función principal ─────────────────────────────────────────────────────
--
-- Hay que DROP + CREATE, no `create or replace`: cambiar el número de parámetros
-- crea una segunda función y las llamadas de 3 argumentos quedarían ambiguas.
-- Los cuerpos plpgsql no son dependencias, así que `inv_confirmar_compra` y
-- `srv_cxp_generar` siguen resolviéndola en ejecución sin recrearlas.

drop function if exists public.cat_gasto_sistema(text, text, text);

create or replace function public.cat_gasto_sistema(
  p_client_id   text,
  p_clave       text,
  p_nombre      text,
  -- Dónde cuelga esto en el catálogo. Null = raíz (G1, G2 y los llamadores viejos).
  p_clave_padre text default null,
  -- Solo se usan si hay que CREAR la raíz porque el cliente aún no la tiene.
  p_nombre_padre text default null,
  p_rol_padre    text default null
) returns text
language plpgsql
as $$
declare
  v_id       text;
  v_padre_id text;
  v_rol      text;
  v_nombre   text;
  v_intento  int;
begin
  -- El rol lo fija la clave, no el llamador: así la categoría nace igual venga de
  -- TypeScript o de dentro de otra función Postgres (mig. 139). En una fila HIJA
  -- el rol no se lee —el cálculo sube al padre (mig. 134)—, así que escribirlo es
  -- inocuo y sirve de red por si esa fila acaba siendo raíz.
  -- `retenciones_nomina` sale del case: nadie la escribe desde la mig. 166 y su
  -- fila vestigial se retiró en la 184.
  v_rol := case p_clave
             when 'compras'                 then 'COSTE_VENTAS'
             when 'servicios_terceros'      then 'COSTE_VENTAS'
             when 'salarios'                then 'PERSONAL'
             when 'impuestos_salario'       then 'PERSONAL'
             when 'contribucion_ss_empresa' then 'PERSONAL'
             when 'vacaciones_acumuladas'   then 'PERSONAL'
             when 'comisiones_bancarias'    then 'OTRO'
             else 'OPERATIVO'
           end;

  -- ── (a) Por `clave_sistema` — sobrevive a todo ─────────────────────────────
  select categoria_id into v_id
    from public.categorias_gastos
   where client_id = p_client_id and clave_sistema = p_clave
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- La raíz del pack, si el llamador dijo cuál. Se resuelve ANTES de buscar por
  -- nombre porque desempata: entre dos categorías que se llaman igual, gana la
  -- que ya cuelga de la raíz correcta.
  if p_clave_padre is not null then
    select categoria_id into v_padre_id
      from public.categorias_gastos
     where client_id = p_client_id and clave_catalogo = p_clave_padre
     limit 1;
  end if;

  -- ── (b') Por `clave_catalogo` — sobrevive al renombrado ────────────────────
  -- La rama que hace falta porque la semilla siembra sin `es_sistema`: el dueño
  -- renombra «Salarios» a «Sueldos» y sigue siendo la misma entrada del catálogo.
  --
  -- El `clave_sistema is null` de esta rama y de las siguientes es la regla dura
  -- de todas ellas: adoptar una fila que ya es el sitio de escritura de OTRO
  -- módulo le borraría su clave, y ese módulo se pondría a crear duplicados en su
  -- siguiente escritura. Una categoría es de un módulo o de ninguno.
  select categoria_id into v_id
    from public.categorias_gastos
   where client_id = p_client_id and clave_catalogo = p_clave
     and clave_sistema is null
   limit 1;

  -- ── (b) Por nombre — no sobrevive a nada, pero adopta lo hecho a mano ──────
  -- CAMBIO: antes solo miraba `parent_id is null`. Ahora mira a cualquier nivel,
  -- en orden de confianza, para no crear un duplicado al lado de lo que el dueño
  -- ya tiene. El orden importa cuando un cliente tiene el mismo nombre dos veces
  -- (existe: CLI-0014 tiene una raíz «Salarios» y una hija «Salarios»).
  if v_id is null and v_padre_id is not null then
    select categoria_id into v_id
      from public.categorias_gastos
     where client_id = p_client_id and nombre = p_nombre and parent_id = v_padre_id
       and clave_sistema is null
     limit 1;
  end if;
  if v_id is null then
    -- Nivel raíz: es lo que hacía la mig. 166, se conserva como segunda opción.
    select categoria_id into v_id
      from public.categorias_gastos
     where client_id = p_client_id and nombre = p_nombre and parent_id is null
       and clave_sistema is null
     limit 1;
  end if;
  if v_id is null then
    select categoria_id into v_id
      from public.categorias_gastos
     where client_id = p_client_id and nombre = p_nombre
       and clave_sistema is null
     order by created_at
     limit 1;
  end if;

  if v_id is not null then
    perform public.cat_adoptar(v_id, p_clave, v_rol);
    return v_id;
  end if;

  -- ── (c) Crear ──────────────────────────────────────────────────────────────
  -- Si hay padre declarado y el cliente no lo tiene, se crea la raíz. Sin nombre
  -- de raíz no se puede: en ese caso se cae al nivel raíz, que es el
  -- comportamiento de siempre. Degradar a lo que ya funcionaba es preferible a
  -- abortar la nómina o la compra que disparó la llamada.
  if v_padre_id is null and p_clave_padre is not null and p_nombre_padre is not null then
    v_padre_id := public.cat_crear_raiz_catalogo(
      p_client_id, p_clave_padre, p_nombre_padre, coalesce(p_rol_padre, v_rol));
  end if;

  -- El alta puede chocar con el índice único de nombre
  -- `(client_id, coalesce(parent_id,''), nombre)`, que NO mira `estado`. Tres
  -- causas distintas, y cada una tiene su salida:
  --
  --   · Carrera            → alguien la creó ya: se devuelve la suya.
  --   · Fila adoptable     → existe con ese nombre y sin dueño (incluida una
  --                          ARCHIVADA, invisible desde la interfaz): se adopta.
  --   · Nombre ocupado por
  --     OTRO módulo        → no se le roba la clave. Se crea con el nombre
  --                          sufijado. Un nombre feo es visible y el dueño lo
  --                          arregla en un toque; robarle la clave a otro módulo
  --                          es invisible y lo pone a duplicar para siempre.
  --                          Y sobre todo: esto NO puede abortar la nómina o la
  --                          compra que disparó la llamada.
  for v_intento in 1..5 loop
    v_nombre := case when v_intento = 1 then p_nombre
                     else p_nombre || ' ' || v_intento end;
    v_id := 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.categorias_gastos
        (categoria_id, client_id, nombre, parent_id, clave_sistema, es_sistema, rol_pl, updated_at)
      values
        (v_id, p_client_id, v_nombre, v_padre_id, p_clave, true, v_rol, now());
      return v_id;
    exception when unique_violation then
      v_id := null;
      select categoria_id into v_id
        from public.categorias_gastos
       where client_id = p_client_id and clave_sistema = p_clave
       limit 1;
      if v_id is not null then
        return v_id;
      end if;
      select categoria_id into v_id
        from public.categorias_gastos
       where client_id = p_client_id and nombre = v_nombre
         and coalesce(parent_id, '') = coalesce(v_padre_id, '')
         and clave_sistema is null
       limit 1;
      if v_id is not null then
        perform public.cat_adoptar(v_id, p_clave, v_rol);
        return v_id;
      end if;
      -- El nombre lo tiene otro módulo: se prueba con el siguiente.
    end;
  end loop;

  -- Cinco nombres ocupados seguidos no es un choque, es otra cosa: se propaga.
  raise exception 'cat_gasto_sistema: no se pudo crear «%» para % (clave %)',
    p_nombre, p_client_id, p_clave;
end;
$$;

comment on function public.cat_gasto_sistema(text, text, text, text, text, text) is
  'Resuelve —creándola si hace falta— la categoría donde escribe un módulo. Orden: clave_sistema → clave_catalogo → nombre (bajo el padre, en raíz, a cualquier nivel) → crear. Nunca adopta una fila que ya sea de otro módulo. p_clave_padre es la clave de catálogo de la raíz del pack; sin ella se comporta como antes de la mig. 185 y crea a nivel raíz.';
