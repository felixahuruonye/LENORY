// client/src/pages/learn/LearnEditor.tsx
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft, Loader2, Sparkles, CheckCircle2, XCircle,
  Code2, Eye, Rocket, Zap, Crown, Clock, Play,
  Save, RotateCw, Brain, MessageCircle, Lightbulb,
  ArrowRight, ArrowLeft, Lock, Unlock, Terminal,
  FileCode, FolderOpen, Download, Copy, Check,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── TYPES ─────────────────────────────────────────────────────────────────────

interface LearningStep {
  id: string;
  title: string;
  description: string;
  type: "lesson" | "exercise" | "project" | "quiz";
  content: string;
  code_snippet?: string;
  solution?: string;
  hints?: string[];
  is_completed: boolean;
  order: number;
}

interface LearningPath {
  id: string;
  title: string;
  steps: LearningStep[];
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function LearnEditor() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { pathId } = useParams<{ pathId: string }>();
  const { user } = useAuth();
  const { credits } = useCredits();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [code, setCode] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const [isCodeReviewing, setIsCodeReviewing] = useState(false);
  const [codeReview, setCodeReview] = useState("");
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const isPro = user?.subscriptionTier === 'pro' || user?.subscriptionTier === 'premium';

  // ─── QUERIES ────────────────────────────────────────────────────────────────

