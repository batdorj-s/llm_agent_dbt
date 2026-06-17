with sales as (
    select * from {{ ref('int_sales_enriched') }}
)

select
    customer_id,
    segment,
    min(order_date) as first_order_date,
    max(order_date) as last_order_date,
    count(distinct order_id) as total_orders,
    sum(sales) as total_spend,
    sum(profit) as total_profit_contribution,
    avg(profit_margin_pct) as avg_customer_margin
from sales
group by 1, 2
