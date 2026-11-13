-- =============================================================================
-- MODELO ANALÍTICO DEL CRM  <-  Parquet crudo extraído de Advantage (ERP FORTUNER)
-- Toda limpieza de tipos y llaves ocurre aquí, en SQL vectorizado de DuckDB.
-- Placeholders: {staging} (carpeta de Parquet), {hoy} (fecha de la carga, 'AAAA-MM-DD'),
--               {no_venta} (productos que no son venta, entre comillas y separados por coma).
-- =============================================================================

CREATE OR REPLACE MACRO clean(x) AS NULLIF(TRIM(CAST(x AS VARCHAR)), '');
CREATE OR REPLACE MACRO num(x) AS COALESCE(TRY_CAST(x AS DOUBLE), 0);
CREATE OR REPLACE MACRO to_bool(x) AS COALESCE(
    TRY_CAST(x AS BOOLEAN),
    UPPER(TRIM(CAST(x AS VARCHAR))) IN ('S', 'SI', 'Y', 'T', 'TRUE', '1'),
    FALSE
);

-- ------------------------------------------------------------------ catálogo jerárquico
CREATE OR REPLACE TABLE catalogo AS
SELECT DISTINCT ON (codigo) *
FROM (SELECT clean(CTABCOD) AS codigo, clean(CTABDES) AS nombre
      FROM read_parquet('{staging}/tidtab/*.parquet') WHERE clean(CTABCOD) IS NOT NULL)
ORDER BY codigo, nombre;

-- ------------------------------------------------------------------ ventas (líneas depuradas)
-- Se excluyen: líneas anuladas (IFNULO = 'X'), recibos de caja (factura con prefijo R: abonos, no son ventas)
-- y productos que no son venta (tarjeta regalo). La cédula 222222222222 u otra que no exista en POSCLI es
-- «consumidor final»: cliente_id queda NULL (se vende, pero no se puede segmentar).
-- IFCLIENTE trae la CÉDULA del cliente o el NÚMERO DE TARJETA Gana Mercaldas (CODCLI): se resuelven ambos a la cédula.
-- (Antes solo se cruzaba por cédula y se perdía ~23 % de la venta con cliente identificado.)
CREATE OR REPLACE TABLE venta AS
-- Registros genéricos del POS (CONSUMIDOR FINAL, documentos 2222222222, 0000000…) NO son personas: nunca reciben ventas.
WITH pos AS (SELECT clean(CODCLI) AS codigo, clean(CEDCLI) AS cedula FROM read_parquet('{staging}/poscli/*.parquet')
             WHERE clean(CEDCLI) IS NOT NULL
               AND NOT (length(clean(CEDCLI)) >= 5 AND replace(clean(CEDCLI), left(clean(CEDCLI), 1), '') = '')
               AND COALESCE(UPPER(clean(NOMCLI)), '') NOT LIKE '%CONSUMIDOR%FINAL%'),
cli AS (SELECT DISTINCT cedula FROM pos),
tarjeta AS (SELECT codigo, MIN(cedula) AS cedula FROM pos WHERE codigo IS NOT NULL GROUP BY codigo HAVING COUNT(DISTINCT cedula) = 1)
SELECT clean(d.IFFACT)                                   AS factura,
       TRY_CAST(TRY_CAST(d.IFSUCUR AS DOUBLE) AS INTEGER) AS sucursal_id,
       d.IFFECHA::DATE                                   AS fecha,
       TRY_CAST(SUBSTR(clean(d.IFHORA), 1, 2) AS INTEGER) AS hora,
       clean(d.IFARTIC)                                  AS producto_id,
       COALESCE(c.cedula, t.cedula)                      AS cliente_id,
       num(d.IFCANT)::DOUBLE                             AS cantidad,
       num(d.IFVLRNET)::DOUBLE                           AS venta_neta,
       num(d.IFVLRBRU)::DOUBLE                           AS venta_bruta,
       num(d.IFVLRDES)::DOUBLE                           AS descuento,
       num(d.IFCOSTO)::DOUBLE                            AS costo,
       clean(d.IFFAMILIA)                                AS familia_id,
       clean(d.IFDPTO)                                   AS departamento_id,
       clean(d.IFGRUPO)                                  AS grupo_id,
       clean(d.IFSECCION)                                AS seccion_id
