{% test assert_true(model, expression, severity="error") %}
    {{ config(severity=severity) }}
    select * from {{ model }}
    where not ({{ expression }})
{% endtest %}
