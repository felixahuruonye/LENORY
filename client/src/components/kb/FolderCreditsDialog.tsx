// client/src/components/kb/FolderCreditsDialog.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Coins, Loader2 , Circle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface FolderCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: {
    id: string;
    name: string;
  } | null;
  credits: {
    balance: number;
    allocated: number;
    used: number;
  } | null;
  transactions: any[];
  onTopUp: (folderId: string, amount: number) => void;
  isTopUpLoading: boolean;
}

export function FolderCreditsDialog({
  open,
  onOpenChange,
  folder,
  credits,
  transactions,
  onTopUp,
  isTopUpLoading,
}: FolderCreditsDialogProps) {
  const [topupAmount, setTopupAmount] = useState(10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            Folder Credits: {folder?.name}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 pr-4">
          {credits && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold text-green-500">{credits.balance}</p>
                    <p className="text-xs text-muted-foreground">Available</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold text-blue-500">{credits.allocated}</p>
                    <p className="text-xs text-muted-foreground">Allocated</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold text-yellow-500">{credits.used}</p>
                    <p className="text-xs text-muted-foreground">Used</p>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Top Up Credits</p>
                <div className="flex items-center gap-2">
                  {[5, 10, 20, 50].map((amount) => (
                    <Button
                      key={amount}
                      variant={topupAmount === amount ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTopupAmount(amount)}
                      className="flex-1"
                    >
                      +{amount}
                    </Button>
                  ))}
                </div>
                <Button
                  onClick={() => {
                    if (folder) onTopUp(folder.id, topupAmount);
                  }}
                  disabled={isTopUpLoading}
                  className="w-full hover-elevate"
                >
                  {isTopUpLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Top Up ${topupAmount} Credits`
                  )}
                </Button>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Transaction History</p>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {transactions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center">No transactions yet</p>
                  ) : (
                    transactions.slice(0, 20).map((tx: any) => (
                      <div key={tx.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">
                            {tx.type === 'allocated' && '✨ Allocated'}
                            {tx.type === 'used' && '📤 Used'}
                            {tx.type === 'topup' && '💰 Top Up'}
                            {tx.type === 'refund' && '↩️ Refund'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(tx.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold ${tx.amount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {tx.amount > 0 ? '+' : ''}{tx.amount}
                          </p>
                          <p className="text-xs text-muted-foreground">Balance: {tx.balance_after}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

