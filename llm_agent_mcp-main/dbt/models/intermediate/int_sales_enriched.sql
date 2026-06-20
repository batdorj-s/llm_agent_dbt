{{
    config(
        materialized='ephemeral'
    )
}}

with sales as (
    select * from {{ ref('stg_sales') }}
)

select
    *,
    (sales - profit) as cost_of_goods_sold,
    round((profit / sales) * 100, 2) as profit_margin_pct
from sales
