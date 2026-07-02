-- Actualiza el color de identidad de las empresas ya creadas a la paleta moderna
-- (ver COLORES_EMPRESA en src/app/actions/portal/empresas.ts). Mapeo por familia
-- de tono: cada empresa conserva su color aproximado, solo modernizado.
-- #00AFAA (teal de marca) no cambia. Idempotente: re-ejecutar no afecta nada.
update empresas
set color = case color
  when '#C97A0C' then '#EA580C'  -- ámbar apagado → naranja
  when '#2E7D32' then '#16A34A'  -- verde oscuro  → verde
  when '#1565C0' then '#2563EB'  -- azul oscuro   → azul
  when '#6A1B9A' then '#7C3AED'  -- morado oscuro → violeta
  when '#AD1457' then '#E11D48'  -- rosa profundo → rosa
  when '#00838F' then '#C026D3'  -- cian          → fucsia
  when '#4E342E' then '#64748B'  -- marrón        → pizarra
  else color
end,
updated_at = now()
where color in ('#C97A0C','#2E7D32','#1565C0','#6A1B9A','#AD1457','#00838F','#4E342E');
