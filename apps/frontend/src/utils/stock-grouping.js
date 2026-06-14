export function isRecommended(stock) {
  return Array.isArray(stock.recommendedStrategies) && stock.recommendedStrategies.length > 0
}

export function getGroupRank(stock) {
  if (stock.isFavorite) return 0
  if (isRecommended(stock)) return 1
  return 2
}
