# good-service

Может: принимает конфигурацию, валидирует и отдаёт отчёт.
Не может: менять контракт без заморозки.

## Как работает (pipe)

```
load config -> Config
  -> validate ranges -> ValidConfig        [CONFIG_ERROR → exit 2]
  -> fetch provider -> Payload             [PROVIDER_ERROR → exit 3]
  -> compare contract -> Report            [MISMATCH → exit 1]
  -> emit report -> stdout
```

## Таблица отказов

| error.code | exit | когда |
|---|---|---|
| CONFIG_ERROR | 2 | конфигурация вне доменных диапазонов |
| PROVIDER_ERROR | 3 | провайдер недоступен/500 |
| MISMATCH | 1 | контракт разошёлся со спецификацией |
