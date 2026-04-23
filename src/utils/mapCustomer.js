export function mapCustomerRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    customerId: row.customer_id,
    qrToken: row.qr_token,
    name: row.name,
    phone: row.phone,
    altPhone: row.alt_phone || undefined,
    address: row.address,
    area: row.area,
    zone: row.zone,
    route: row.route,
    customerType: row.customer_type,
    status: row.status,
    joiningDate: formatDate(row.joining_date),
    walletBalance: Number(row.wallet_balance),
    notes: row.notes || undefined,
    assignedWorker: row.assigned_worker_id || undefined,
    qrCardUrl: row.qr_card_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function mapWalletRow(row) {
  return {
    id: `WT-${row.id}`,
    customerId: String(row.customer_id),
    type: row.type,
    amount: Number(row.amount),
    description: row.description,
    referenceId: row.reference_id || undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    balanceAfter: Number(row.balance_after),
  };
}
