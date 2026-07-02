-- Гүйлгээний raw дата цэвэрлэх
WITH source AS (
  SELECT * FROM {{ source('raw', 'transactions') }}
),

cleaned AS (
  SELECT
    -- "5-Jan" → DATE (жилийг var-аар авах, default: 2026)
    TO_DATE(
      "Өдөр" || '-' || '{{ var("transactions_year", "2026") }}',
      'DD-Mon-YYYY'
    ) AS огноо,

    TRIM("Харилцагч") AS харилцагч,

    -- ₮ тэмдэг болон мянгатын таслал хасаж тоо болгох
    CAST(
      REPLACE(REPLACE("Дүн", '₮', ''), ',', '') AS NUMERIC(15, 2)
    ) AS дүн,

    TRIM("Ангилал")       AS ангилал,
    TRIM("Дэд ангилал")   AS дэд_ангилал,
    TRIM("Тайлбар")       AS тайлбар,

    CURRENT_TIMESTAMP AS _ingested_at

  FROM source
  WHERE "Дүн" IS NOT NULL
    AND "Дүн" != ''
)

SELECT * FROM cleaned
