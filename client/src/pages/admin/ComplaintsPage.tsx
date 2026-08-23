import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link } from "wouter";
import {
  MessageSquare, AlertTriangle, CheckCircle2, ArrowLeft, Shield,
  Loader2, Eye, Send, Trash2, Filter, Search
} from "lucide-react";

interface UserComplaint {
  id: number;
  userId: string;
  userEmail: string;
  message: string;
  category: string;
  status: "open" | "investigating" | "resolved" | "escalated";
  createdAt: string;
  adminNotes: string | null;
  engineeringTaskId: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-500",
  investigating: "bg-yellow-500",
  resolved: "bg-green-500",
  escalated: "bg-purple-500",
};

export default function ComplaintsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedComplaint, setSelectedComplaint] = useState<UserComplaint | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const isAuthorized = user?.email === "felixahuruonye@gmail.com";

  const { data: complaints = [], isLoading } = useQuery<UserComplaint[]>({
    queryKey: ["/api/admin/complaints"],
    enabled: isAuthorized,
    refetchInterval: 15000,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/complaints/${id}`, { status, notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/complaints"] });
      toast({ title: "Complaint updated" });
    },
  });

  const escalateToEngineering = useMutation({
    mutationFn: async ({ complaintId, request }: { complaintId: number; request: string }) => {
      const res = await apiRequest("POST", "/api/engineering/tasks", { request });
      const task = await res.json();
      // Link complaint to task
      await apiRequest("PATCH", `/api/admin/complaints/${complaintId}`, {
        status: "escalated",
        engineeringTaskId: task.id,
      });
      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/complaints"] });
      toast({ title: "Escalated to Engineering Agent", description: "Task created and linked." });
      setShowDetail(false);
    },
    onError: (err: any) => {
      toast({ title: "Escalation failed", description: err.message, variant: "destructive" });
    },
  });

  const filteredComplaints = filter === "all"
    ? complaints
    : complaints.filter(c => c.status === filter);

  const openCount = complaints.filter(c => c.status === "open").length;
  const escalatedCount = complaints.filter(c => c.status === "escalated").length;

  if (!isAuthorized) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Shield className="w-16 h-16 text-muted-foreground mx-auto" />
          <h1 className="text-2xl font-bold">Admin Access Required</h1>
          <Link href="/dashboard">
            <Button variant="outline"><ArrowLeft className="w-4 h-4 mr-2" /> Back</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="h-14 border-b flex items-center px-4 justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <AlertTriangle className="w-6 h-6 text-destructive" />
          <h1 className="font-bold text-lg">User Complaints</h1>
          {openCount > 0 && (
            <Badge variant="destructive" className="text-xs">{openCount} open</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/engineering">
            <Button variant="outline" size="sm">
              <MessageSquare className="w-4 h-4 mr-1" /> Engineering Agent
            </Button>
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{complaints.length}</div>
              <p className="text-xs text-muted-foreground">Total Complaints</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-500">{openCount}</div>
              <p className="text-xs text-muted-foreground">Open</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-yellow-500">
                {complaints.filter(c => c.status === "investigating").length}
              </div>
              <p className="text-xs text-muted-foreground">Investigating</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-purple-500">{escalatedCount}</div>
              <p className="text-xs text-muted-foreground">Escalated to Engineering</p>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {["all", "open", "investigating", "escalated", "resolved"].map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
              className="text-xs capitalize"
            >
              {f}
            </Button>
          ))}
        </div>

        {/* Complaints List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Complaints ({filteredComplaints.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredComplaints.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No complaints in this category.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredComplaints.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => { setSelectedComplaint(c); setShowDetail(true); }}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <div className={`w-2 h-2 rounded-full mt-2 ${STATUS_COLORS[c.status] || "bg-gray-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.message.slice(0, 120)}...</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <span>{c.userEmail}</span>
                        <span>•</span>
                        <span className="capitalize">{c.status}</span>
                        <span>•</span>
                        <span>{new Date(c.createdAt).toLocaleString()}</span>
                        {c.category && <><span>•</span><Badge variant="outline" className="text-[10px]">{c.category}</Badge></>}
                        {c.engineeringTaskId && <><span>•</span><Badge className="text-[10px] bg-purple-500">Engineering Task</Badge></>}
                      </div>
                    </div>
                    <Eye className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail Dialog */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Complaint Detail
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            {selectedComplaint && (
              <div className="space-y-4">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-1">User Message</p>
                  <p className="text-sm">{selectedComplaint.message}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">User:</span> {selectedComplaint.userEmail}</div>
                  <div><span className="text-muted-foreground">Category:</span> {selectedComplaint.category || "Uncategorized"}</div>
                  <div><span className="text-muted-foreground">Status:</span> <span className="capitalize font-medium">{selectedComplaint.status}</span></div>
                  <div><span className="text-muted-foreground">Date:</span> {new Date(selectedComplaint.createdAt).toLocaleString()}</div>
                </div>

                {selectedComplaint.adminNotes && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Admin Notes</p>
                    <p className="text-sm">{selectedComplaint.adminNotes}</p>
                  </div>
                )}

                {selectedComplaint.engineeringTaskId && (
                  <div className="p-3 bg-purple-950/20 border border-purple-500/30 rounded-lg">
                    <p className="text-sm font-medium text-purple-400 mb-1">Linked Engineering Task</p>
                    <p className="text-sm font-mono">{selectedComplaint.engineeringTaskId}</p>
                    <Link href={`/admin/engineering`}>
                      <Button variant="link" size="sm" className="text-purple-400 p-0 h-auto mt-1">
                        View in Engineering Agent →
                      </Button>
                    </Link>
                  </div>
                )}

                {/* Actions */}
                <div className="space-y-3 pt-4 border-t">
                  <Textarea
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add admin notes..."
                    className="min-h-[60px]"
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatus.mutate({ id: selectedComplaint.id, status: "investigating", notes: adminNote })}
                      disabled={updateStatus.isPending}
                    >
                      Mark Investigating
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatus.mutate({ id: selectedComplaint.id, status: "resolved", notes: adminNote })}
                      disabled={updateStatus.isPending}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Mark Resolved
                    </Button>

                    {!selectedComplaint.engineeringTaskId && (
                      <Button
                        size="sm"
                        onClick={() => escalateToEngineering.mutate({
                          complaintId: selectedComplaint.id,
                          request: `Fix user complaint: ${selectedComplaint.message.slice(0, 200)}`,
                        })}
                        disabled={escalateToEngineering.isPending}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        {escalateToEngineering.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Creating Task...</>
                        ) : (
                          <><Send className="w-4 h-4 mr-1" /> Escalate to Engineering</>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
