with raw_sales as (
    select * from {{ source('main', 'superstore_sales') }}
)

select
    order_id,
    cast(order_date as timestamp) as order_date,
    sales,
    profit,
    customer_id,
    segment,
    category
from raw_sales
