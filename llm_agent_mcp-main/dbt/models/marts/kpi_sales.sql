with sales as (
    select * from {{ ref('int_sales_enriched') }}
)

select
    order_date,
    category,
    sum(sales) as total_sales,
    sum(profit) as total_profit,
    avg(profit_margin_pct) as avg_profit_margin,
    count(distinct order_id) as order_count,
    count(distinct customer_id) as customer_count
from sales
group by 1, 2
