alter table empresas
  add column if not exists mostrar_logo boolean not null default true;
notify pgrst, 'reload schema';
