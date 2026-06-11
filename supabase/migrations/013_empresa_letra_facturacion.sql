-- ================================================================
-- MIGRACIÓN 013: Letra de facturación por empresa
--
-- Cada empresa tiene una letra única (A-Z) que la identifica en los
-- consecutivos de ofertas y facturas. Permite distinguir documentos
-- de empresas distintas a simple vista:
--   Empresa A → FA20260001, OFA20260001
--   Empresa M → FM20260001, OFM20260001
--
-- La unicidad es por client_id (cada cliente del SaaS administra sus
-- letras independientemente).
-- ================================================================

alter table empresas
  add column if not exists letra_facturacion text;

-- Único por client_id (solo cuando hay valor)
create unique index if not exists empresas_letra_unique
  on empresas (client_id, letra_facturacion)
  where letra_facturacion is not null;

-- Solo 1 letra mayúscula A-Z
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'empresas_letra_check'
  ) then
    alter table empresas
      add constraint empresas_letra_check
      check (letra_facturacion is null or letra_facturacion ~ '^[A-Z]$');
  end if;
end $$;

notify pgrst, 'reload schema';
