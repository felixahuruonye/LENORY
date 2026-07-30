// client/src/components/kb/GuideDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface GuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steps: Array<{ title: string; description: string }>;
  currentStep: number;
  onNext: () => void;
  onSkip: () => void;
}

export function GuideDialog({
  open,
  onOpenChange,
  steps,
  currentStep,
  onNext,
  onSkip,
}: GuideDialogProps) {
  const step = steps[currentStep];

  if (!step) return null;

  const emojis = ["📚", "📁", "📤", "🤖", "🔗", "💰", "🎉"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl font-bold">
            {step.title}
          </DialogTitle>
        </DialogHeader>
        <div className="py-6 text-center">
          <div className="text-6xl mb-4">
            {emojis[currentStep] || "📚"}
          </div>
          <p className="text-muted-foreground">{step.description}</p>
          <div className="flex justify-center gap-1 mt-4">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition ${i === currentStep ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onSkip} className="flex-1">
            Skip
          </Button>
          <Button onClick={onNext} className="flex-1 hover-elevate">
            {currentStep === steps.length - 1 ? "Get Started" : "Next"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
