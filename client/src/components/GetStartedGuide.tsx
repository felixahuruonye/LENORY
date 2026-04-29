import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  BookOpen,
  Code2,
  Brain,
  Monitor,
  FolderOpen,
  Lightbulb,
  CheckCircle2,
  ChevronRight,
  Star,
} from "lucide-react";
import { Link } from "wouter";

interface GetStartedGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GetStartedGuide({ open, onOpenChange }: GetStartedGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);
  
  // Handle errors gracefully
  if (!open) return null;

  const steps = [
    {
      id: "welcome",
      title: "Welcome to LENORY ULTRA!",
      description: "Your AI-powered learning companion",
      icon: Star,
      content: `LENORY ULTRA is an advanced EdTech platform with AI tutoring, exams, memory tracking, and more. Let's explore what you can do!`,
      color: "from-blue-500 to-cyan-500",
    },
    {
      id: "chat",
      title: "💬 Advanced Chat",
      description: "Ask LENORY anything",
      icon: MessageSquare,
      content: `Chat with AI in multiple modes:
• AI Tutor - Get explanations for any topic
• Quick Ask - Fast answers to questions  
• Read Projects - Ask "read my project workspace" to discuss your projects with AI
• Internet Search - Get current information
• Study Helper - Get study tips and guidance`,
      color: "from-blue-500 to-purple-500",
      href: "/advanced-chat",
    },
    {
      id: "cbt",
      title: "📝 CBT Mode (Exams)",
      description: "Practice with mock exams",
      icon: Monitor,
      content: `Prepare for standardized tests:
• Support for JAMB, WAEC, NECO exams
• 250+ questions per subject
• Real-time grading with AI
• Performance analytics
• Weak topic detection
• Score predictions
• Auto-logout on timer`,
      color: "from-amber-500 to-orange-500",
      href: "/cbt-mode",
    },
    {
      id: "memory",
      title: "🧠 Memory Panel",
      description: "Your learning profile",
      icon: Brain,
      content: `Track everything you learn:
• Auto-learned preferences from interactions
• Learning history and progress
• Subjects you're studying
• Skills you're developing
• Goals and targets
• All data persists permanently`,
      color: "from-teal-500 to-cyan-500",
      href: "/memory",
    },
    {
      id: "workspace",
      title: "📁 Project Workspace",
      description: "Organize your work",
      icon: FolderOpen,
      content: `Manage your projects and tasks:
• Create projects for anything
• Add tasks and track progress
• Mark tasks as complete
• Share project context with AI
• Get AI help on your projects
• Real-time progress tracking`,
      color: "from-purple-500 to-pink-500",
      href: "/project-workspace",
    },
    {
      id: "website",
      title: "💻 Website Generator",
      description: "Build websites with AI",
      icon: Code2,
      content: `Create professional websites:
• AI-powered code generation
• Multiple design templates
• Responsive layouts
• Easy customization
• One-click deployment
• Learn web development`,
      color: "from-green-500 to-emerald-500",
      href: "/website-generator",
    },
    {
      id: "tips",
      title: "💡 Pro Tips",
      description: "Maximize your learning",
      icon: Lightbulb,
      content: `Get the most out of LENORY:
✓ Save chat histories to Memory Panel
✓ Practice regularly with CBT exams
✓ Track your progress in Memory
✓ Ask AI to read your projects
✓ Organize with Project Workspace
✓ Use all 8 AI tutoring modes
✓ Check your analytics weekly`,
      color: "from-yellow-500 to-orange-500",
    },
    {
      id: "start",
      title: "Ready to Get Started?",
      description: "Let's explore LENORY!",
      icon: CheckCircle2,
      content: `You're all set! Start with:
1. Ask a question in Advanced Chat
2. Create a project in Project Workspace
3. Take a mock exam in CBT Mode
4. Check your Memory Panel
5. Generate a website`,
      color: "from-green-500 to-emerald-500",
    },
  ];

  try {
    const step = steps[currentStep];
    if (!step) {
      onOpenChange(false);
      return null;
    }
    
    const Icon = step.icon;
    const isLastStep = currentStep === steps.length - 1;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-4">
            <div className={`inline-flex p-3 rounded-lg bg-gradient-to-br ${step.color}`}>
              <Icon className="h-6 w-6 text-white" />
            </div>
            <div>
              <DialogTitle>{step.title}</DialogTitle>
              <DialogDescription>{step.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Card className="border-0 bg-secondary/50">
          <CardContent className="pt-6">
            <p className="whitespace-pre-line text-sm leading-relaxed">{step.content}</p>
          </CardContent>
        </Card>

        {/* Progress Indicators */}
        <div className="flex gap-2 justify-center">
          {steps.map((_, idx) => (
            <div
              key={idx}
              className={`h-2 rounded-full transition-all ${
                idx === currentStep
                  ? "bg-primary w-8"
                  : idx < currentStep
                    ? "bg-primary/50 w-2"
                    : "bg-muted w-2"
              }`}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            Step {currentStep + 1} of {steps.length}
          </div>

          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button
                variant="outline"
                onClick={() => setCurrentStep(currentStep - 1)}
                data-testid={`button-prev-step-${currentStep}`}
              >
                Previous
              </Button>
            )}

            {isLastStep ? (
              <Button
                onClick={() => onOpenChange(false)}
                className="gap-2"
                data-testid="button-start-learning"
              >
                Start Learning
                <CheckCircle2 className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={() => setCurrentStep(currentStep + 1)}
                className="gap-2"
                data-testid={`button-next-step-${currentStep}`}
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}

            {step.href && (
              <Button
                asChild
                variant="secondary"
                data-testid={`button-explore-${step.id}`}
              >
                <Link href={step.href} onClick={() => onOpenChange(false)}>
                  Explore Now
                </Link>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    );
  } catch (error) {
    console.error("GetStartedGuide error:", error);
    onOpenChange(false);
    return null;
  }
}
