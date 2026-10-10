export interface StockBalance { id: string; quantity: number; reservedQuantity: number; }
export interface InventoryAllocation { inventoryItemId: string; quantity: number; }

export function planInventoryAllocation(stocks: StockBalance[], requested: number): InventoryAllocation[] {
  if (!Number.isSafeInteger(requested) || requested <= 0) throw new Error("Order item quantity must be positive");
  let remaining = requested;
  const allocations: InventoryAllocation[] = [];
  for (const stock of [...stocks].sort((left, right) => left.id.localeCompare(right.id))) {
    const available = Math.max(0, stock.quantity - stock.reservedQuantity);
    const allocated = Math.min(remaining, available);
    if (allocated > 0) allocations.push({ inventoryItemId: stock.id, quantity: allocated });
    remaining -= allocated;
    if (remaining === 0) break;
  }
  if (remaining !== 0) throw new Error("Insufficient inventory across warehouses");
  return allocations;
}
