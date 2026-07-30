// client/src/components/UserDetailModal.tsx
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Loader2 , Circle } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface UserDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string;
  userName: string;
  lenoryId?: string;
}

export function UserDetailModal({ open, onOpenChange, userId, userEmail, userName, lenoryId }: UserDetailModalProps) {
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<any>(null);
  const [creditHistory, setCreditHistory] = useState<any[]>([]);
  const [featureUsage, setFeatureUsage] = useState<any[]>([]);
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);

  useEffect(() => {
    if (open && userId) {
      fetchUserData();
    }
  }, [open, userId]);

  const fetchUserData = async () => {
    setLoading(true);
    try {
      const [activityRes, creditRes, featureRes, creditsRes] = await Promise.all([
        fetch(`/api/admin/user-activity/${userId}`),
        fetch(`/api/admin/credit-history/${userId}`),
        fetch(`/api/admin/feature-usage/${userId}`),
        fetch(`/api/admin/user-credits/${userId}`),
      ]);
      const activityData = await activityRes.json();
      const creditData = await creditRes.json();
      const featureData = await featureRes.json();
      const creditsData = await creditsRes.json();
      
      setActivity(activityData);
      setCreditHistory(creditData.history || []);
      setFeatureUsage(featureData.features || []);
      setCurrentCredits(creditsData.balance || 0);
    } catch (error) {
      console.error("Failed to fetch user data:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {userName || userEmail}
            {lenoryId && (
              <Badge variant="outline" className="ml-2 font-mono text-xs">
                {lenoryId}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="overview" className="flex-1">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="credits">Credit History</TabsTrigger>
              <TabsTrigger value="features">Feature Usage</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium truncate">{userEmail}</p>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">Current Credits</p>
                  <p className="font-medium text-yellow-600">{currentCredits !== null ? currentCredits : 'N/A'}</p>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Sessions</p>
                  <p className="font-medium">{activity?.totalSessions || 0}</p>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Hours</p>
                  <p className="font-medium">{activity?.totalHours || 0}h</p>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">Last Seen</p>
                  <p className="font-medium">
                    {activity?.lastSeen ? formatDistanceToNow(new Date(activity.lastSeen), { addSuffix: true }) : "Never"}
                  </p>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">Joined</p>
                  <p className="font-medium">
                    {activity?.sessions?.[activity.sessions.length - 1]?.session_start 
                      ? format(new Date(activity.sessions[activity.sessions.length - 1].session_start), "MMM d, yyyy")
                      : "Unknown"}
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="credits">
              <ScrollArea className="h-[300px]">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-right p-2">Balance After</th>
                      <th className="text-left p-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditHistory.map((tx: any) => (
                      <tr key={tx.id} className="border-t">
                        <td className="p-2 text-xs">{format(new Date(tx.created_at), "MMM d, HH:mm")}</td>
                        <td className="p-2">
                          <Badge variant={tx.type === 'topup' ? 'secondary' : tx.type === 'deduct' ? 'destructive' : tx.type === 'reset' ? 'outline' : 'default'}>
                            {tx.type}
                          </Badge>
                        </td>
                        <td className={`p-2 text-right ${tx.amount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {tx.amount > 0 ? '+' : ''}{tx.amount}
                        </td>
                        <td className="p-2 text-right font-mono">{tx.balance_after}</td>
                        <td className="p-2 text-xs text-muted-foreground">{tx.description || '-'}</td>
                      </tr>
                    ))}
                    {creditHistory.length === 0 && (
                      <tr><td colSpan={5} className="text-center p-4 text-muted-foreground">No credit history</td></tr>
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="features">
              <ScrollArea className="h-[300px]">
                {featureUsage.map((feature: any) => (
                  <div key={feature.id} className="flex items-center justify-between p-3 border-b">
                    <div>
                      <p className="font-medium">{feature.feature_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Last used: {formatDistanceToNow(new Date(feature.last_used), { addSuffix: true })}
                      </p>
                    </div>
                    <Badge variant="secondary">{feature.count} uses</Badge>
                  </div>
                ))}
                {featureUsage.length === 0 && (
                  <p className="text-center p-4 text-muted-foreground">No feature usage data</p>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

