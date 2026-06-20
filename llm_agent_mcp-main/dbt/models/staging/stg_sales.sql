{% set input_table = var('input_table', 'superstore_sales') %}
{% set has_segment = var('has_segment', true) %}
{% set has_category = var('has_category', true) %}

with raw_sales as (
    {% if input_table == 'superstore_sales' %}
        select * from {{ source('main', 'superstore_sales') }}
    {% else %}
        select * from {{ input_table }}
    {% endif %}
)

select
    order_id,
    cast(order_date as timestamp) as order_date,
    sales,
    profit,
    customer_id,
    {% if has_segment %} segment {% else %} cast(null as varchar) as segment {% endif %},
    {% if has_category %} category {% else %} cast(null as varchar) as category {% endif %}
from raw_sales
