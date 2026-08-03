-- Гүйлгээний түүхий өгөгдлийг (finance_combined) цэвэрлэх
WITH source AS (
  SELECT * FROM {{ source('main', 'finance_combined') }}
),

cleaned AS (
  SELECT
    "date"          AS огноо,
    TRIM("customer") AS харилцагч,
    "amount"        AS дүн,
    TRIM("category")    AS ангилал,
    TRIM("subcategory") AS дэд_ангилал,
    TRIM("description") AS тайлбар,
    CURRENT_TIMESTAMP AS _ingested_at

  FROM source
  WHERE "amount" IS NOT NULL
)

SELECT * FROM cleaned
