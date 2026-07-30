// client/src/components/website/ActionButtons.tsx
import { Button } from "@/components/ui/button";
import { Plus, Upload, Link2, Figma, Github, Mic , Circle } from "lucide-react";

interface ActionButtonsProps {
  onNew: () => void;
  onUpload: () => void;
  onUrl: () => void;
  onFigma: () => void;
  onGithub: () => void;
  onVoice: () => void;
}

export function ActionButtons({
  onNew,
  onUpload,
  onUrl,
  onFigma,
  onGithub,
  onVoice,
}: ActionButtonsProps) {
  const actions = [
    { icon: Plus, label: "New", onClick: onNew },
    { icon: Upload, label: "Upload", onClick: onUpload },
    { icon: Link2, label: "From URL", onClick: onUrl },
    { icon: Figma, label: "Figma", onClick: onFigma },
    { icon: Github, label: "GitHub", onClick: onGithub },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground"
          onClick={action.onClick}
        >
          <action.icon className="h-4 w-4" />
          {action.label}
        </Button>
      ))}
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-muted-foreground hover:text-foreground"
        onClick={onVoice}
      >
        <Mic className="h-4 w-4" />
        Voice
      </Button>
    </div>
  );
}

