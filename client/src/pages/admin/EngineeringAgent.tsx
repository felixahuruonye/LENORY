import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Link } from "wouter";
import {
  Wrench, Loader2, Send, CheckCircle2, XCircle, AlertTriangle,
  ChevronRight, Clock, GitBranch, GitPullRequest, Eye,
  Play, RotateCcw, Brain, Code, Shield, Activity, ArrowLeft
} from "lucide-react";
import type { EngineeringTask, EngineeringTaskEvent } from "../../../shared/engineeringSchema";

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-500",
  received: "bg-blue-500",
  planning: "bg-indigo-500",
  investigating: "bg-purple-500",
  sandbox_creating: "bg-cyan-500",
  implementing: "bg-yellow-500",
  testing: "bg-orange-500",
  test_failed: "bg-red-500",
  debugging: "bg-pink-500",
  reviewing: "bg-violet-500",
  ready_for_approval: "bg-emerald-500",
  approved: "bg-green-500",
  rejected: "bg-red-600",
  merging: "bg-teal-500",
  deploying: "bg-sky-500",
  verifying_deployment: "bg-blue-400",
  completed: "bg-green-600",
  rolled_back: "bg-orange-600",
  failed: "bg-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  received: "Received",
  planning: "Planning",
  investigating: "Investigating",
  sandbox_creating: "Creating Sandbox",
  implementing: "Implementing",
  testing: "Testing",
  test_failed: "Test Failed",
  debugging: "Debugging",
  reviewing: "Reviewing",
  ready_for_approval: "Ready for Approval",
  approved: "Approved",
  rejected: "Rejected",
  merging: "Merging",
  deploying: "Deploying",
  verifying_deployment: "Verifying",
  completed: "Completed",
  rolled_back: "Rolled Back",
  failed: "Failed",
};

