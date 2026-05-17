export class Summarizer {
  summarize(data) {
    const groupedData = {};

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

    for (let date in groupedData) {
      const dayData = groupedData[date];
      const lastProfit = dayData[dayData.length - 1].runningProfit;
      netProfit += lastProfit;
      console.log(`Date: ${date} | Profit: ${lastProfit}`);
    }

    console.log(`Net profit: ${netProfit}`);
  }
}
