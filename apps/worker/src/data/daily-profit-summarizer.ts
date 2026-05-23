interface SummaryValue {
  label: string;
  value: number;
  signal?: string | null;
  runningProfit?: number;
}

interface SummaryDataItem {
  date: string;
  values: SummaryValue[];
}

interface DayEntry {
  time: string;
  close: number;
  signal: string | null | undefined;
  runningProfit: number | undefined;
}

export default class DailyProfitSummarizer {
  summarize(data: SummaryDataItem[]): void {
    const groupedData: Record<string, DayEntry[]> = {};

    data.forEach(item => {
      const day = item.date.split(" ")[0];

      if (!groupedData[day]) {
        groupedData[day] = [];
      }

      groupedData[day].push({
        time: item.date.split(" ")[1],
        close: item.values.filter(val => val.label === "Close")[0].value,
        signal: item.values[0].signal,
        runningProfit: item.values[0].runningProfit,
      });
    });

    let netProfit = 0;

    for (const date in groupedData) {
      const dayData = groupedData[date];
      const lastProfit = dayData[dayData.length - 1].runningProfit ?? 0;
      netProfit += lastProfit;
      console.log(`Date: ${date} | Profit: ${lastProfit}`);
    }

    console.log(`Net profit: ${netProfit}`);
  }
}
