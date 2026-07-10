-- Política de lectura pública para el bucket de fotos del catálogo/menú digital.
-- El bucket se crea como public=true en 077_catalogo.sql, pero sin esta política
-- Storage RLS bloquea el acceso en producción. Necesita ser as permissive + to public
-- para que funcione con usuarios anónimos (menú QR público).
drop policy if exists "catalogo_public_read" on storage.objects;
create policy "catalogo_public_read"
on storage.objects
as permissive
for select
to public
using (bucket_id = 'catalogo');
