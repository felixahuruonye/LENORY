import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, BookOpen } from "lucide-react";

export default function WebsiteLearn() {
  const [, setLocation] = useLocation();
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [explanation, setExplanation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [displayedText, setDisplayedText] = useState("");

  // Fetch website
  const { data: website, isLoading: websiteLoading } = useQuery({
    queryKey: ["/api/websites", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/websites/${id}`);
      return res.json();
    },
    enabled: !!id,
  });

  // Stream explanation character by character for visual effect
  useEffect(() => {
    if (!explanation) return;
    
    setDisplayedText("");
    let index = 0;
    
    const interval = setInterval(() => {
      if (index < explanation.length) {
        setDisplayedText(explanation.substring(0, index + 1));
        index++;
      } else {
        clearInterval(interval);
      }
    }, 5); // 5ms per character for smooth streaming effect
    
    return () => clearInterval(interval);
  }, [explanation]);

  const handleExplain = async () => {
    setIsLoading(true);
    setExplanation("");
    setDisplayedText("");
    
    try {
      const res = await apiRequest("POST", `/api/websites/${id}/explain`);
      const data = await res.json();
      setExplanation(data.explanation);
    } catch (error: any) {
      const message = error?.message || error?.error || "Failed to explain code";
      toast({
        title: "Explanation Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!id) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card className="p-8 text-center text-muted-foreground">
            <p>Website not found</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/website-generator")}>
              Back to Generator
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/50 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/website-generator")}
              data-testid="button-back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold text-center flex-1">Learn Code</h1>
            <div className="w-10" />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {websiteLoading ? (
          <Card className="p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Website Info */}
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-2">{website?.title}</h2>
              <p className="text-sm text-muted-foreground">{website?.description}</p>
            </Card>

            {/* Explanation Section */}
            {!explanation && !isLoading ? (
              <Card className="p-8 text-center">
                <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground mb-6">Click the button below to get a detailed explanation of how this code works</p>
                <Button
                  onClick={handleExplain}
                  size="lg"
                  className="hover-elevate active-elevate-2"
                  data-testid="button-get-explanation"
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  Get Explanation from LENORY
                </Button>
              </Card>
            ) : isLoading ? (
              <Card className="p-8">
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <div className="text-center">
                    <p className="font-semibold">LENORY is analyzing your code...</p>
                    <p className="text-xs text-muted-foreground mt-1">This should take 10-15 seconds</p>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">How This Code Works</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setExplanation("");
                      setDisplayedText("");
                    }}
                    data-testid="button-clear-explanation"
                  >
                    Clear
                  </Button>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground min-h-[100px]">
                    {displayedText}
                    {displayedText.length < explanation.length && (
                      <span className="animate-pulse">▌</span>
                    )}
                  </p>
                </div>
                <Button
                  onClick={handleExplain}
                  disabled={isLoading}
                  className="w-full hover-elevate active-elevate-2 mt-4"
                  data-testid="button-refresh-explanation"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    "Get Another Explanation"
                  )}
                </Button>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
