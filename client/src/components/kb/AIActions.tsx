// client/src/components/kb/AIActions.tsx
import { Button } from "@/components/ui/button";
import { MessageCircle, Brain, Layers, Zap, Loader2 } from "lucide-react";

interface AIActionsProps {
  folderId: string;
  onChatPractice: (folderId: string, message: string) => void;
  onGenerateQuiz: (folderId: string, count: number) => void;
  onGenerateFlashcards: (folderId: string, count: number) => void;
  onGenerateSummary: (folderId: string) => void;
  isLoading: {
    chat: boolean;
    quiz: boolean;
    flashcards: boolean;
    summary: boolean;
  };
}

export function AIActions({
  folderId,
  onChatPractice,
  onGenerateQuiz,
  onGenerateFlashcards,
  onGenerateSummary,
  isLoading,
}: AIActionsProps) {
  const handleChatPractice = () => {
    const msg = prompt("Ask LENORY about the files in this folder:");
    if (msg) onChatPractice(folderId, msg);
  };

  const handleGenerateQuiz = () => {
    const count = prompt("How many quiz questions? (5-15)", "5");
    if (count) onGenerateQuiz(folderId, parseInt(count) || 5);
  };

  const handleGenerateFlashcards = () => {
    const count = prompt("How many flashcards? (5-30)", "10");
    if (count) onGenerateFlashcards(folderId, parseInt(count) || 10);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleChatPractice}
        disabled={isLoading.chat}
        className="gap-2 hover-elevate"
        data-testid="button-chat-practice"
      >
        {isLoading.chat ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MessageCircle className="h-4 w-4" />
        )}
        Chat Practice
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleGenerateQuiz}
        disabled={isLoading.quiz}
        className="gap-2 hover-elevate"
      >
        {isLoading.quiz ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Brain className="h-4 w-4" />
        )}
        Generate Quiz
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleGenerateFlashcards}
        disabled={isLoading.flashcards}
        className="gap-2 hover-elevate"
      >
        {isLoading.flashcards ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Layers className="h-4 w-4" />
        )}
        Flashcards
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onGenerateSummary(folderId)}
        disabled={isLoading.summary}
        className="gap-2 hover-elevate"
      >
        {isLoading.summary ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Zap className="h-4 w-4" />
        )}
        Generate Summary
      </Button>
    </div>
  );
}
