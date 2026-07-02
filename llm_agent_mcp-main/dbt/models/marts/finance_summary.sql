-- Сараар нэгтгэсэн санхүүгийн тайлан
SELECT
  сар,
  ангилал,
  дэд_ангилал,
  гүйлгээний_төрөл,
  COUNT(*)                                              AS гүйлгээний_тоо,
  SUM(дүн)                                             AS нийт_дүн,
  SUM(CASE WHEN гүйлгээний_төрөл = 'Орлого'
      THEN дүн ELSE 0 END)                             AS нийт_орлого,
  SUM(CASE WHEN гүйлгээний_төрөл = 'Зарлага'
      THEN дүн ELSE 0 END)                             AS нийт_зарлага,
  SUM(цэвэр_дүн)                                      AS цэвэр_урсгал
FROM {{ ref('int_transactions_classified') }}
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC, 5 DESC