FROM read_parquet('{staging}/fadite/*.parquet', union_by_name = true) d
LEFT JOIN cli c ON c.cedula = clean(d.IFCLIENTE)
LEFT JOIN tarjeta t ON t.codigo = clean(d.IFCLIENTE)
WHERE d.IFFECHA IS NOT NULL
  AND COALESCE(UPPER(clean(d.IFNULO)), '') <> 'X'
  AND NOT starts_with(UPPER(COALESCE(clean(d.IFFACT), '')), 'R')
  AND clean(d.IFARTIC) IS NOT NULL
  AND clean(d.IFARTIC) NOT IN ({no_venta});

-- ------------------------------------------------------------------ productos
CREATE OR REPLACE TABLE producto AS
WITH sal AS (SELECT * FROM read_parquet('{staging}/tidsal/*.parquet')),
tipos AS (SELECT clean(CODIGO) AS codigo, clean(NOMBRE) AS nombre FROM read_parquet('{staging}/tidtpro/*.parquet')),
uno AS (   -- TIDSAL repite el producto por bodega: un registro maestro por SKU
    SELECT DISTINCT ON (clean(INARTIC)) * FROM sal WHERE clean(INARTIC) IS NOT NULL
    ORDER BY clean(INARTIC), (UPPER(COALESCE(clean(INACTIVO), 'A')) = 'A') DESC, clean(INNOMBRE) NULLS LAST,
             clean(INEAN) NULLS LAST, num(INVRVENTA1) DESC
),
stock AS (
    SELECT clean(INARTIC) AS producto_id,
           SUM(GREATEST(num(INSALDO00), 0)) AS stock_actual,
           BOOL_OR(UPPER(COALESCE(clean(INACTIVO), 'A')) = 'A' AND COALESCE(UPPER(clean(INBLOQUEO)), '') NOT IN ('Z', 'B')) AS activo
    FROM sal GROUP BY ALL
),
jer AS (   -- jerarquía comercial = la de su última venta
    SELECT producto_id,
           arg_max(familia_id, fecha) AS familia_id, arg_max(departamento_id, fecha) AS departamento_id,
           arg_max(grupo_id, fecha) AS grupo_id, arg_max(seccion_id, fecha) AS seccion_id
    FROM venta GROUP BY producto_id
)
SELECT clean(u.INARTIC)                                AS producto_id,
       clean(u.INEAN)                                  AS ean,
       COALESCE(clean(u.INNOMBRE), clean(u.INARTIC))   AS producto,
       COALESCE(clean(u.INMARCA), 'SIN MARCA')         AS marca,
       COALESCE(t.nombre, 'NO ESPECIFICADO')           AS tipo_producto,
       COALESCE(s.stock_actual, 0)::DOUBLE             AS stock_actual,
       num(u.INVRULTC)::DOUBLE                         AS costo_ultima_compra,
       num(u.INVRVENTA1)::DOUBLE                       AS precio_venta,
       COALESCE(s.activo, TRUE)                        AS activo,
       COALESCE(j.familia_id, '0')                     AS familia_id,
       COALESCE(cf.nombre, 'SIN FAMILIA')              AS familia,
       COALESCE(j.departamento_id, '0')                AS departamento_id,
       COALESCE(cd.nombre, 'SIN DEPARTAMENTO')         AS departamento,
       COALESCE(j.grupo_id, '0')                       AS grupo_id,
       COALESCE(cg.nombre, 'SIN GRUPO')                AS grupo,
       COALESCE(j.seccion_id, j.grupo_id, '0')         AS seccion_id,
       COALESCE(cs.nombre, cg.nombre, 'SIN SECCIÓN')   AS seccion
FROM uno u
LEFT JOIN tipos t ON t.codigo = clean(u.INTIPO)
LEFT JOIN stock s ON s.producto_id = clean(u.INARTIC)
LEFT JOIN jer j ON j.producto_id = clean(u.INARTIC)
LEFT JOIN catalogo cf ON cf.codigo = j.familia_id
LEFT JOIN catalogo cd ON cd.codigo = j.departamento_id
LEFT JOIN catalogo cg ON cg.codigo = j.grupo_id
LEFT JOIN catalogo cs ON cs.codigo = j.seccion_id;

