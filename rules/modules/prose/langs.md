### Как выражается в языках

| | Go | TS/JS | Python | Rust |
|---|---|---|---|---|
| Фабрика | `NewX(raw) (X, error)`, поля unexported | `private`-поля + статическая фабрика / branded-типы | `__init__`-валидация / фабричная функция, `__setattr__`-заморозка | `TryFrom`/`new() -> Result`, непубличные поля |
| Result | пара `(T, error)`, без generic Result | юнион `Result<T,E>` / `Either` | возврат `Result`-подобного значения; исключения в домене запрещены | `Result<T, E>` нативно |
| Инвариант = подтип | непубличные поля + фабрика | branded/opaque-типы | `@dataclass(frozen=True)` + фабрика | newtype-обёртка |