export default function EngineeringAgent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [request, setRequest] = useState("");
  const [selectedTask, setSelectedTask] = useState<EngineeringTask | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState("");
  const isAuthorized = user?.email === "felixahuruonye@gmail.com";

  const { data: tasks = [], isLoading, refetch } = useQuery<EngineeringTask[]>({
    queryKey: ["/api/engineering/tasks"],
    enabled: isAuthorized,
    refetchInterval: 10000,
  });

  const { data: events = [] } = useQuery<EngineeringTaskEvent[]>({
    queryKey: ["/api/engineering/tasks", selectedTask?.id, "events"],
    enabled: !!selectedTask && isAuthorized,
  });

  const createTask = useMutation({
    mutationFn: async (req: string) => {
      const res = await apiRequest("POST", "/api/engineering/tasks", { request: req });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Engineering task created", description: "The agent is now investigating." });
      setRequest("");
      queryClient.invalidateQueries({ queryKey: ["/api/engineering/tasks"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create task", description: err.message, variant: "destructive" });
    },
  });

  const approveTask = useMutation({
    mutationFn: async ({ taskId, approved }: { taskId: string; approved: boolean }) => {
      const res = await apiRequest("POST", `/api/engineering/tasks/${taskId}/approve`, {
        approved,
        notes: approvalNotes,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.status === "approved" ? "Task approved" : "Task rejected",
        description: data.status === "approved" ? "Merging and deploying..." : "Task has been rejected.",
      });
      setApprovalNotes("");
      setShowDetail(false);
      queryClient.invalidateQueries({ queryKey: ["/api/engineering/tasks"] });
    },
    onError: (err: any) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!request.trim()) return;
    createTask.mutate(request.trim());
  };

  const openDetail = (task: EngineeringTask) => {
    setSelectedTask(task);
    setShowDetail(true);
  };

  if (!isAuthorized) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Shield className="w-16 h-16 text-muted-foreground mx-auto" />
          <h1 className="text-2xl font-bold">Admin Access Required</h1>
          <p className="text-muted-foreground">Only the administrator can access the Engineering Agent.</p>
          <Link href="/dashboard">
            <Button variant="outline"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="h-14 border-b flex items-center px-4 justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <Wrench className="w-6 h-6 text-primary" />
          <h1 className="font-bold text-lg">Engineering Agent</h1>
          <Badge variant="outline" className="text-xs">Beta</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RotateCcw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Submit Request */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="w-5 h-5 text-primary" />
              New Engineering Request
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <Textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="Describe what you want built or fixed. Examples:
• Fix the login bug where users get stuck on the callback page
• Add a collaborative study room feature
• Investigate why CBT submissions are failing
• Build a student leaderboard"
                className="min-h-[100px]"
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={createTask.isPending || !request.trim()}>
                  {createTask.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating Task...</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> Submit Request</>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Task List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-5 h-5 text-primary" />
              Engineering Tasks ({tasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Wrench className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No engineering tasks yet.</p>
                <p className="text-sm">Submit a request above to get started.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => openDetail(task)}
                    className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[task.status] || "bg-gray-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{task.request}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{task.id}</span>
                        <span>•</span>
                        <span>{STATUS_LABELS[task.status] || task.status}</span>
                        <span>•</span>
                        <span>{new Date(task.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Task Detail Dialog */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-primary" />
              Task Details
            </DialogTitle>
            <DialogDescription>{selectedTask?.id}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            {selectedTask && (
              <div className="space-y-4">
                {/* Status */}
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_COLORS[selectedTask.status]}>
                    {STATUS_LABELS[selectedTask.status] || selectedTask.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Created {new Date(selectedTask.createdAt).toLocaleString()}
                  </span>
                </div>

                {/* Request */}
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-1">Request</p>
                  <p className="text-sm">{selectedTask.request}</p>
                </div>

                {/* Investigation */}
                {selectedTask.investigation && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1 flex items-center gap-1">
                      <Brain className="w-4 h-4" /> Investigation
                    </p>
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{selectedTask.investigation}</pre>
                  </div>
                )}

                {/* Root Cause */}
                {selectedTask.rootCause && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Root Cause</p>
                    <p className="text-sm">{selectedTask.rootCause}</p>
                  </div>
                )}

                {/* Test Results */}
                {selectedTask.testResults && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Test Results</p>
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{selectedTask.testResults}</pre>
                  </div>
                )}

                {/* Build Result */}
                {selectedTask.buildResult && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Build Result</p>
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{selectedTask.buildResult}</pre>
                  </div>
                )}

                {/* Review Result */}
                {selectedTask.reviewResult && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Review Result</p>
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{selectedTask.reviewResult}</pre>
                  </div>
                )}

                {/* Risk Assessment */}
                {selectedTask.riskAssessment && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Risk Assessment</p>
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{selectedTask.riskAssessment}</pre>
                  </div>
                )}

                {/* Diff */}
                {selectedTask.diff && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Code Diff</p>
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap max-h-[300px]">{selectedTask.diff}</pre>
                  </div>
                )}

                {/* Error Log */}
                {selectedTask.errorLog && (
                  <div className="p-3 bg-red-950/20 border border-red-500/30 rounded-lg">
                    <p className="text-sm font-medium mb-1 text-red-400">Error Log</p>
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap text-red-300">{selectedTask.errorLog}</pre>
                  </div>
                )}

                {/* Events */}
                {events.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Event Log</p>
                    {events.map((event) => (
                      <div key={event.id} className="flex items-start gap-2 text-xs p-2 rounded hover:bg-muted/50">
                        <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-medium">{event.eventType}</span>
                          <span className="text-muted-foreground"> by {event.actor}</span>
                          <p className="text-muted-foreground mt-0.5">{event.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Approval Controls */}
                {selectedTask.status === "ready_for_approval" && (
                  <div className="space-y-3 pt-4 border-t">
                    <p className="text-sm font-medium">Admin Approval Required</p>
                    <Textarea
                      value={approvalNotes}
                      onChange={(e) => setApprovalNotes(e.target.value)}
                      placeholder="Optional approval notes..."
                      className="min-h-[60px]"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        onClick={() => approveTask.mutate({ taskId: selectedTask.id, approved: false })}
                        disabled={approveTask.isPending}
                      >
                        <XCircle className="w-4 h-4 mr-2" /> Reject
                      </Button>
                      <Button
                        onClick={() => approveTask.mutate({ taskId: selectedTask.id, approved: true })}
                        disabled={approveTask.isPending}
                        className="flex-1"
                      >
                        {approveTask.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</>
                        ) : (
                          <><CheckCircle2 className="w-4 h-4 mr-2" /> Approve & Deploy</>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* PR Link */}
                {selectedTask.prUrl && (
                  <div className="pt-4 border-t">
                    <a
                      href={selectedTask.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <GitPullRequest className="w-4 h-4" />
                      View Branch on GitHub
                    </a>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
