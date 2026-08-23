import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
import {
  History, ArrowLeft, Shield, Loader2, Clock, GitBranch,
  CheckCircle2, XCircle, AlertTriangle, Brain, Code, ShieldCheck
} from "lucide-react";

interface TaskHistoryItem {
  id: string;
  request: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  adminEmail: string;
  rootCause: string | null;
  currentAttempt: number;
  maxAttempts: number;
  branchName: string | null;
  prUrl: string | null;
}

interface EventHistoryItem {
  id: number;
  taskId: string;
  eventType: string;
  actor: string;
  message: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-600",
  failed: "bg-red-700",
  rolled_back: "bg-orange-600",
  ready_for_approval: "bg-emerald-500",
  approved: "bg-green-500",
  rejected: "bg-red-600",
  investigating: "bg-purple-500",
  implementing: "bg-yellow-500",
  testing: "bg-orange-500",
  reviewing: "bg-violet-500",
  deploying: "bg-sky-500",
};

export default function HistoryPage() {
  const { user } = useAuth();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const isAuthorized = user?.email === "felixahuruonye@gmail.com";

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<TaskHistoryItem[]>({
    queryKey: ["/api/engineering/tasks"],
    enabled: isAuthorized,
  });

  const { data: events = [], isLoading: eventsLoading } = useQuery<EventHistoryItem[]>({
    queryKey: ["/api/engineering/tasks", selectedTaskId, "events"],
    enabled: !!selectedTaskId && isAuthorized,
  });

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

  const completedTasks = tasks.filter(t => t.status === "completed");
  const failedTasks = tasks.filter(t => t.status === "failed");
  const inProgressTasks = tasks.filter(t => !["completed", "failed", "rolled_back"].includes(t.status));

  return (
    <div className="min-h-screen bg-background">
      <header className="h-14 border-b flex items-center px-4 justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <History className="w-6 h-6 text-primary" />
          <h1 className="font-bold text-lg">Engineering History</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/engineering">
            <Button variant="outline" size="sm">
              <Brain className="w-4 h-4 mr-1" /> Engineering Agent
            </Button>
          </Link>
          <Link href="/admin/complaints">
            <Button variant="outline" size="sm">
              <AlertTriangle className="w-4 h-4 mr-1" /> Complaints
            </Button>
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{tasks.length}</div>
              <p className="text-xs text-muted-foreground">Total Tasks</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-500">{completedTasks.length}</div>
              <p className="text-xs text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-500">{failedTasks.length}</div>
              <p className="text-xs text-muted-foreground">Failed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-blue-500">{inProgressTasks.length}</div>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </CardContent>
          </Card>
        </div>

        {/* Task List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-primary" />
              All Engineering Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tasksLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No engineering tasks yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTaskId(selectedTaskId === task.id ? null : task.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedTaskId === task.id ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[task.status] || "bg-gray-500"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{task.request}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{task.id}</span>
                          <span>•</span>
                          <span className="capitalize">{task.status.replace(/_/g, " ")}</span>
                          <span>•</span>
                          <span>{new Date(task.createdAt).toLocaleString()}</span>
                          {task.currentAttempt > 0 && (
                            <><span>•</span><span>Attempt {task.currentAttempt}/{task.maxAttempts}</span></>
                          )}
                        </div>
                      </div>
                      {task.status === "completed" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      {task.status === "failed" && <XCircle className="w-4 h-4 text-red-500" />}
                      {task.status === "ready_for_approval" && <ShieldCheck className="w-4 h-4 text-emerald-500" />}
                    </div>

                    {/* Expanded detail */}
                    {selectedTaskId === task.id && (
                      <div className="mt-3 pt-3 border-t space-y-3">
                        {task.rootCause && (
                          <div className="p-2 bg-muted rounded text-sm">
                            <span className="font-medium">Root Cause:</span> {task.rootCause}
                          </div>
                        )}
                        {task.prUrl && (
                          <a href={task.prUrl} target="_blank" rel="noopener noreferrer"
                             className="text-sm text-primary hover:underline flex items-center gap-1">
                            <GitBranch className="w-3 h-3" /> {task.prUrl}
                          </a>
                        )}

                        {/* Events for this task */}
                        {eventsLoading && selectedTaskId === task.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : events.length > 0 ? (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">Event Log</p>
                            {events.map((e) => (
                              <div key={e.id} className="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-muted/50">
                                <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-medium">{e.eventType}</span>
                                  <span className="text-muted-foreground"> by {e.actor}</span>
                                  <p className="text-muted-foreground">{e.message}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
