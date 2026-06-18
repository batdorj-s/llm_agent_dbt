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
    -- Include rows from the same day as the last known order to prevent data gaps
    where order_date >= (select max(order_date) from {{ this }})
{% endif %}
