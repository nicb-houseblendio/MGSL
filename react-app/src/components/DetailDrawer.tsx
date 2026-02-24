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
import type { PivotRow } from '@/lib/pivotTransform';
import type { DetailRow } from '@/types';

type DetailType = 'onHand' | 'committed' | 'outbound' | 'onOrder' | 'inTransit';

interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  locationId: string;
  triggerType: DetailType;
  row?: PivotRow;
}

const TAB_LABELS: Record<DetailType, string> = {
  onHand: 'On Hand',
  committed: 'Committed',
  outbound: 'Outbound',
  onOrder: 'On Order',
  inTransit: 'In Transit',
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

  React.useEffect(() => {
    if (open && itemId && locationId) {
      fetchDetail(activeTab, itemId, locationId);
    }
  }, [open, itemId, locationId, activeTab, fetchDetail]);

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
              ) : data ? (
                <DetailTable rows={data.rows} columns={data.columns} />
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
  rows: DetailRow[];
  columns: { id: string; label: string }[];
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
          {columns.map((col) => (
            <TableCell key={col.id}>
              {col.id === 'documentNumber' && row.documentLink ? (
                <a
                  href={row.documentLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {row[col.id] as string}
                </a>
              ) : (
                String(row[col.id] ?? '')
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
