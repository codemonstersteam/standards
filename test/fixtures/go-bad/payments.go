package payments

type Money struct {
	kopeks int64
}

// Нарушение 1: фабрика не проверяет вход — нет ветки возврата ошибки.
func NewMoney(kopeks int64) (Money, error) {
	return Money{kopeks: kopeks}, nil
}

type Payment struct {
	amount Money
}

func NewPayment(kopeks int64) (Payment, error) {
	return Payment{amount: Money{kopeks: kopeks}}, nil
}

// Нарушение 2: «голый» литерал Money вне фабрики NewMoney.
func double(kopeks int64) Money {
	m := Money{kopeks: kopeks}
	return m
}
