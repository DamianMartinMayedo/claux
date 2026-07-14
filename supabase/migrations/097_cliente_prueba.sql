-- ================================================================
-- MIGRACIÓN 097: Cliente de prueba (no cuenta en estadísticas)
--
-- Flag ortogonal al estado (ACTIVO/TRIAL/…): un cliente de prueba funciona
-- igual que uno real (portal, módulos, pagos), pero queda EXCLUIDO de las
-- métricas de CLAUX como empresa (dashboard, MRR, ingresos, avisos por cron)
-- para no falsear las estadísticas reales.
-- ================================================================

alter table clients add column if not exists es_prueba boolean not null default false;

-- El primer cliente de prueba es "Negocio Test" (CLI-0003).
update clients set es_prueba = true where client_id = 'CLI-0003';