-- ------------------------------------------------------------------ clientes
CREATE OR REPLACE TABLE cliente AS
WITH base AS (
    SELECT clean(CEDCLI) AS cliente_id,
           clean(CODCLI) AS codigo,
           clean(NOMCLI) AS nombre,
           clean(EMAIL)  AS email,
           regexp_replace(COALESCE(clean(TELCELU), ''), '[^0-9]', '', 'g') AS tel,
           clean(CIUCLI) AS ciudad,
           clean(BARRIO1) AS barrio,
           CASE UPPER(clean(SEXO)) WHEN 'F' THEN 'F' WHEN 'M' THEN 'M' ELSE NULL END AS sexo,
           FECHAN AS fecha_nacimiento,
           FECHAI AS fecha_ingreso,
           INFOLEY AS autoriza_raw,
           to_bool(CLUBVINO) AS club_vino, to_bool(CLUBSALUD) AS club_salud,
           to_bool(CLUBMASCO) AS club_mascotas, to_bool(CLUBPARRI) AS club_parrilla,
           clean(BLOQUE) AS bloqueado
    FROM read_parquet('{staging}/poscli/*.parquet')
    WHERE clean(CEDCLI) IS NOT NULL
      AND NOT (length(clean(CEDCLI)) >= 5 AND replace(clean(CEDCLI), left(clean(CEDCLI), 1), '') = '')   -- 2222222222, 0000000…
      AND COALESCE(UPPER(clean(NOMCLI)), '') NOT LIKE '%CONSUMIDOR%FINAL%'
), uno AS (
    SELECT DISTINCT ON (cliente_id) * FROM base ORDER BY cliente_id, (email IS NOT NULL) DESC, codigo
)
SELECT cliente_id, codigo, nombre, email, ciudad, barrio, sexo,
       CASE WHEN fecha_nacimiento BETWEEN DATE '1920-01-01' AND DATE '{hoy}' - INTERVAL 10 YEAR
            THEN date_diff('year', fecha_nacimiento, DATE '{hoy}') END AS edad,
       -- celular colombiano: 10 dígitos que empiezan por 3 (con o sin prefijo 57)
       CASE WHEN regexp_matches(tel, '^(57)?3[0-9]{{9}}$') THEN right(tel, 10) END AS celular,
       regexp_matches(COALESCE(email, ''), '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{{2,}}$')
         AND NOT starts_with(lower(COALESCE(email, '')), 'facturaelectronica') AS email_valido,   -- correo genérico de factura electrónica
       -- INFOLEY = aceptó el tratamiento de datos (Ley 1581). NULL = sin registro: NO se asume consentimiento.
       CASE WHEN autoriza_raw IS NULL THEN NULL ELSE to_bool(autoriza_raw) END AS autoriza_datos,
       club_vino, club_salud, club_mascotas, club_parrilla,
       fecha_ingreso,
       bloqueado IS NOT NULL AND bloqueado <> '' AS bloqueado
FROM uno;

-- ------------------------------------------------------------------ agregados para consultas rápidas
-- Producto x día (ventas positivas y devoluciones netas)
CREATE OR REPLACE TABLE agg_dia_producto AS
SELECT fecha, producto_id,
       SUM(cantidad) AS unidades, SUM(venta_neta) AS venta,
       SUM(venta_neta - costo * GREATEST(cantidad, 0)) AS margen,
       COUNT(DISTINCT factura || '|' || COALESCE(CAST(sucursal_id AS VARCHAR), '')) AS facturas,
       COUNT(DISTINCT cliente_id) AS clientes
FROM venta GROUP BY fecha, producto_id;

