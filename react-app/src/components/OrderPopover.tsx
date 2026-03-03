import * as React from 'react';
import { DollarSign } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CreateOrderModal } from '@/components/CreateOrderModal';
import type { SummaryRow } from '@/lib/api';

type OrderType = 'PO' | 'SO';

interface OrderPopoverProps {
  row: SummaryRow;
}

export const OrderPopover = ({ row }: OrderPopoverProps) => {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [modalType, setModalType] = React.useState<OrderType | null>(null);

  const handleSelect = (type: OrderType) => {
    setPopoverOpen(false);
    setModalType(type);
  };

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="text-gold hover:text-gold/80 transition-colors"
            aria-label="Create order"
          >
            <DollarSign className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40 p-2 space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => handleSelect('PO')}
          >
            Purchase Order
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => handleSelect('SO')}
          >
            Sales Order
          </Button>
        </PopoverContent>
      </Popover>

      {modalType && (
        <CreateOrderModal
          open
          onOpenChange={(open) => { if (!open) setModalType(null); }}
          type={modalType}
          itemId={row.internalId}
          locationId={row.locationId}
        />
      )}
    </>
  );
};
