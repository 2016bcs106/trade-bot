interface ChartValue {
  label: string;
  value: number;
  color?: string;
  enabled?: boolean;
  runningProfit?: number;
  signal?: string | null;
}

interface ChartDataItem {
  date: string;
  values: ChartValue[];
}

interface TransformedChartData {
  dates: string[];
  groupColours: Record<string, string>;
  groupEnabled: Record<string, boolean>;
  groupedData: Record<string, number[]>;
  profits: (number | undefined)[];
  signals: (string | null | undefined)[];
}

export default class ChartDataTransformer {
  transform(data: ChartDataItem[]): TransformedChartData {
    const groupedData: Record<string, number[]> = {};
    const groupColours: Record<string, string> = {};
    const groupEnabled: Record<string, boolean> = {};
    const profits: (number | undefined)[] = [];
    const signals: (string | null | undefined)[] = [];

    data.forEach(item => {
      item.values.forEach(value => {
        if (!groupedData[value.label]) {
          groupedData[value.label] = [];
        }

        if (!groupColours[value.label]) {
          groupColours[value.label] = value.color || "#000";
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
