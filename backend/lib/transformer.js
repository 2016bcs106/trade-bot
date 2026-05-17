export class Transformer {
  transform(data) {
    const groupedData = {};
    const groupColours = {};
    const groupEnabled = {};
    const profits = [];
    const signals = [];

    data.forEach(item => {
      item.values.forEach(value => {
        if (!groupedData[value.label]) {
          groupedData[value.label] = [];
        }

        if (!groupColours[value.label]) {
          groupColours[value.label] = value.color;
        }

        if (groupEnabled[value.label] === undefined) {
          groupEnabled[value.label] = value.enabled !== false;
        }

        groupedData[value.label].push(value.value);
      });

      profits.push(item.values[0].runningProfit);
      signals.push(item.values[0].signal);
    });

    return {
      dates: data.map(item => item.date),
      groupColours,
      groupEnabled,
      groupedData,
      profits,
      signals,
    };
  }
}
