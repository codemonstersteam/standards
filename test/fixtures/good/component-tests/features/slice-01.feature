@wip
Feature: slice-01 validate
  Scenario: happy path — валидный контракт
    When подаём валидную конфигурацию
    Then exit code 0 и отчёт schema-valid

  Scenario: провайдер отдаёт 500
    When провайдер возвращает 500 на все запросы
    Then exit code 2 и error-code класса provider