  // Get learning path
  const { data: path, isLoading: pathLoading } = useQuery<LearningPath>({
    queryKey: [`/api/learn/path/${pathId}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/learn/path/${pathId}`);
      return res.json();
    },
    enabled: !!pathId,
  });

  // Get progress
  const { data: progress, refetch: refetchProgress } = useQuery({
    queryKey: ["/api/learn/progress", pathId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/learn/progress/${pathId}`);
      return res.json();
    },
    enabled: !!pathId,
  });

  // ─── MUTATIONS ──────────────────────────────────────────────────────────────

  // Update progress
  const updateProgressMutation = useMutation({
    mutationFn: async ({ stepId, completed }: { stepId: string; completed: boolean }) => {
      const res = await apiRequest("POST", "/api/learn/progress", { pathId, stepId, completed });
      return res.json();
    },
    onSuccess: () => {
      refetchProgress();
      toast({ title: "Progress saved!" });
    },
  });

  // Code review
  const codeReviewMutation = useMutation({
    mutationFn: async ({ code, stepId }: { code: string; stepId: string }) => {
      const res = await apiRequest("POST", "/api/learn/review", { code, stepId, pathId });
      return res.json();
    },
    onSuccess: (data) => {
      setCodeReview(data.review);
      toast({ title: "Code review complete!" });
    },
    onError: (err: any) => {
      toast({ title: "Review failed", description: err.message, variant: "destructive" });
    },
  });

  // AI hint
  const hintMutation = useMutation({
    mutationFn: async ({ stepId }: { stepId: string }) => {
      const res = await apiRequest("POST", "/api/learn/hint", { stepId, pathId });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.hint) {
        const step = path?.steps[currentStepIndex];
        if (step) {
          if (!step.hints) step.hints = [];
          step.hints.push(data.hint);
          setHintIndex(step.hints.length - 1);
        }
        setShowHints(true);
        toast({ title: "Hint received!" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Hint failed", description: err.message, variant: "destructive" });
    },
  });

  // AI code generation (Premium only)
  const generateCodeMutation = useMutation({
    mutationFn: async ({ prompt, stepId }: { prompt: string; stepId: string }) => {
      const res = await apiRequest("POST", "/api/learn/generate", { prompt, stepId, pathId });
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedCode(data.code);
      toast({ title: "Code generated!", description: "Review and adapt the code." });
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  // ─── EFFECTS ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (path && progress) {
      const completedSteps = progress.completed_steps || [];
      // Find first incomplete step
      const firstIncomplete = path.steps.findIndex(
        (step: LearningStep) => !completedSteps.includes(step.id)
      );
      if (firstIncomplete !== -1) {
        setCurrentStepIndex(firstIncomplete);
        const step = path.steps[firstIncomplete];
        setCode(step.code_snippet || "");
      } else {
        setCurrentStepIndex(path.steps.length - 1);
        const step = path.steps[path.steps.length - 1];
        setCode(step.code_snippet || "");
      }
    }
  }, [path, progress]);

  // ─── HANDLERS ──────────────────────────────────────────────────────────────

  const currentStep = path?.steps[currentStepIndex];
  const completedSteps = progress?.completed_steps || [];
  const isStepCompleted = currentStep ? completedSteps.includes(currentStep.id) : false;
  const progressPercent = path ? Math.round((completedSteps.length / path.steps.length) * 100) : 0;

  const handleRunCode = () => {
    setIsRunning(true);
    setOutput("");
    try {
      // Create a safe execution environment
      const logs: string[] = [];
      const consoleLog = (...args: any[]) => {
        logs.push(args.map(String).join(" "));
      };
      const consoleError = (...args: any[]) => {
        logs.push("❌ " + args.map(String).join(" "));
      };

      // Execute code with console interception
      const fn = new Function(
        "console",
        `
          try {
            ${code}
          } catch (e) {
            console.error(e.message);
          }
        `
      );
      fn({ log: consoleLog, error: consoleError });

      setOutput(logs.join("\n") || "✅ Code executed successfully (no output)");
    } catch (e: any) {
      setOutput(`❌ Error: ${e.message}`);
    }
    setIsRunning(false);
  };

  const handlePreview = () => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>body { font-family: Arial, sans-serif; padding: 20px; }</style>
</head>
<body>
  ${code}
  <script>${code}</script>
</body>
</html>`;
        doc.open();
        doc.write(html);
        doc.close();
      }
    }
  };

  const handleCompleteStep = () => {
    if (currentStep) {
      updateProgressMutation.mutate({
        stepId: currentStep.id,
        completed: !isStepCompleted,
      });
    }
  };

  const handleNextStep = () => {
    if (path && currentStepIndex < path.steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
      const nextStep = path.steps[currentStepIndex + 1];
      setCode(nextStep.code_snippet || "");
      setOutput("");
      setShowHints(false);
      setHintIndex(0);
      setCodeReview("");
    }
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
      const prevStep = path?.steps[currentStepIndex - 1];
      setCode(prevStep?.code_snippet || "");
      setOutput("");
      setShowHints(false);
      setHintIndex(0);
      setCodeReview("");
    }
  };

  const handleCodeReview = () => {
    if (currentStep && code.trim()) {
      setIsCodeReviewing(true);
      codeReviewMutation.mutate({ code, stepId: currentStep.id });
    } else {
      toast({ title: "Write some code first", variant: "destructive" });
    }
  };

  const handleGetHint = () => {
    if (currentStep) {
      hintMutation.mutate({ stepId: currentStep.id });
    }
  };

  const handleGenerateCode = () => {
    if (!isPro) {
      toast({
        title: "Premium feature",
        description: "AI code generation is available on Pro and Premium plans.",
        variant: "destructive",
      });
      return;
    }
    if (currentStep && code.trim()) {
      const prompt = window.prompt("Describe what you want the code to do:", currentStep.description);
      if (prompt) {
        setIsGeneratingCode(true);
        generateCodeMutation.mutate({ prompt, stepId: currentStep.id });
      }
    } else {
      toast({ title: "Enter a description first", variant: "destructive" });
    }
  };

  if (pathLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!path || !currentStep) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <p className="text-muted-foreground mb-4">Learning path not found</p>
        <Button onClick={() => setLocation("/learn")}>Back to Learning</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/95 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setLocation("/learn")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="font-semibold text-sm">{path.title}</h1>
              <p className="text-xs text-muted-foreground">
                {currentStepIndex + 1} of {path.steps.length} steps
              </p>
            </div>
            <Badge variant="secondary" className="text-xs">
              {progressPercent}% complete
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {credits && (
              <Badge variant="outline" className="text-xs gap-1">
                <Brain className="h-3 w-3" />
                {credits.balance} credits
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setLocation("/pricing")}
            >
              <Crown className="h-4 w-4" />
              Upgrade
            </Button>
          </div>
        </div>
        <Progress value={progressPercent} className="h-1 mt-2" />
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Lesson Content */}
        <div className="w-1/3 border-r border-border/50 overflow-y-auto p-4">
          <ScrollArea className="h-full">
            {/* Step Navigation */}
            <div className="space-y-1 mb-4">
              {path.steps.map((step: LearningStep, idx: number) => (
                <button
                  key={step.id}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                    idx === currentStepIndex
                      ? "bg-primary/10 border border-primary/30"
                      : completedSteps.includes(step.id)
                      ? "hover:bg-muted/50 text-muted-foreground"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => {
                    setCurrentStepIndex(idx);
                    setCode(step.code_snippet || "");
                    setOutput("");
                    setShowHints(false);
                    setHintIndex(0);
                    setCodeReview("");
                  }}
                >
                  {completedSteps.includes(step.id) ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className="truncate">{step.title}</span>
                  <Badge variant="outline" className="text-[10px] ml-auto flex-shrink-0">
                    {step.type}
                  </Badge>
                </button>
              ))}
            </div>

            {/* Step Content */}
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{currentStep.title}</h2>
                <Badge variant="outline" className="text-xs mt-1">
                  {currentStep.type}
                </Badge>
                {isStepCompleted && (
                  <Badge variant="secondary" className="text-xs ml-2 bg-green-500/20 text-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Completed
                  </Badge>
                )}
              </div>

              <div className="prose prose-sm dark:prose-invert max-w-none">
                <p className="whitespace-pre-wrap">{currentStep.content}</p>
              </div>

              {/* Hints */}
              {showHints && currentStep.hints && currentStep.hints.length > 0 && (
                <Card className="p-4 bg-yellow-500/5 border-yellow-500/30">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-4 w-4 text-yellow-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Hints</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {currentStep.hints[currentStep.hints.length - 1]}
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {/* Code Review */}
              {codeReview && (
                <Card className="p-4 bg-purple-500/5 border-purple-500/30">
                  <div className="flex items-start gap-2">
                    <Brain className="h-4 w-4 text-purple-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">AI Review</p>
                      <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                        {codeReview}
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {/* Generated Code */}
              {generatedCode && (
                <Card className="p-4 bg-blue-500/5 border-blue-500/30">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-blue-500" />
                      <p className="text-sm font-medium">Generated Code</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCode(generatedCode);
                        setGeneratedCode("");
                        toast({ title: "Code applied!" });
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                  <pre className="text-xs bg-black/5 dark:bg-white/5 p-3 rounded mt-2 overflow-x-auto">
                    <code>{generatedCode}</code>
                  </pre>
                </Card>
              )}

              {/* Navigation Buttons */}
              <div className="flex items-center justify-between gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevStep}
                  disabled={currentStepIndex === 0}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={isStepCompleted ? "outline" : "default"}
                    onClick={handleCompleteStep}
                    className="gap-1"
                  >
                    {isStepCompleted ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Completed
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Mark Complete
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleNextStep}
                    disabled={currentStepIndex === path.steps.length - 1}
                    className="gap-1"
                  >
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel - Editor */}
        <div className="flex-1 flex flex-col">
          {/* Editor Tabs */}
          <div className="border-b border-border/50 bg-muted/20 px-4 py-1.5 flex items-center gap-2">
            <Tabs defaultValue="editor" className="w-full">
              <TabsList className="h-8">
                <TabsTrigger value="editor" className="text-xs gap-1">
                  <Code2 className="h-3 w-3" />
                  Editor
                </TabsTrigger>
                <TabsTrigger value="preview" className="text-xs gap-1">
                  <Eye className="h-3 w-3" />
                  Preview
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={handleGetHint}
                disabled={hintMutation.isPending}
              >
                <Lightbulb className="h-3 w-3" />
                Hint
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={handleCodeReview}
                disabled={isCodeReviewing || !code.trim()}
              >
                <Brain className="h-3 w-3" />
                Review
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-purple-500"
                onClick={handleGenerateCode}
                disabled={isGeneratingCode}
              >
                <Sparkles className="h-3 w-3" />
                Generate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={handleRunCode}
                disabled={isRunning}
              >
                <Play className="h-3 w-3" />
                Run
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={handlePreview}
              >
                <Eye className="h-3 w-3" />
                Preview
              </Button>
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 relative">
            <Tabs defaultValue="editor" className="h-full flex flex-col">
              <TabsContent value="editor" className="flex-1 m-0">
                <textarea
                  ref={editorRef}
                  className="w-full h-full bg-black/5 dark:bg-white/5 font-mono text-sm p-4 outline-none resize-none focus:ring-0"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                  placeholder="Write your code here..."
                />
              </TabsContent>
              <TabsContent value="preview" className="flex-1 m-0">
                <div className="w-full h-full bg-white dark:bg-slate-900 p-4 overflow-auto">
                  <iframe
                    ref={iframeRef}
                    className="w-full h-full border-0"
                    title="Preview"
                    sandbox="allow-scripts allow-modals allow-same-origin"
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Output Panel */}
          <div className="border-t border-border/50 h-32 bg-black/5 dark:bg-white/5 flex flex-col">
            <div className="px-4 py-1.5 border-b border-border/50 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Output</span>
              {isRunning && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap text-foreground/80">
                {output || "Run your code to see output here"}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