-- Estadísticas de rotación por producto (base de las recomendaciones por inventario)
CREATE OR REPLACE TABLE producto_stats AS
WITH h AS (SELECT DATE '{hoy}' AS hoy)
SELECT p.producto_id,
       MAX(a.fecha) FILTER (WHERE a.unidades > 0)                          AS ultima_venta,
       MIN(a.fecha)                                                        AS primera_venta,
       COALESCE(SUM(a.unidades) FILTER (WHERE a.fecha > h.hoy - INTERVAL 30 DAY), 0)  AS unidades_30d,
       COALESCE(SUM(a.unidades) FILTER (WHERE a.fecha > h.hoy - INTERVAL 90 DAY), 0)  AS unidades_90d,
       COALESCE(SUM(a.venta)    FILTER (WHERE a.fecha > h.hoy - INTERVAL 90 DAY), 0)  AS venta_90d,
       COALESCE(SUM(a.unidades), 0)                                        AS unidades_total,
       COALESCE(SUM(a.venta), 0)                                           AS venta_total,
       COALESCE(SUM(a.margen), 0)                                          AS margen_total,
       COALESCE(COUNT(DISTINCT a.fecha) FILTER (WHERE a.unidades > 0), 0)  AS dias_con_venta
FROM producto p CROSS JOIN h
LEFT JOIN agg_dia_producto a ON a.producto_id = p.producto_id
GROUP BY p.producto_id;

-- ------------------------------------------------------------------ comportamiento del cliente
-- Un registro por cliente y día de compra
CREATE OR REPLACE TABLE cli_dia AS
SELECT cliente_id, fecha,
       SUM(venta_neta) AS venta, COUNT(DISTINCT factura) AS facturas,
       COUNT(*) FILTER (WHERE cantidad > 0) AS lineas,
       SUM(descuento) AS descuento, SUM(venta_bruta) AS bruta,
       MIN(hora) AS hora
FROM venta WHERE cliente_id IS NOT NULL
GROUP BY cliente_id, fecha
HAVING SUM(venta_neta) > 0;

CREATE OR REPLACE TABLE cli_perfil AS
WITH g AS (
    SELECT cliente_id, fecha, venta, facturas, lineas, descuento, bruta, hora,
           date_diff('day', LAG(fecha) OVER (PARTITION BY cliente_id ORDER BY fecha), fecha) AS gap
    FROM cli_dia
)
SELECT cliente_id,
       MIN(fecha) AS primera_compra, MAX(fecha) AS ultima_compra,
       COUNT(*)   AS visitas,
       SUM(venta) AS venta_total,
       SUM(venta) / COUNT(*) AS ticket_prom,
       SUM(lineas) / COUNT(*)::DOUBLE AS items_por_visita,
       AVG(gap)   AS intervalo_dias,
       STDDEV_POP(gap) AS intervalo_desv,
       SUM(descuento) / NULLIF(SUM(bruta), 0) AS pct_descuento,
       COUNT(*) FILTER (WHERE fecha > DATE '{hoy}' - INTERVAL 90 DAY)  AS visitas_90d,
       COUNT(*) FILTER (WHERE fecha > DATE '{hoy}' - INTERVAL 180 DAY) AS visitas_180d,
       COALESCE(SUM(venta) FILTER (WHERE fecha > DATE '{hoy}' - INTERVAL 90 DAY), 0)  AS venta_90d,
       COALESCE(SUM(venta) FILTER (WHERE fecha > DATE '{hoy}' - INTERVAL 180 DAY), 0) AS venta_180d,
       COUNT(*) FILTER (WHERE isodow(fecha) >= 6)  AS visitas_finde,
       COUNT(*) FILTER (WHERE isodow(fecha) = 5)   AS visitas_viernes,
       COUNT(*) FILTER (WHERE day(fecha) BETWEEN 1 AND 5 OR day(fecha) BETWEEN 15 AND 20 OR day(fecha) >= 28) AS visitas_quincena,
       mode(isodow(fecha)) AS dia_semana_pref,
       mode(CASE WHEN hora < 12 THEN 'mañana' WHEN hora < 18 THEN 'tarde' ELSE 'noche' END) AS franja_pref
FROM g GROUP BY cliente_id;

-- Afinidad: qué compra cada cliente, a distintos niveles de la jerarquía
CREATE OR REPLACE TABLE cli_producto AS
SELECT cliente_id, producto_id,
       SUM(cantidad) AS unidades, SUM(venta_neta) AS venta,
       COUNT(DISTINCT factura) AS compras, MAX(fecha) AS ultima
FROM venta WHERE cliente_id IS NOT NULL AND cantidad > 0
GROUP BY cliente_id, producto_id;

