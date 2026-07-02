-- Гүйлгээний ангиллыг стандартчилах
WITH base AS (
  SELECT * FROM {{ ref('stg_transactions') }}
),

classified AS (
  SELECT
    огноо,
    харилцагч,
    дүн,
    ангилал,
    дэд_ангилал,
    тайлбар,

    CASE
      WHEN ангилал ILIKE '%орлого%' THEN 'Орлого'
      WHEN ангилал ILIKE '%зарлага%' THEN 'Зарлага'
      WHEN ангилал ILIKE '%шилжүүлэг%' THEN 'Дотоод шилжүүлэг'
      WHEN ангилал ILIKE '%зээл%' THEN 'Зээл'
      ELSE 'Бусад'
    END AS гүйлгээний_төрөл,

    -- Дотоод шилжүүлэг болон зээл P&L-д нөлөөлөхгүй
    CASE
      WHEN ангилал ILIKE '%орлого%' THEN дүн
      WHEN ангилал ILIKE '%зарлага%' THEN -дүн
      ELSE 0
    END AS цэвэр_дүн,

    DATE_TRUNC('month', огноо)   AS сар,
    DATE_TRUNC('quarter', огноо) AS улирал,
    EXTRACT(YEAR FROM огноо)     AS жил

  FROM base
)

SELECT * FROM classified
