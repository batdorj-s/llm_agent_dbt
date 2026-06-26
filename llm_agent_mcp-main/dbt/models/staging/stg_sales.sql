{% set input_table = var('input_table', 'superstore_sales') %}
{% set sales_col = var('sales_col', 'sales') %}
{% set date_col = var('date_col', 'order_date') %}
{% set customer_col = var('customer_col', 'customer_id') %}
{% set profit_col = var('profit_col', 'profit') %}
{% set id_col = var('id_col', 'order_id') %}
{% set segment_col = var('segment_col', 'segment') %}
{% set category_col = var('category_col', 'category') %}
{% set region_col = var('region_col', null) %}

with raw_sales as (
    {% if input_table == 'superstore_sales' %}
        select * from {{ source('main', 'superstore_sales') }}
    {% else %}
        select * from {{ input_table }}
    {% endif %}
)

select
    {{ id_col }} as order_id,
    cast({{ date_col }} as timestamp) as order_date,
    {{ sales_col }} as sales,
    {% if profit_col %} {{ profit_col }} {% else %} cast(null as numeric) {% endif %} as profit,
    {{ customer_col }} as customer_id,
    {% if segment_col %} {{ segment_col }} {% else %} cast(null as varchar) as segment {% endif %},
    {% if category_col %} {{ category_col }} {% else %} cast(null as varchar) as category {% endif %}
    {% if region_col %}, {{ region_col }} as region {% endif %}
from raw_sales
