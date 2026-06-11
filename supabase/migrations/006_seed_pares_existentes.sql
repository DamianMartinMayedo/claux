-- 006_seed_pares_existentes.sql
-- Genera los pares canónicos para los clientes que ya tienen monedas configuradas.
-- Aplica la misma lógica de dirección y fuente que el código TypeScript.

WITH
-- Todas las combinaciones únicas (A, B) con A < B para evitar duplicados
combinaciones AS (
  SELECT
    a.client_id,
    a.codigo AS cod_a,
    b.codigo AS cod_b
  FROM monedas a
  JOIN monedas b
    ON  a.client_id = b.client_id
    AND a.codigo    < b.codigo
  WHERE a.activa = TRUE
    AND b.activa = TRUE
),

-- Determinar cuál es origen según prioridad:
-- CUP siempre es destino; después USD > EUR > GBP > CAD > MXN > MLC > alfabético
con_origen AS (
  SELECT
    client_id,
    cod_a,
    cod_b,
    CASE
      WHEN 'CUP' IN (cod_a, cod_b) THEN
        CASE WHEN cod_a = 'CUP' THEN cod_b ELSE cod_a END
      WHEN 'USD' IN (cod_a, cod_b) THEN 'USD'
      WHEN 'EUR' IN (cod_a, cod_b) THEN 'EUR'
      WHEN 'GBP' IN (cod_a, cod_b) THEN 'GBP'
      WHEN 'CAD' IN (cod_a, cod_b) THEN 'CAD'
      WHEN 'MXN' IN (cod_a, cod_b) THEN 'MXN'
      WHEN 'MLC' IN (cod_a, cod_b) THEN 'MLC'
      ELSE cod_a
    END AS origen
  FROM combinaciones
),

-- Destino es simplemente el otro código del par
pares AS (
  SELECT
    client_id,
    origen,
    CASE WHEN origen = cod_a THEN cod_b ELSE cod_a END AS destino
  FROM con_origen
)

INSERT INTO pares_tasa (client_id, origen, destino, fuente, activo)
SELECT
  client_id,
  origen,
  destino,
  CASE
    WHEN destino = 'CUP'
      THEN 'EL_TOQUE'
    WHEN origen  IN ('USD','EUR','GBP','MXN','CAD','JPY','CHF','AUD')
     AND destino IN ('USD','EUR','GBP','MXN','CAD','JPY','CHF','AUD')
      THEN 'FRANKFURTER'
    ELSE 'MANUAL'
  END AS fuente,
  TRUE AS activo
FROM pares
ON CONFLICT (client_id, origen, destino) DO NOTHING;
