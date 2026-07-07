-- Fix: admin pages couldn't read modulos_catalogo in production
-- RLS was enabled but no SELECT policy existed. The catalog is shared data
-- (no tenant-specific rows), so public read access is safe.
create policy "anyone_can_read_catalogo" on public.modulos_catalogo
  for select using (true);
