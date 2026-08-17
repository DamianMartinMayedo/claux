-- 197 · Claves de API de IA guardadas en el sistema (Supabase Vault), configurables
-- desde el admin SIN depender de variables de entorno de Vercel.
--
-- La clave NUNCA vive en ia_modelos ni viaja al navegador: se cifra en vault.secrets
-- (nombre 'ia_modelo:<id>') y ia_modelos solo guarda una pista enmascarada (key_hint,
-- p. ej. «••••1234») para que el admin sepa QUÉ modelos tienen clave, sin verla nunca.
-- El descifrado queda encerrado tras funciones SECURITY DEFINER que solo puede
-- ejecutar service_role (el servidor); anon/authenticated no pueden llamarlas.

alter table public.ia_modelos add column if not exists key_hint text;

-- Guarda (o reemplaza) la clave de un modelo. Borra y recrea el secreto para no
-- depender de vault.update_secret. Actualiza la pista enmascarada.
create or replace function public.ia_key_set(p_id text, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'ia_modelo:' || p_id;
  v_id   uuid;
begin
  if p_key is null or length(btrim(p_key)) = 0 then
    return;
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  perform vault.create_secret(btrim(p_key), v_name, 'Clave de API del modelo de IA ' || p_id);
  update public.ia_modelos
     set key_hint = '••••' || right(btrim(p_key), 4)
   where id = p_id;
end;
$$;

-- Devuelve la clave descifrada de un modelo (o null). Solo servidor.
create or replace function public.ia_key_get(p_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select decrypted_secret into v
    from vault.decrypted_secrets
   where name = 'ia_modelo:' || p_id;
  return v;
end;
$$;

-- Borra la clave de un modelo (secreto + pista).
create or replace function public.ia_key_delete(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'ia_modelo:' || p_id;
  update public.ia_modelos set key_hint = null where id = p_id;
end;
$$;

-- Candado: solo el servidor (service_role) puede tocar estas funciones.
revoke all on function public.ia_key_set(text, text) from public;
revoke all on function public.ia_key_get(text)       from public;
revoke all on function public.ia_key_delete(text)    from public;
grant execute on function public.ia_key_set(text, text) to service_role;
grant execute on function public.ia_key_get(text)       to service_role;
grant execute on function public.ia_key_delete(text)    to service_role;
