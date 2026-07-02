-- Харилцагчаар нэгтгэсэн гүйлгээний тайлан
SELECT
  харилцагч,
  COUNT(*)                                 AS нийт_гүйлгээ,
  SUM(дүн)                                AS нийт_дүн,
  MIN(огноо)                              AS эхний_гүйлгээ,
  MAX(огноо)                              AS сүүлийн_гүйлгээ,
  STRING_AGG(DISTINCT ангилал, ', ')      AS ангиллууд
FROM {{ ref('int_transactions_classified') }}
GROUP BY 1
ORDER BY 3 DESC