CREATE OR REPLACE TABLE cli_nivel AS
SELECT cliente_id, 'familia' AS nivel, familia_id AS codigo, SUM(venta_neta) AS venta, COUNT(DISTINCT factura) AS compras
FROM venta WHERE cliente_id IS NOT NULL AND cantidad > 0 AND familia_id IS NOT NULL GROUP BY ALL
UNION ALL
SELECT cliente_id, 'departamento', departamento_id, SUM(venta_neta), COUNT(DISTINCT factura)
FROM venta WHERE cliente_id IS NOT NULL AND cantidad > 0 AND departamento_id IS NOT NULL GROUP BY ALL
UNION ALL
SELECT cliente_id, 'grupo', grupo_id, SUM(venta_neta), COUNT(DISTINCT factura)
FROM venta WHERE cliente_id IS NOT NULL AND cantidad > 0 AND grupo_id IS NOT NULL GROUP BY ALL;

CREATE OR REPLACE TABLE cli_marca AS
SELECT v.cliente_id, p.marca, SUM(v.venta_neta) AS venta, COUNT(DISTINCT v.factura) AS compras
FROM venta v JOIN producto p USING (producto_id)
WHERE v.cliente_id IS NOT NULL AND v.cantidad > 0
GROUP BY v.cliente_id, p.marca;

-- Estacionalidad del cliente: ventas por mes calendario (para «compra en esta temporada»)
CREATE OR REPLACE TABLE cli_mes AS
SELECT cliente_id, month(fecha) AS mes, COUNT(*) AS visitas, SUM(venta) AS venta
FROM cli_dia GROUP BY cliente_id, month(fecha);

-- ------------------------------------------------------------------ RFM y ciclo de compra (segmentación base)
-- R = recencia, F = frecuencia (visitas), M = valor (venta total). Quintiles 1..5 (5 = mejor).
CREATE OR REPLACE TABLE cli_rfm AS
WITH b AS (
    SELECT p.*, date_diff('day', p.ultima_compra, DATE '{hoy}') AS dias_sin_compra
    FROM cli_perfil p
), q AS (
    SELECT *,
           ntile(5) OVER (ORDER BY dias_sin_compra DESC, cliente_id) AS r,
           ntile(5) OVER (ORDER BY visitas ASC, cliente_id)          AS f,
           ntile(5) OVER (ORDER BY venta_total ASC, cliente_id)      AS m,
           ntile(3) OVER (ORDER BY COALESCE(pct_descuento, 0) ASC, cliente_id) AS sens_desc
    FROM b
), s AS (
    SELECT *, ROUND((f + m) / 2.0) AS fm FROM q
)
SELECT cliente_id, dias_sin_compra, r, f, m, sens_desc,
       CASE
         WHEN visitas = 1 AND dias_sin_compra <= 45 THEN 'nuevos'
         WHEN r >= 4 AND fm >= 4 THEN 'campeones'
         WHEN r >= 3 AND fm >= 4 THEN 'leales'
         WHEN r <= 2 AND fm >= 4 THEN 'no_perder'
         WHEN r >= 4 AND fm <= 2 THEN 'prometedores'
         WHEN r >= 3 AND fm = 3 THEN 'potenciales'
         WHEN r = 3 AND fm <= 2 THEN 'atencion'
         WHEN r <= 2 AND fm = 3 THEN 'en_riesgo'
         WHEN r = 1 AND fm <= 2 THEN 'perdidos'
         ELSE 'hibernando'
       END AS segmento_rfm,
       dias_sin_compra / NULLIF(intervalo_dias, 0) AS ratio_ciclo,
       CASE
         WHEN visitas < 3 OR intervalo_dias IS NULL THEN 'sin_historial'
         WHEN dias_sin_compra / NULLIF(intervalo_dias, 0) < 0.7 THEN 'adelantado'
         WHEN dias_sin_compra / NULLIF(intervalo_dias, 0) <= 1.5 THEN 'en_ventana'
         WHEN dias_sin_compra / NULLIF(intervalo_dias, 0) <= 3 THEN 'atrasado'
         ELSE 'inactivo'
       END AS estado_ciclo
FROM s;
