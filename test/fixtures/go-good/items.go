package items

// Money — доменный тип, валиден по построению: приватное поле + фабрика.
type Money struct {
	kopeks int64
}

// NewMoney проверяет вход по доменному диапазону.
func NewMoney(kopeks int64) (Money, error) {
	if kopeks < 0 {
		return Money{}, errNegative
	}
	return Money{kopeks: kopeks}, nil
}

var errNegative = errConst("money: negative")

type errConst string

func (e errConst) Error() string { return string(e) }
