import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/api';

type OrderType = 'PO' | 'SO';

interface CreateOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: OrderType;
  itemId: string;
  locationId: string;
  prefill?: {
    partyId?: string;
    quantity?: number;
  };
  onSuccess?: (result: { docId: number; docNum: string; docUrl: string }) => void;
}

export const CreateOrderModal = ({
  open,
  onOpenChange,
  type,
  itemId,
  locationId,
  prefill = {},
  onSuccess,
}: CreateOrderModalProps) => {
  const [partyId, setPartyId] = React.useState(prefill.partyId || '');
  const [quantity, setQuantity] = React.useState(String(prefill.quantity || 1));
  const [date, setDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ docId: number; docNum: string; docUrl: string } | null>(null);

  React.useEffect(() => {
    if (open) {
      setPartyId(prefill.partyId || '');
      setQuantity(String(prefill.quantity ?? 1));
      setDate('');
      setNotes('');
      setError(null);
      setResult(null);
    }
  }, [open, prefill.partyId, prefill.quantity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ docId: number; docNum: string; docUrl: string }>('createOrder', {
        type,
        itemId,
        locationId,
        partyId: partyId.trim(),
        quantity: parseFloat(quantity) || 1,
        date: date || new Date().toISOString().slice(0, 10),
        notes: notes.trim() || undefined,
      });
      setResult(res);
      onSuccess?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create order');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Create {type === 'PO' ? 'Purchase Order' : 'Sales Order'}
          </DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <p className="text-green-600 dark:text-green-400">
              {type} created successfully.
            </p>
            <a
              href={result.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-mono"
            >
              {result.docNum}
            </a>
            <Button onClick={handleClose}>Close</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="party" className="text-sm font-medium block mb-1">
                {type === 'PO' ? 'Vendor ID' : 'Customer ID'} (internal ID)
              </label>
              <Input
                id="party"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                placeholder={type === 'PO' ? 'Vendor internal ID' : 'Customer internal ID'}
                required
              />
            </div>
            <div>
              <label htmlFor="quantity" className="text-sm font-medium block mb-1">Quantity (Packs)</label>
              <Input
                id="quantity"
                type="number"
                min={0.01}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="date" className="text-sm font-medium block mb-1">
                {type === 'PO' ? 'Expected Delivery' : 'Expected Ship'} Date
              </label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="notes" className="text-sm font-medium block mb-1">Notes</label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>
            {error && (
              <p className="text-destructive text-sm">{error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating…' : 'Create'}
              </Button>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
