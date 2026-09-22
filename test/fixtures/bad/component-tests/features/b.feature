@wip
Feature: слайс 2
  Scenario: ошибка провайдера
    When провайдер возвращает 500
    Then exit code 2
