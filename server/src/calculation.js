// A restricted arithmetic parser, never eval/Function or model-supplied code.
export function evaluateArithmetic(expression, inputs) {
  const tokens = expression.match(/[a-z]|(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]/g) || [];
  if (expression.length > 200 || tokens.join('') !== expression.replace(/\s/g, ''))
    throw new Error('Unsupported arithmetic expression.');
  let cursor = 0;
  const factor = () => {
    const token = tokens[cursor++];
    if (token === '+' || token === '-') return (token === '-' ? -1 : 1) * factor();
    if (token === '(') {
      const value = sum();
      if (tokens[cursor++] !== ')') throw new Error('Unbalanced expression.');
      return value;
    }
    if (Object.hasOwn(inputs, token)) return inputs[token];
    if (token && ['0', '1', '100'].includes(token)) return Number(token);
    throw new Error('Use cited inputs and supported constants only.');
  };
  const product = () => {
    let value = factor();
    while (['*', '/'].includes(tokens[cursor])) {
      const op = tokens[cursor++],
        next = factor();
      if (op === '/' && next === 0) throw new Error('Division by zero.');
      value = op === '*' ? value * next : value / next;
    }
    return value;
  };
  const sum = () => {
    let value = product();
    while (['+', '-'].includes(tokens[cursor])) {
      const op = tokens[cursor++],
        next = product();
      value = op === '+' ? value + next : value - next;
    }
    return value;
  };
  const result = sum();
  if (cursor !== tokens.length || !Number.isFinite(result)) throw new Error('Invalid arithmetic.');
  return result;
}

const nearlyEqual = (a, b) =>
  Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 16;
export function containsNumber(text, value) {
  return (
    text.replace(/−/g, '-').match(/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ||
    []
  ).some((number) => nearlyEqual(Number(number.replaceAll(',', '')), value));
}

export function verifyCalculation(calculation, claimText, sources) {
  const values = {};
  for (const input of calculation.inputs) {
    const source = sources.find((item) => item.id === input.sourceId);
    if (
      Object.hasOwn(values, input.name) ||
      !source ||
      !input.exactQuote.trim() ||
      !source.text.includes(input.exactQuote) ||
      !containsNumber(input.exactQuote, input.value)
    )
      throw new Error('A calculation input could not be grounded in its source.');
    values[input.name] = input.value;
  }
  if (!containsNumber(claimText, calculation.claimedValue))
    throw new Error('The claimed numerical result is absent from the answer.');
  const computedValue = evaluateArithmetic(calculation.expression, values);
  const correction =
    Math.sign(computedValue) * Number.EPSILON * Math.max(1, Math.abs(computedValue));
  const rounded = Number((computedValue + correction).toFixed(calculation.precision));
  return {
    ...calculation,
    computedValue,
    roundedValue: rounded,
    verified: true,
    correct: nearlyEqual(rounded, calculation.claimedValue),
    displayExpression: calculation.expression.replace(/[a-z]/g, (name) => `(${values[name]})`),
  };
}
