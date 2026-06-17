{{
    config(
        materialized='incremental',
        unique_key='order_id'
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

{% if is_incremental() %}
    -- Only include rows newer than the max existing order_date
    where order_date > (select max(order_date) from {{ this }})
{% endif %}
