import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  ArrowLeft, Film, Loader2, Play, Download, Sparkles, RefreshCcw, Clock,
} from "lucide-react";

interface VideoJob {
  id: string;
  prompt: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  videoUrl?: string;
  error?: string;
  createdAt: number;
}

const EXAMPLE_PROMPTS = [
  "A DNA strand slowly rotating in a blue scientific environment",
  "Nigerian students celebrating after an exam in bright sunlight",
  "Mathematical equations floating in space with stars",
  "A microscope view zooming into cells dividing",
  "Time-lapse of a sunflower growing from seed to bloom",
];

export default function VideoGeneration() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const pollRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const pollStatus = (jobId: string) => {
    if (pollRefs.current[jobId]) return;
    pollRefs.current[jobId] = setInterval(async () => {
      try {
        const res = await apiRequest("GET", `/api/video/status/${jobId}`);
        const data = await res.json();
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, status: data.status, videoUrl: data.videoUrl, error: data.error }
              : j
          )
        );
        if (data.status === "succeeded" || data.status === "failed") {
          clearInterval(pollRefs.current[jobId]);
          delete pollRefs.current[jobId];
          if (data.status === "succeeded") {
            toast({ title: "Video ready!", description: "Your video has been generated." });
          }
        }
      } catch {
        clearInterval(pollRefs.current[jobId]);
        delete pollRefs.current[jobId];
      }
    }, 5000);
  };

  useEffect(() => {
    return () => {
      Object.values(pollRefs.current).forEach(clearInterval);
    };
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    try {
      const res = await apiRequest("POST", "/api/video/generate", { prompt: prompt.trim() });
      const data = await res.json();
      if (data.error) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
        return;
      }
      const job: VideoJob = {
        id: data.id,
        prompt: prompt.trim(),
        status: "pending",
        createdAt: Date.now(),
      };
      setJobs((prev) => [job, ...prev]);
      setPrompt("");
      pollStatus(data.id);
      toast({ title: "Generating...", description: "Your video is being created. This may take 1-2 minutes." });
    } catch {
      toast({ title: "Failed", description: "Could not start video generation.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const statusConfig: Record<string, { label: string; color: string }> = {
    pending: { label: "Queued", color: "text-blue-500" },
    processing: { label: "Generating", color: "text-amber-500" },
    succeeded: { label: "Ready", color: "text-green-500" },
    failed: { label: "Failed", color: "text-red-500" },
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-purple-950/20">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border backdrop-blur-xl bg-background/80">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-purple-500/20">
              <Film className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h1 className="font-bold text-lg">Video Generation</h1>
              <p className="text-xs text-muted-foreground">AI-powered educational videos</p>
            </div>
          </div>
          <Badge variant="outline" className="ml-auto text-xs border-purple-500/30 text-purple-400">
            Beta · Premium
          </Badge>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Generate Card */}
        <Card className="border-purple-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-400" />
              Create a Video
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the video you want to generate... e.g. 'A slow zoom into a chemistry lab with bubbling test tubes'"
                className="resize-none min-h-24"
                data-testid="input-video-prompt"
              />
              <p className="text-xs text-muted-foreground mt-1">{prompt.length}/500 characters</p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Example prompts:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => setPrompt(ex)}
                    className="text-xs px-2.5 py-1 rounded-full border border-purple-500/20 text-muted-foreground hover:text-foreground hover:border-purple-500/50 transition-colors"
                    data-testid={`button-example-prompt-${i}`}
                  >
                    {ex.slice(0, 40)}...
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating}
              className="bg-purple-600 hover:bg-purple-700 text-white"
              data-testid="button-generate-video"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting Generation...
                </>
              ) : (
                <>
                  <Film className="h-4 w-4 mr-2" />
                  Generate Video
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">Video generation takes 1-3 minutes. Powered by Zeroscope.</p>
          </CardContent>
        </Card>

        {/* Jobs List */}
        {jobs.length > 0 && (
          <div>
            <h2 className="text-lg font-bold mb-4">Your Videos</h2>
            <div className="space-y-4">
              {jobs.map((job) => {
                const cfg = statusConfig[job.status] || { label: job.status, color: "text-muted-foreground" };
                return (
                  <Card key={job.id} className="border-primary/10" data-testid={`card-video-job-${job.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        {/* Video Preview or Loader */}
                        <div className="w-40 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-secondary/30 flex items-center justify-center">
                          {job.status === "succeeded" && job.videoUrl ? (
                            <video
                              src={job.videoUrl}
                              controls
                              className="w-full h-full object-cover rounded-lg"
                              data-testid={`video-${job.id}`}
                            />
                          ) : job.status === "failed" ? (
                            <div className="text-center p-2">
                              <p className="text-xs text-red-500">Failed</p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <Loader2 className="h-8 w-8 animate-spin text-purple-400 mx-auto mb-1" />
                              <p className="text-xs text-muted-foreground">Generating...</p>
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium line-clamp-2 mb-2">{job.prompt}</p>
                          <div className="flex items-center gap-2 mb-3">
                            <span className={`text-xs font-semibold ${cfg.color}`}>
                              {(job.status === "processing" || job.status === "pending") && (
                                <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />
                              )}
                              {cfg.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              <Clock className="h-3 w-3 inline mr-1" />
                              {new Date(job.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                          {job.status === "succeeded" && job.videoUrl && (
                            <div className="flex gap-2">
                              <a href={job.videoUrl} download className="inline-flex">
                                <Button size="sm" variant="outline" data-testid={`button-download-${job.id}`}>
                                  <Download className="h-4 w-4 mr-1" />
                                  Download
                                </Button>
                              </a>
                            </div>
                          )}
                          {job.status === "failed" && job.error && (
                            <p className="text-xs text-red-500">{job.error}</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty State */}
        {jobs.length === 0 && (
          <div className="text-center py-16">
            <Film className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No videos yet</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Enter a prompt above to generate your first educational video. Great for creating visual demonstrations, explainers, and study aids.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
