// client/src/components/website/ModelSelector.tsx
import { Button } from "@/components/ui/button";
import { Crown, Sparkles, Zap, ImageIcon, Search , Circle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ModelSelectorProps {
  selected: string;
  onSelect: (model: string) => void;
  isPro: boolean;
}

const models = [
  { id: "ultra", label: "Ultra", icon: Sparkles, color: "text-purple-500", pro: true },
  { id: "fast", label: "Fast", icon: Zap, color: "text-blue-500", pro: false },
  { id: "vision", label: "Vision", icon: ImageIcon, color: "text-emerald-500", pro: false },
  { id: "search", label: "Search", icon: Search, color: "text-amber-500", pro: false },
];

export function ModelSelector({ selected, onSelect, isPro }: ModelSelectorProps) {
  const { toast } = useToast();

  const handleSelect = (modelId: string, isProModel: boolean) => {
    if (isProModel && !isPro) {
      toast({
        title: "Pro feature",
        description: `${modelId.charAt(0).toUpperCase() + modelId.slice(1)} model is available on Pro and Premium plans.`,
        variant: "destructive",
      });
      return;
    }
    onSelect(modelId);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
      <span className="text-sm text-muted-foreground mr-2">Model:</span>
      {models.map((model) => {
        const isSelected = selected === model.id;
        const isDisabled = model.pro && !isPro;
        const Icon = model.icon;
        return (
          <Button
            key={model.id}
            variant={isSelected ? "default" : "outline"}
            size="sm"
            className={`gap-2 ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={() => handleSelect(model.id, model.pro)}
            data-testid={`model-${model.id}`}
          >
            <Icon className={`h-4 w-4 ${model.color}`} />
            {model.label}
            {isDisabled && <Crown className="h-3 w-3 text-amber-500" />}
            {isSelected && <span className="text-[10px] ml-1">✓</span>}
          </Button>
        );
      })}
    </div>
  );
}

