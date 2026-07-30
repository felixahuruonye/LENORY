// client/src/pages/learn/LearnDashboard.tsx
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen, Code2, ChevronLeft, Loader2, Sparkles,
  Crown, Zap, Clock, CheckCircle2, Circle,
  ArrowRight, Star, Award, Flame, Brain,
  FileText, LayoutTemplate, Server, Database,
  Shield, Rocket, Lock
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── TYPES ─────────────────────────────────────────────────────────────────────

interface LearningPath {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  estimated_hours: number;
  steps: LearningStep[];
  is_premium: boolean;
  created_at: string;
}

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

interface LearningProgress {
  path_id: string;
  current_step: number;
  completed_steps: string[];
  code_saves: Record<string, string>;
  started_at: string;
  updated_at: string;
}

// ─── LEARNING PATHS ──────────────────────────────────────────────────────────

const learningPaths: LearningPath[] = [
  {
    id: "html-basics",
    title: "HTML Basics",
    description: "Learn the structure of the web. Build your first webpage.",
    category: "frontend",
    difficulty: "beginner",
    estimated_hours: 4,
    is_premium: false,
    created_at: new Date().toISOString(),
    steps: [
      {
        id: "html-1",
        title: "What is HTML?",
        description: "Understand the purpose of HTML and how it structures web pages.",
        type: "lesson",
        content: "HTML (HyperText Markup Language) is the standard markup language for creating web pages...",
        is_completed: false,
        order: 1,
      },
      {
        id: "html-2",
        title: "Your First HTML Page",
        description: "Write your first HTML document.",
        type: "exercise",
        content: "Create a basic HTML page with a heading, paragraph, and an image.",
        code_snippet: "<!DOCTYPE html>\n<html>\n<head>\n  <title>My First Page</title>\n</head>\n<body>\n  \n</body>\n</html>",
        is_completed: false,
        order: 2,
      },
      {
        id: "html-3",
        title: "Common HTML Tags",
        description: "Learn headings, paragraphs, lists, links, and images.",
        type: "lesson",
        content: "HTML provides many tags to structure content...",
        is_completed: false,
        order: 3,
      },
      {
        id: "html-4",
        title: "Build a Simple Webpage",
        description: "Combine everything you've learned to build a complete webpage.",
        type: "project",
        content: "Build a personal profile page with a photo, bio, and links.",
        is_completed: false,
        order: 4,
      },
    ],
  },
  {
    id: "css-basics",
    title: "CSS Basics",
    description: "Style your webpages with colors, layouts, and animations.",
    category: "frontend",
    difficulty: "beginner",
    estimated_hours: 6,
    is_premium: false,
    created_at: new Date().toISOString(),
    steps: [
      {
        id: "css-1",
        title: "What is CSS?",
        description: "Understand how CSS styles HTML elements.",
        type: "lesson",
        content: "CSS (Cascading Style Sheets) is used to style and layout web pages...",
        is_completed: false,
        order: 1,
      },
      {
        id: "css-2",
        title: "CSS Selectors & Properties",
        description: "Learn how to target elements and apply styles.",
        type: "lesson",
        content: "CSS selectors allow you to target specific elements...",
        is_completed: false,
        order: 2,
      },
      {
        id: "css-3",
        title: "Styling Your HTML",
        description: "Apply CSS to your HTML page.",
        type: "exercise",
        content: "Style your personal profile page with colors, fonts, and spacing.",
        is_completed: false,
        order: 3,
      },
    ],
  },
  {
    id: "javascript-basics",
    title: "JavaScript Basics",
    description: "Make your webpages interactive with JavaScript.",
    category: "frontend",
    difficulty: "intermediate",
    estimated_hours: 8,
    is_premium: false,
    created_at: new Date().toISOString(),
    steps: [
      {
        id: "js-1",
        title: "What is JavaScript?",
        description: "Understand the role of JavaScript in web development.",
        type: "lesson",
        content: "JavaScript is a programming language that adds interactivity to web pages...",
        is_completed: false,
        order: 1,
      },
      {
        id: "js-2",
        title: "Variables & Data Types",
        description: "Learn how to store and manipulate data.",
        type: "lesson",
        content: "Variables are containers for storing data values...",
        is_completed: false,
        order: 2,
      },
      {
        id: "js-3",
        title: "Functions & Events",
        description: "Write functions and handle user interactions.",
        type: "exercise",
        content: "Add a button that changes the page color when clicked.",
        is_completed: false,
        order: 3,
      },
    ],
  },
  {
    id: "full-stack",
    title: "Full Stack Web Development",
    description: "Build complete web applications from frontend to backend.",
    category: "fullstack",
    difficulty: "advanced",
    estimated_hours: 20,
    is_premium: true,
    created_at: new Date().toISOString(),
    steps: [
      {
        id: "fs-1",
        title: "Introduction to Full Stack",
        description: "Understand the full stack architecture.",
        type: "lesson",
        content: "Full stack development involves both frontend and backend...",
        is_completed: false,
        order: 1,
      },
      {
        id: "fs-2",
        title: "Building the Frontend",
        description: "Create a React application.",
        type: "project",
        content: "Build a todo list application with React.",
        is_completed: false,
        order: 2,
      },
      {
        id: "fs-3",
        title: "Building the Backend",
        description: "Create a Node.js API.",
        type: "project",
        content: "Build a REST API for your todo list.",
        is_completed: false,
        order: 3,
      },
      {
        id: "fs-4",
        title: "Connecting Frontend to Backend",
        description: "Connect your React app to your API.",
        type: "project",
        content: "Make API calls from your React app.",
        is_completed: false,
        order: 4,
      },
    ],
  },
];

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function LearnDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { credits } = useCredits();
  const [selectedPath, setSelectedPath] = useState<LearningPath | null>(null);
  const [filter, setFilter] = useState<"all" | "beginner" | "intermediate" | "advanced">("all");
  const [category, setCategory] = useState<"all" | "frontend" | "backend" | "fullstack">("all");
  const [showPremiumOnly, setShowPremiumOnly] = useState(false);

  const isPro = user?.subscriptionTier === 'pro' || user?.subscriptionTier === 'premium';

  // ─── QUERIES ────────────────────────────────────────────────────────────────

  // Get user's learning progress
  const { data: progress, refetch: refetchProgress } = useQuery<Record<string, LearningProgress>>({
    queryKey: ["/api/learn/progress"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/learn/progress");
      return res.json();
    },
  });

  // ─── MUTATIONS ──────────────────────────────────────────────────────────────

  // Update progress
  const updateProgressMutation = useMutation({
    mutationFn: async ({ pathId, stepId, completed }: { pathId: string; stepId: string; completed: boolean }) => {
      const res = await apiRequest("POST", "/api/learn/progress", { pathId, stepId, completed });
      return res.json();
    },
    onSuccess: () => {
      refetchProgress();
    },
  });

  // ─── HANDLERS ──────────────────────────────────────────────────────────────

  const handleStartPath = (path: LearningPath) => {
    if (path.is_premium && !isPro) {
      toast({
        title: "Premium Content",
        description: "This learning path is available on Pro and Premium plans.",
        variant: "destructive",
      });
      return;
    }
    setSelectedPath(path);
    setLocation(`/learn/path/${path.id}`);
  };

  const handleContinuePath = (path: LearningPath) => {
    setLocation(`/learn/path/${path.id}`);
  };

  const handleUpdateProgress = (pathId: string, stepId: string, completed: boolean) => {
    updateProgressMutation.mutate({ pathId, stepId, completed });
  };

  const getFilteredPaths = () => {
    let filtered = learningPaths;

    if (filter !== "all") {
      filtered = filtered.filter((p) => p.difficulty === filter);
    }

    if (category !== "all") {
      filtered = filtered.filter((p) => p.category === category);
    }

    if (showPremiumOnly) {
      filtered = filtered.filter((p) => p.is_premium);
    }

    return filtered;
  };

  const filteredPaths = getFilteredPaths();
  const completedPaths = learningPaths.filter((p) => {
    const prog = progress?.[p.id];
    if (!prog) return false;
    return prog.completed_steps.length === p.steps.length;
  });

  const totalSteps = learningPaths.reduce((acc, p) => acc + p.steps.length, 0);
  const completedSteps = Object.values(progress || {}).reduce(
    (acc, p) => acc + p.completed_steps.length,
    0
  );
  const overallProgress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/95 backdrop-blur px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setLocation("/dashboard")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">Learn to Code</h1>
              <Badge variant="secondary" className="text-xs">
                {overallProgress}% complete
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isPro && (
              <Button
                size="sm"
                className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500"
                onClick={() => setLocation("/pricing")}
              >
                <Crown className="h-4 w-4" />
                Upgrade for Premium Content
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Progress Overview */}
        <div className="mb-8">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              <span className="font-semibold">{overallProgress}%</span>
              <span className="text-sm text-muted-foreground">Overall Progress</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-semibold">{completedSteps}</span>
              <span className="text-sm text-muted-foreground">of {totalSteps} steps</span>
            </div>
            <div className="flex items-center gap-2">
              <Award className="h-5 w-5 text-yellow-500" />
              <span className="font-semibold">{completedPaths.length}</span>
              <span className="text-sm text-muted-foreground">paths completed</span>
            </div>
            {credits && (
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-500" />
                <span className="font-semibold">{credits.balance}</span>
                <span className="text-sm text-muted-foreground">AI credits</span>
              </div>
            )}
          </div>
          <Progress value={overallProgress} className="h-2 mt-3" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1">
            {["all", "beginner", "intermediate", "advanced"].map((level) => (
              <Button
                key={level}
                variant={filter === level ? "default" : "ghost"}
                size="sm"
                onClick={() => setFilter(level as any)}
                className="capitalize"
              >
                {level === "all" ? "All" : level}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1 ml-2">
            {["all", "frontend", "backend", "fullstack"].map((cat) => (
              <Button
                key={cat}
                variant={category === cat ? "default" : "ghost"}
                size="sm"
                onClick={() => setCategory(cat as any)}
                className="capitalize"
              >
                {cat === "all" ? "All" : cat}
              </Button>
            ))}
          </div>
          <Button
            variant={showPremiumOnly ? "default" : "outline"}
            size="sm"
            className="ml-2 gap-2"
            onClick={() => setShowPremiumOnly(!showPremiumOnly)}
          >
            <Crown className="h-4 w-4" />
            Premium Only
          </Button>
        </div>

        {/* Learning Paths Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPaths.map((path) => {
            const prog = progress?.[path.id];
            const completedCount = prog?.completed_steps?.length || 0;
            const totalCount = path.steps.length;
            const isCompleted = completedCount === totalCount;
            const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
            const isLocked = path.is_premium && !isPro;

            return (
              <Card
                key={path.id}
                className={`hover-elevate cursor-pointer transition-all ${
                  isLocked ? "opacity-75" : ""
                }`}
                onClick={() => isLocked ? null : (isCompleted ? handleContinuePath(path) : handleStartPath(path))}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {isLocked && <Lock className="h-4 w-4 text-amber-500" />}
                        <Badge
                          variant={path.difficulty === "beginner" ? "secondary" : path.difficulty === "intermediate" ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {path.difficulty}
                        </Badge>
                        {path.is_premium && (
                          <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500">
                            <Crown className="h-3 w-3 mr-1" />
                            Premium
                          </Badge>
                        )}
                        {isCompleted && (
                          <Badge variant="secondary" className="text-[10px] bg-green-500/20 text-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Completed
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-semibold mt-2">{path.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{path.description}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {path.estimated_hours}h
                        </span>
                        <span className="flex items-center gap-1">
                          <Code2 className="h-3 w-3" />
                          {totalCount} steps
                        </span>
                      </div>
                    </div>
                  </div>

                  {!isLocked && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">{progressPercent}%</span>
                      </div>
                      <Progress value={progressPercent} className="h-1.5" />
                      <Button
                        variant={isCompleted ? "outline" : "default"}
                        size="sm"
                        className="mt-3 w-full gap-2 hover-elevate"
                        onClick={(e) => {
                          e.stopPropagation();
                          isCompleted ? handleContinuePath(path) : handleStartPath(path);
                        }}
                      >
                        {isCompleted ? (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            Continue Learning
                          </>
                        ) : completedCount > 0 ? (
                          <>
                            <Zap className="h-4 w-4" />
                            Resume
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" />
                            Start Learning
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  {isLocked && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLocation("/pricing");
                      }}
                    >
                      <Crown className="h-4 w-4 text-amber-500" />
                      Upgrade to Access
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {filteredPaths.length === 0 && (
          <div className="text-center py-12">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No learning paths found</p>
            <p className="text-sm text-muted-foreground">Try adjusting your filters</p>
          </div>
        )}
      </main>
    </div>
  );
}
