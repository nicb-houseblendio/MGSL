import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useDetailData } from '@/hooks/useDetailData';
import type { DetailType } from '@/hooks/useDetailData';

interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  locationId: string;
  triggerType: DetailType;
}

const TAB_LABELS: Record<DetailType, string> = {
  onHand: 'On Hand',
  committed: 'Committed',
  outbound: 'Outbound',
  onOrder: 'On Order',
  inTransit: 'In Transit',
};

const COLUMN_MAP: Record<DetailType, { id: string; label: string; link?: boolean }[]> = {
  onHand: [
    { id: 'docType', label: 'Doc. Type' },
    { id: 'docNum', label: 'Doc. #', link: true },
    { id: 'receiptDate', label: 'Receipt Date' },
    { id: 'vendor', label: 'Vendor', link: true },
    { id: 'lotNo', label: 'Lot #' },
    { id: 'packQty', label: 'Quantity' },
    { id: 'avgPrice', label: 'Avg Price' },
  ],
  committed: [
    { id: 'docNum', label: 'SO #', link: true },
    { id: 'customerName', label: 'Customer', link: true },
    { id: 'tranDate', label: 'Trans. Date' },
    { id: 'expectedShipDate', label: 'Expected Ship Date' },
    { id: 'itemCode', label: 'Item Code', link: true },
    { id: 'packCommitted', label: 'Pack Committed' },
    { id: 'openPackQty', label: 'Open Pack Qty' },
    { id: 'rate', label: 'Price/Pack' },
  ],
  outbound: [
    { id: 'docNum', label: 'Doc. #', link: true },
    { id: 'customerName', label: 'Customer', link: true },
    { id: 'dueDate', label: 'Ship Date' },
    { id: 'itemCode', label: 'Item Code', link: true },
    { id: 'packQty', label: 'Quantity' },
    { id: 'invoicedQty', label: 'Invoiced Qty' },
    { id: 'remainingQty', label: 'Remaining Qty' },
    { id: 'rate', label: 'Price' },
  ],
  onOrder: [
    { id: 'docNum', label: 'PO #', link: true },
    { id: 'vendorName', label: 'Vendor', link: true },
    { id: 'shipDate', label: 'Expected Delivery' },
    { id: 'itemCode', label: 'Item Code', link: true },
    { id: 'packQty', label: 'Quantity' },
    { id: 'openQty', label: 'Open Qty' },
    { id: 'rate', label: 'Price' },
  ],
  inTransit: [
    { id: 'docNum', label: 'Doc. #', link: true },
    { id: 'tranDate', label: 'Trans. Date' },
    { id: 'vendor', label: 'Vendor', link: true },
    { id: 'itemCode', label: 'Item Code', link: true },
    { id: 'packQty', label: 'Quantity' },
    { id: 'inTransitAdditional', label: 'In Transit Additional' },
    { id: 'rate', label: 'Price' },
  ],
};

export const DetailDrawer = ({
  open,
  onOpenChange,
  itemId,
  locationId,
  triggerType,
}: DetailDrawerProps) => {
  const { data, loading, error, fetchDetail } = useDetailData();
  const [activeTab, setActiveTab] = React.useState<DetailType>(triggerType);
  const fetchedRef = React.useRef(false);

  React.useEffect(() => {
    if (open && itemId && locationId && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchDetail(itemId, locationId).catch(() => {});
    }
    if (!open) fetchedRef.current = false;
  }, [open, itemId, locationId, fetchDetail]);

  React.useEffect(() => {
    if (open) setActiveTab(triggerType);
  }, [open, triggerType]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Inventory Detail</SheetTitle>
        </SheetHeader>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DetailType)}>
          <TabsList className="grid w-full grid-cols-5">
            {(Object.keys(TAB_LABELS) as DetailType[]).map((t) => (
              <TabsTrigger key={t} value={t} className="text-xs">
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          {(Object.keys(TAB_LABELS) as DetailType[]).map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-4">
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : error ? (
                <p className="text-destructive">{error}</p>
              ) : data?.[tab]?.length ? (
                <DetailTable
                  rows={data[tab] as Record<string, unknown>[]}
                  columns={COLUMN_MAP[tab]}
                />
              ) : (
                <p className="text-muted-foreground">No data</p>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

interface DetailTableProps {
  rows: Record<string, unknown>[];
  columns: { id: string; label: string; link?: boolean }[];
}

const DetailTable = ({ rows, columns }: DetailTableProps) => (
  <Table>
    <TableHeader>
      <TableRow>
        {columns.map((col) => (
          <TableHead key={col.id}>{col.label}</TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((row, i) => (
        <TableRow key={i}>
          {columns.map((col) => {
            const val = row[col.id];
            const linkUrl = col.id === 'docNum' ? row.docUrl : col.id === 'vendor' || col.id === 'vendorName' ? row.vendorUrl : col.id === 'customerName' ? row.customerUrl : col.id === 'itemCode' ? row.itemUrl : undefined;
            return (
              <TableCell key={col.id}>
                {col.link && linkUrl ? (
                  <a
                    href={String(linkUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {String(val ?? '')}
                  </a>
                ) : (
                  String(val ?? '')
                )}
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
