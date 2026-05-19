#!/bin/bash
# Usage: ./batch-run.sh <N>
# Runs the dry-run trade bot for the last N business days (Mon-Fri) ending today.
# Prints the last 'success' signal's gain for each day and sums them up.

N=${1:-10}

if ! [[ "$N" =~ ^[0-9]+$ ]] || [ "$N" -le 0 ]; then
  echo "Usage: ./batch-run.sh <number_of_business_days>"
  exit 1
fi

count=0
days_back=0
declare -a results=()

while [ $count -lt $N ]; do
  date=$(date -v-${days_back}d +%Y-%m-%d)
  dow=$(date -v-${days_back}d +%u) # 1=Mon, 7=Sun

  # Skip weekends (6=Sat, 7=Sun)
  if [ "$dow" -le 5 ]; then
    node backend/scripts/trade-bot.js --dryRun --date="$date" > /dev/null 2>&1
    # Get the last signal with status 'success' and extract its gain
    gain=$(cat front-end/public/dry-run-output.json | jq '[.signals[] | select(.status == "success")] | last | .gain // 0')
    results+=("$date: $gain")
    count=$((count + 1))
  fi

  days_back=$((days_back + 1))
done

echo ""
echo "===== RESULTS ====="
total=0
for result in "${results[@]}"; do
  echo "$result"
  gain_val=$(echo "$result" | awk -F': ' '{print $2}')
  total=$(echo "$total + $gain_val" | bc)
done
echo "-------------------"
echo "TOTAL: $total"
echo "==================="
